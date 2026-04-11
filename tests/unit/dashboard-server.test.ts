import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { createDashboardHandler } from '../../src/dashboard-server.js';
import { generateDashboardToken } from '../../src/dashboard-auth.js';
import type { DashboardDeps } from '../../src/dashboard-server.js';

// ---- Minimal mocks ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDb(overrides: Record<string, unknown> = {}): any {
  return {
    getOverviewStats: vi.fn().mockReturnValue({
      todayCost: 1.5,
      monthCost: 15.0,
      todayCalls: 10,
      monthCalls: 100,
      todayTasks: 3,
      monthTasks: 30,
    }),
    getModelBreakdownToday: vi.fn().mockReturnValue([
      { model: 'claude-sonnet', call_count: 5, total_cost: 1.0, input_tokens: 5000, output_tokens: 2000 },
    ]),
    getTasksPaginated: vi.fn().mockReturnValue({
      tasks: [
        {
          id: 'task-001',
          user_id: 'u1',
          group_id: null,
          status: 'completed',
          input_summary: 'test task',
          total_cost_usd: 0.5,
          created_at: '2025-01-01 00:00:00',
          completed_at: '2025-01-01 00:01:00',
        },
      ],
      total: 1,
    }),
    getAllScheduledTasks: vi.fn().mockReturnValue([]),
    getSecurityEventsPaginated: vi.fn().mockReturnValue({
      events: [
        {
          id: 1,
          event_type: 'network_violation',
          user_id: 'u1',
          severity: 'high',
          details: '{"target":"1.2.3.4"}',
          created_at: '2025-01-01 00:00:00',
        },
      ],
      total: 1,
    }),
    listCredentialStatus: vi.fn().mockReturnValue([
      { provider: 'anthropic', last_rotated_at: null },
    ]),
    getScheduledTaskById: vi.fn().mockReturnValue(null),
    adminToggleScheduledTask: vi.fn().mockReturnValue(true),
    adminDeleteScheduledTask: vi.fn().mockReturnValue(true),
    updateScheduledTaskNextRun: vi.fn(),
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSkillRegistry(overrides: Record<string, unknown> = {}): any {
  return {
    listSkills: vi.fn().mockReturnValue([
      { name: 'web-search', version: '1.0.0', description: 'Search the web', enabled: true },
    ]),
    enableSkill: vi.fn().mockReturnValue({ success: true }),
    disableSkill: vi.fn().mockReturnValue({ success: true }),
    ...overrides,
  };
}

const MASTER_KEY = Buffer.from('0'.repeat(64), 'hex');
const TOKEN = generateDashboardToken(MASTER_KEY);

// Helper: send HTTP request
async function request(
  port: number,
  method: string,
  path: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { ...extraHeaders },
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString();
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Dashboard Server', () => {
  let server: http.Server;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let skillRegistry: any;
  let port: number;

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    db = makeDb();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    skillRegistry = makeSkillRegistry();
    const deps: DashboardDeps = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      db,
      token: TOKEN,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      skillRegistry,
      taskScheduler: null,
      healthChecks: async () => ({
        sqlite: true,
        docker: true,
        uptime: 3600,
        memoryMB: 128,
      }),
    };

    const handler = createDashboardHandler(deps);

    // Build server that mimics health.ts routing
    server = http.createServer((req, res) => {
      void (async () => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }
        handler(req, res);
      })();
    });

    port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as import('node:net').AddressInfo;
        resolve(addr.port);
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ---- Auth ----

  it('returns 401 without token', async () => {
    const res = await request(port, 'GET', '/');
    expect(res.status).toBe(401);
    expect(res.body).toContain('401');
  });

  it('returns 200 with valid query token', async () => {
    const res = await request(port, 'GET', `/?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('VigilClaw');
  });

  it('returns 200 with valid Bearer token', async () => {
    const res = await request(port, 'GET', '/', { Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
    expect(res.body).toContain('VigilClaw');
  });

  it('/health does not require auth', async () => {
    const res = await request(port, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });

  // ---- Overview ----

  it('GET / returns full page with overview', async () => {
    const res = await request(port, 'GET', `/?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<!DOCTYPE html>');
    expect(res.body).toContain('Today Cost');
    expect(res.body).toContain('$1.5000');
  });

  it('GET /api/overview returns HTML fragment', async () => {
    const res = await request(port, 'GET', `/api/overview?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('<!DOCTYPE html>');
    expect(res.body).toContain('Today Cost');
    expect(res.body).toContain('claude-sonnet');
  });

  // ---- Tasks ----

  it('GET /api/tasks returns tasks and scheduled tasks', async () => {
    const res = await request(port, 'GET', `/api/tasks?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('task-001');
    expect(res.body).toContain('Recent Tasks');
    expect(res.body).toContain('Scheduled Tasks');
  });

  // ---- System ----

  it('GET /api/system returns skills, events, credentials', async () => {
    const res = await request(port, 'GET', `/api/system?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('web-search');
    expect(res.body).toContain('network_violation');
    expect(res.body).toContain('anthropic');
  });

  // ---- Schedule toggle ----

  it('POST /api/schedules/:id/toggle toggles a scheduled task', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.getScheduledTaskById.mockReturnValue({
      id: 'sched-1',
      user_id: 'u1',
      cron_expression: '0 9 * * *',
      task_prompt: 'test',
      enabled: 1,
      last_run_at: null,
      next_run_at: '2025-01-02 09:00:00',
      created_at: '2025-01-01 00:00:00',
    });
    // After toggle, return updated task
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.getScheduledTaskById.mockReturnValueOnce({
      id: 'sched-1',
      user_id: 'u1',
      cron_expression: '0 9 * * *',
      task_prompt: 'test',
      enabled: 1,
      last_run_at: null,
      next_run_at: '2025-01-02 09:00:00',
      created_at: '2025-01-01 00:00:00',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    }).mockReturnValueOnce({
      id: 'sched-1',
      user_id: 'u1',
      cron_expression: '0 9 * * *',
      task_prompt: 'test',
      enabled: 0,
      last_run_at: null,
      next_run_at: null,
      created_at: '2025-01-01 00:00:00',
    });

    const res = await request(port, 'POST', `/api/schedules/sched-1/toggle?token=${TOKEN}`);
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(db.adminToggleScheduledTask).toHaveBeenCalledWith('sched-1', false);
  });

  it('POST /api/schedules/:id/toggle returns 404 for unknown task', async () => {
    const res = await request(port, 'POST', `/api/schedules/unknown/toggle?token=${TOKEN}`);
    expect(res.status).toBe(404);
  });

  // ---- Schedule delete ----

  it('DELETE /api/schedules/:id deletes a scheduled task', async () => {
    const res = await request(port, 'DELETE', `/api/schedules/sched-1?token=${TOKEN}`);
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(db.adminDeleteScheduledTask).toHaveBeenCalledWith('sched-1');
  });

  // ---- Skill toggle ----

  it('POST /api/skills/:name/toggle toggles a skill', async () => {
    const res = await request(port, 'POST', `/api/skills/web-search/toggle?token=${TOKEN}`);
    expect(res.status).toBe(200);
    // It was enabled, so disableSkill should be called
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(skillRegistry.disableSkill).toHaveBeenCalledWith('web-search');
  });

  it('POST /api/skills/:name/toggle returns 404 for unknown skill', async () => {
    const res = await request(port, 'POST', `/api/skills/nonexistent/toggle?token=${TOKEN}`);
    expect(res.status).toBe(404);
  });

  // ---- 404 ----

  it('returns 404 for unknown route', async () => {
    const res = await request(port, 'GET', `/api/unknown?token=${TOKEN}`);
    expect(res.status).toBe(404);
  });

  // ---- Partial endpoints ----

  it('GET /api/schedules returns scheduled task rows', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.getAllScheduledTasks.mockReturnValue([
      {
        id: 's1',
        user_id: 'u1',
        cron_expression: '0 9 * * *',
        task_prompt: 'Morning report',
        enabled: 1,
        last_run_at: null,
        next_run_at: '2025-01-02 09:00:00',
        created_at: '2025-01-01',
      },
    ]);
    const res = await request(port, 'GET', `/api/schedules?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Morning report');
  });

  it('GET /api/skills returns skill rows', async () => {
    const res = await request(port, 'GET', `/api/skills?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('web-search');
  });

  it('GET /api/credentials returns credential rows', async () => {
    const res = await request(port, 'GET', `/api/credentials?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('anthropic');
  });
});
