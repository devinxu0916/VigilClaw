import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { CommandBridge } from '../../src/command-bridge.js';

// ---- Minimal mocks ----

function makeDb(overrides: Record<string, unknown> = {}): ReturnType<typeof import('../../src/db.js').VigilClawDB.prototype.getUser> extends undefined ? never : any {
  return {
    listScheduledTasks: vi.fn().mockReturnValue([]),
    deleteScheduledTask: vi.fn().mockReturnValue(true),
    updateScheduledTaskEnabled: vi.fn().mockReturnValue(true),
    updateScheduledTaskNextRun: vi.fn(),
    getUser: vi.fn().mockReturnValue({ maxCostPerDay: 10, maxCostPerMonth: 100 }),
    getOrCreateUser: vi.fn(),
    updateUserModel: vi.fn(),
    updateUserBudget: vi.fn(),
    getUserDayCost: vi.fn().mockReturnValue(1.5),
    getUserMonthCost: vi.fn().mockReturnValue(15.0),
    ...overrides,
  };
}

function makeSkillRegistry(overrides: Record<string, unknown> = {}): any {
  return {
    listSkills: vi.fn().mockReturnValue([]),
    installSkill: vi.fn().mockReturnValue({ success: true }),
    removeSkill: vi.fn().mockReturnValue({ success: true }),
    enableSkill: vi.fn().mockReturnValue({ success: true }),
    disableSkill: vi.fn().mockReturnValue({ success: true }),
    ...overrides,
  };
}

function makeTaskScheduler(): any {
  return {
    createTask: vi.fn().mockReturnValue('new-task-uuid'),
  };
}

function makeSessionManager(): any {
  return {
    clearContext: vi.fn(),
  };
}

// Helper: send HTTP POST to bridge
async function post(
  port: number,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let raw = '';
        res.on('data', (c: Buffer) => { raw += c.toString(); });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('CommandBridge', () => {
  let bridge: CommandBridge;
  let db: ReturnType<typeof makeDb>;
  let skillRegistry: ReturnType<typeof makeSkillRegistry>;
  let taskScheduler: ReturnType<typeof makeTaskScheduler>;
  let sessionManager: ReturnType<typeof makeSessionManager>;
  let port: number;
  const TASK_ID = 'test-task-id';
  const USER_ID = 'user-1';

  beforeEach(async () => {
    db = makeDb();
    skillRegistry = makeSkillRegistry();
    taskScheduler = makeTaskScheduler();
    sessionManager = makeSessionManager();
    bridge = new CommandBridge(db, skillRegistry, taskScheduler, sessionManager, new Set(['admin-user']));
    port = await bridge.createBridgeForTask(TASK_ID, USER_ID, undefined);
  });

  afterEach(async () => {
    await bridge.destroyAll();
  });

  // ---- Auth ----

  it('rejects request with wrong taskId', async () => {
    const res = await post(port, '/system/schedule/list', { taskId: 'wrong-id', userId: USER_ID });
    expect(res.status).toBe(403);
    expect((res.data as any).error).toBe('invalid_task_id');
  });

  it('rejects invalid JSON body', async () => {
    const p = new Promise<{ status: number; data: unknown }>((resolve, reject) => {
      const raw = 'not-json';
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/system/schedule/list', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } },
        (res) => {
          let body = '';
          res.on('data', (c: Buffer) => { body += c.toString(); });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, data: JSON.parse(body) }));
        },
      );
      req.on('error', reject);
      req.write(raw);
      req.end();
    });
    const res = await p;
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown route', async () => {
    const res = await post(port, '/system/unknown/route', { taskId: TASK_ID, userId: USER_ID });
    expect(res.status).toBe(404);
  });

  // ---- Admin permission ----

  it('allows admin to install skill (bridge created for admin user)', async () => {
    // Bridge is bound to admin-user — admin check uses the bound userId, not body
    const adminBridge = new CommandBridge(db, skillRegistry, taskScheduler, sessionManager, new Set(['admin-user']));
    const adminPort = await adminBridge.createBridgeForTask('admin-task', 'admin-user', undefined);
    skillRegistry.installSkill.mockReturnValue({ success: true });
    const res = await post(adminPort, '/system/skill/install', {
      taskId: 'admin-task', userId: 'ignored', sourcePath: '/some/path',
    });
    expect(res.status).toBe(200);
    expect((res.data as any).success).toBe(true);
    await adminBridge.destroyAll();
  });

  it('rejects non-admin skill install (bridge created for regular user)', async () => {
    // Bridge bound to USER_ID = 'user-1', which is not in adminUsers
    const res = await post(port, '/system/skill/install', {
      taskId: TASK_ID, userId: USER_ID, sourcePath: '/some/path',
    });
    expect(res.status).toBe(403);
    expect((res.data as any).error).toBe('requires_admin');
  });

  it('allows all users when adminUsers set is empty', async () => {
    const openBridge = new CommandBridge(db, skillRegistry, taskScheduler, sessionManager, new Set());
    const openPort = await openBridge.createBridgeForTask('open-task', USER_ID, undefined);
    const res = await post(openPort, '/system/skill/install', {
      taskId: 'open-task', userId: USER_ID, sourcePath: '/some/path',
    });
    expect(res.status).toBe(200);
    await openBridge.destroyAll();
  });

  // ---- Schedule routes ----

  it('lists scheduled tasks', async () => {
    db.listScheduledTasks.mockReturnValue([{ id: 'abc', cron_expression: '0 9 * * *', task_prompt: 'test' }]);
    const res = await post(port, '/system/schedule/list', { taskId: TASK_ID, userId: USER_ID });
    expect(res.status).toBe(200);
    expect((res.data as any).tasks).toHaveLength(1);
  });

  it('creates scheduled task with valid cron', async () => {
    const res = await post(port, '/system/schedule/create', {
      taskId: TASK_ID, userId: USER_ID,
      cronExpression: '0 9 * * *', taskPrompt: '每日早报',
    });
    expect(res.status).toBe(200);
    expect((res.data as any).success).toBe(true);
    expect(taskScheduler.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ cronExpression: '0 9 * * *', taskPrompt: '每日早报' }),
    );
  });

  it('returns error for missing cronExpression', async () => {
    const res = await post(port, '/system/schedule/create', {
      taskId: TASK_ID, userId: USER_ID, taskPrompt: '早报',
    });
    expect(res.status).toBe(400);
    expect((res.data as any).error).toBe('missing_field');
  });

  it('returns invalid_cron when TaskScheduler returns null', async () => {
    taskScheduler.createTask.mockReturnValue(null);
    const res = await post(port, '/system/schedule/create', {
      taskId: TASK_ID, userId: USER_ID,
      cronExpression: 'bad cron', taskPrompt: '早报',
    });
    expect(res.status).toBe(400);
    expect((res.data as any).error).toBe('invalid_cron');
  });

  it('removes scheduled task by prefix', async () => {
    db.listScheduledTasks.mockReturnValue([{ id: 'abcdef123456', cron_expression: '0 9 * * *', task_prompt: 'test' }]);
    const res = await post(port, '/system/schedule/remove', {
      taskId: TASK_ID, userId: USER_ID, scheduleId: 'abcd',
    });
    expect(res.status).toBe(200);
    expect((res.data as any).success).toBe(true);
  });

  it('returns not_found when removing non-existent task', async () => {
    db.listScheduledTasks.mockReturnValue([]);
    const res = await post(port, '/system/schedule/remove', {
      taskId: TASK_ID, userId: USER_ID, scheduleId: 'nonexistent',
    });
    expect(res.status).toBe(404);
  });

  // ---- Model switch ----

  it('switches model by alias', async () => {
    const res = await post(port, '/system/model/switch', {
      taskId: TASK_ID, userId: USER_ID, model: 'haiku',
    });
    expect(res.status).toBe(200);
    expect((res.data as any).success).toBe(true);
    expect(db.updateUserModel).toHaveBeenCalled();
  });

  // ---- Budget ----

  it('checks budget', async () => {
    const res = await post(port, '/system/budget/check', { taskId: TASK_ID, userId: USER_ID });
    expect(res.status).toBe(200);
    const data = res.data as any;
    expect(data.dayCost).toBe(1.5);
    expect(data.dayBudget).toBe(10);
  });

  it('sets budget with day and month limits', async () => {
    const res = await post(port, '/system/budget/set', {
      taskId: TASK_ID, userId: USER_ID, dayLimit: 20, monthLimit: 300,
    });
    expect(res.status).toBe(200);
    expect(db.updateUserBudget).toHaveBeenCalledWith(USER_ID, 20, 300);
  });

  it('sets budget with only day limit, month = day*30', async () => {
    const res = await post(port, '/system/budget/set', {
      taskId: TASK_ID, userId: USER_ID, dayLimit: 5,
    });
    expect(res.status).toBe(200);
    expect(db.updateUserBudget).toHaveBeenCalledWith(USER_ID, 5, 150);
  });

  // ---- Context clear ----

  it('clears context', async () => {
    const res = await post(port, '/system/context/clear', { taskId: TASK_ID, userId: USER_ID });
    expect(res.status).toBe(200);
    expect(sessionManager.clearContext).toHaveBeenCalledWith(USER_ID, undefined);
  });

  // ---- Lifecycle ----

  it('destroys bridge and stops server', async () => {
    await bridge.destroyBridgeForTask(TASK_ID);
    await expect(post(port, '/system/schedule/list', { taskId: TASK_ID })).rejects.toThrow();
  });
});

// ---- Stub generation ----

describe('CommandBridge.generateStubJs', () => {
  it('replaces TASK_ID placeholder', () => {
    const js = CommandBridge.generateStubJs('my-task', 'user-1', 'group-1');
    expect(js).toContain("const TASK_ID = 'my-task'");
    expect(js).not.toContain('__TASK_ID__');
  });

  it('replaces USER_ID placeholder', () => {
    const js = CommandBridge.generateStubJs('t', 'alice', undefined);
    expect(js).toContain("const USER_ID = 'alice'");
    expect(js).not.toContain('__USER_ID__');
  });

  it('replaces GROUP_ID placeholder with empty string when undefined', () => {
    const js = CommandBridge.generateStubJs('t', 'u', undefined);
    expect(js).toContain("const GROUP_ID = ''");
    expect(js).not.toContain('__GROUP_ID__');
  });

  it('exports createTool function', () => {
    const js = CommandBridge.generateStubJs('t', 'u', 'g');
    expect(js).toContain('module.exports');
    expect(js).toContain('createTool');
  });
});

// ---- getSystemCommandsSkillInfo ----

describe('CommandBridge.getSystemCommandsSkillInfo', () => {
  it('returns skill info with correct name', () => {
    const info = CommandBridge.getSystemCommandsSkillInfo();
    expect(info.name).toBe('system-commands');
    expect(info.version).toBe('1.0.0');
  });

  it('includes all 14 system tools', () => {
    const info = CommandBridge.getSystemCommandsSkillInfo();
    expect(info.tools).toHaveLength(14);
    const names = info.tools.map((t) => t.name);
    expect(names).toContain('system_schedule_create');
    expect(names).toContain('system_skill_install');
    expect(names).toContain('system_model_switch');
    expect(names).toContain('system_budget_check');
    expect(names).toContain('system_context_clear');
  });

  it('system_schedule_create has required cron_expression and task_prompt', () => {
    const info = CommandBridge.getSystemCommandsSkillInfo();
    const tool = info.tools.find((t) => t.name === 'system_schedule_create')!;
    expect(tool.input_schema.required).toContain('cron_expression');
    expect(tool.input_schema.required).toContain('task_prompt');
    expect(tool.description).toContain('0 9 * * *');
  });
});
