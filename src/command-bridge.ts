import http from 'node:http';
import net from 'node:net';
import { logger } from './logger.js';
import { parseProviderModel, formatProviderModel } from './provider/factory.js';
import { TaskScheduler } from './task-scheduler.js';
import type { VigilClawDB } from './db.js';
import type { SkillRegistry } from './skill-registry.js';
import type { SessionManager } from './session-manager.js';
import type { SkillInfo, SkillToolDefinition } from './skill-types.js';

interface BridgeInstance {
  server: net.Server;
  port: number;
  taskId: string;
  userId: string;
  groupId?: string;
}

const MODEL_ALIASES: Record<string, string> = {
  sonnet: 'claude:claude-sonnet-4-5-20250929',
  haiku: 'claude:claude-haiku-3-5-20250929',
  opus: 'claude:claude-opus-4-20250929',
  gpt4o: 'openai:gpt-4o',
  'gpt4o-mini': 'openai:gpt-4o-mini',
  llama3: 'ollama:llama3.1',
  deepseek: 'ollama:deepseek-r1',
};

export class CommandBridge {
  private instances = new Map<string, BridgeInstance>();

  constructor(
    private db: VigilClawDB,
    private skillRegistry: SkillRegistry | null,
    private taskScheduler: TaskScheduler | null,
    private sessionManager: SessionManager,
    private adminUsers: Set<string>,
  ) {}

  async createBridgeForTask(taskId: string, userId: string, groupId?: string): Promise<number> {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res, taskId).catch((err: unknown) => {
        logger.error({ err, taskId }, 'CommandBridge request failed');
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'internal_error' }));
      });
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, '0.0.0.0', () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });

    this.instances.set(taskId, { server, port, taskId, userId, groupId });
    logger.debug({ taskId, port }, 'CommandBridge started');
    return port;
  }

  async destroyBridgeForTask(taskId: string): Promise<void> {
    const instance = this.instances.get(taskId);
    if (instance) {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      this.instances.delete(taskId);
    }
  }

  async destroyAll(): Promise<void> {
    await Promise.allSettled([...this.instances.keys()].map((id) => this.destroyBridgeForTask(id)));
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    instanceTaskId: string,
  ): Promise<void> {
    const instance = this.instances.get(instanceTaskId);
    if (!instance) {
      this.sendError(res, 403, 'invalid_task_id');
      return;
    }

    const body = await this.readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      this.sendError(res, 400, 'invalid_json', 'Request body must be valid JSON');
      return;
    }

    if (parsed.taskId !== instanceTaskId) {
      this.sendError(res, 403, 'invalid_task_id');
      return;
    }

    const { userId, groupId } = instance;
    const url = req.url ?? '';

    switch (url) {
      case '/system/schedule/list':
        await this.handleScheduleList(res, userId);
        break;
      case '/system/schedule/create':
        await this.handleScheduleCreate(res, userId, groupId, parsed);
        break;
      case '/system/schedule/remove':
        await this.handleScheduleRemove(res, userId, parsed);
        break;
      case '/system/schedule/enable':
        await this.handleScheduleSetEnabled(res, userId, parsed, true);
        break;
      case '/system/schedule/disable':
        await this.handleScheduleSetEnabled(res, userId, parsed, false);
        break;
      case '/system/skill/list':
        await this.handleSkillList(res);
        break;
      case '/system/skill/install':
        await this.handleSkillInstall(res, userId, parsed);
        break;
      case '/system/skill/remove':
        await this.handleSkillRemove(res, userId, parsed);
        break;
      case '/system/skill/enable':
        await this.handleSkillSetEnabled(res, userId, parsed, true);
        break;
      case '/system/skill/disable':
        await this.handleSkillSetEnabled(res, userId, parsed, false);
        break;
      case '/system/model/switch':
        await this.handleModelSwitch(res, userId, parsed);
        break;
      case '/system/budget/check':
        await this.handleBudgetCheck(res, userId);
        break;
      case '/system/budget/set':
        await this.handleBudgetSet(res, userId, parsed);
        break;
      case '/system/context/clear':
        await this.handleContextClear(res, userId, groupId);
        break;
      default:
        this.sendError(res, 404, 'not_found', `Unknown route: ${url}`);
    }
  }

  // ---- Schedule handlers ----

  private async handleScheduleList(res: http.ServerResponse, userId: string): Promise<void> {
    const tasks = this.db.listScheduledTasks(userId);
    this.sendJson(res, 200, { tasks });
  }

  private async handleScheduleCreate(
    res: http.ServerResponse,
    userId: string,
    groupId: string | undefined,
    body: Record<string, unknown>,
  ): Promise<void> {
    const cronExpression = body.cronExpression as string | undefined;
    const taskPrompt = body.taskPrompt as string | undefined;

    if (!cronExpression) {
      this.sendError(res, 400, 'missing_field', 'cronExpression is required');
      return;
    }
    if (!taskPrompt) {
      this.sendError(res, 400, 'missing_field', 'taskPrompt is required');
      return;
    }
    if (!this.taskScheduler) {
      this.sendError(res, 500, 'internal_error', 'TaskScheduler not available');
      return;
    }

    const newTaskId = this.taskScheduler.createTask({ userId, groupId, cronExpression, taskPrompt });
    if (!newTaskId) {
      this.sendError(res, 400, 'invalid_cron', `Invalid cron expression: "${cronExpression}"`);
      return;
    }
    this.sendJson(res, 200, { success: true, taskId: newTaskId });
  }

  private async handleScheduleRemove(
    res: http.ServerResponse,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const scheduleId = body.scheduleId as string | undefined;
    if (!scheduleId) {
      this.sendError(res, 400, 'missing_field', 'scheduleId is required');
      return;
    }

    const tasks = this.db.listScheduledTasks(userId);
    const match = tasks.find((t) => t.id === scheduleId || t.id.startsWith(scheduleId));
    if (!match) {
      this.sendError(res, 404, 'not_found', `No task found with id: ${scheduleId}`);
      return;
    }

    const deleted = this.db.deleteScheduledTask(match.id, userId);
    if (deleted) {
      this.sendJson(res, 200, { success: true });
    } else {
      this.sendError(res, 500, 'internal_error', 'Failed to delete task');
    }
  }

  private async handleScheduleSetEnabled(
    res: http.ServerResponse,
    userId: string,
    body: Record<string, unknown>,
    enabling: boolean,
  ): Promise<void> {
    const scheduleId = body.scheduleId as string | undefined;
    if (!scheduleId) {
      this.sendError(res, 400, 'missing_field', 'scheduleId is required');
      return;
    }

    const tasks = this.db.listScheduledTasks(userId);
    const match = tasks.find((t) => t.id === scheduleId || t.id.startsWith(scheduleId));
    if (!match) {
      this.sendError(res, 404, 'not_found', `No task found with id: ${scheduleId}`);
      return;
    }

    const updated = this.db.updateScheduledTaskEnabled(match.id, userId, enabling);
    if (!updated) {
      this.sendError(res, 500, 'internal_error', 'Failed to update task status');
      return;
    }
    if (enabling) {
      const nextRunAt = TaskScheduler.computeNextRun(match.cron_expression);
      if (nextRunAt) this.db.updateScheduledTaskNextRun(match.id, nextRunAt);
    }
    this.sendJson(res, 200, { success: true });
  }

  // ---- Skill handlers ----

  private async handleSkillList(res: http.ServerResponse): Promise<void> {
    if (!this.skillRegistry) {
      this.sendJson(res, 200, { skills: [] });
      return;
    }
    const skills = this.skillRegistry.listSkills();
    this.sendJson(res, 200, { skills });
  }

  private async handleSkillInstall(
    res: http.ServerResponse,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isAdmin(userId)) {
      this.sendError(res, 403, 'requires_admin');
      return;
    }
    if (!this.skillRegistry) {
      this.sendError(res, 500, 'internal_error', 'SkillRegistry not available');
      return;
    }
    const sourcePath = body.sourcePath as string | undefined;
    if (!sourcePath) {
      this.sendError(res, 400, 'missing_field', 'sourcePath is required');
      return;
    }
    const result = this.skillRegistry.installSkill(sourcePath, userId);
    if (result.success) {
      this.sendJson(res, 200, { success: true });
    } else {
      this.sendError(res, 400, 'install_failed', result.error);
    }
  }

  private async handleSkillRemove(
    res: http.ServerResponse,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isAdmin(userId)) {
      this.sendError(res, 403, 'requires_admin');
      return;
    }
    if (!this.skillRegistry) {
      this.sendError(res, 500, 'internal_error', 'SkillRegistry not available');
      return;
    }
    const skillName = body.skillName as string | undefined;
    if (!skillName) {
      this.sendError(res, 400, 'missing_field', 'skillName is required');
      return;
    }
    const result = this.skillRegistry.removeSkill(skillName);
    if (result.success) {
      this.sendJson(res, 200, { success: true });
    } else {
      this.sendError(res, 404, 'not_found', result.error);
    }
  }

  private async handleSkillSetEnabled(
    res: http.ServerResponse,
    userId: string,
    body: Record<string, unknown>,
    enabling: boolean,
  ): Promise<void> {
    if (!this.isAdmin(userId)) {
      this.sendError(res, 403, 'requires_admin');
      return;
    }
    if (!this.skillRegistry) {
      this.sendError(res, 500, 'internal_error', 'SkillRegistry not available');
      return;
    }
    const skillName = body.skillName as string | undefined;
    if (!skillName) {
      this.sendError(res, 400, 'missing_field', 'skillName is required');
      return;
    }
    const result = enabling
      ? this.skillRegistry.enableSkill(skillName)
      : this.skillRegistry.disableSkill(skillName);
    if (result.success) {
      this.sendJson(res, 200, { success: true });
    } else {
      this.sendError(res, 404, 'not_found', result.error);
    }
  }

  // ---- Other system handlers ----

  private async handleModelSwitch(
    res: http.ServerResponse,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const modelInput = body.model as string | undefined;
    if (!modelInput) {
      this.sendError(res, 400, 'missing_field', 'model is required');
      return;
    }
    const resolved = MODEL_ALIASES[modelInput.toLowerCase()] ?? modelInput;
    const { provider, model } = parseProviderModel(resolved);
    const fullModel = formatProviderModel(provider, model);
    this.db.getOrCreateUser(userId, userId);
    this.db.updateUserModel(userId, fullModel);
    logger.info({ userId, model: fullModel }, 'User model switched via CommandBridge');
    this.sendJson(res, 200, { success: true, model: fullModel });
  }

  private async handleBudgetCheck(res: http.ServerResponse, userId: string): Promise<void> {
    const user = this.db.getUser(userId);
    const dayCost = this.db.getUserDayCost(userId);
    const monthCost = this.db.getUserMonthCost(userId);
    this.sendJson(res, 200, {
      dayCost,
      monthCost,
      dayBudget: user?.maxCostPerDay ?? 10.0,
      monthBudget: user?.maxCostPerMonth ?? 100.0,
    });
  }

  private async handleBudgetSet(
    res: http.ServerResponse,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const dayLimit = body.dayLimit as number | undefined;
    const monthLimit = body.monthLimit as number | undefined;

    if (dayLimit === undefined || typeof dayLimit !== 'number' || isNaN(dayLimit) || dayLimit <= 0) {
      this.sendError(res, 400, 'missing_field', 'dayLimit must be a positive number');
      return;
    }
    const resolvedMonthLimit =
      monthLimit !== undefined && typeof monthLimit === 'number' && !isNaN(monthLimit) && monthLimit > 0
        ? monthLimit
        : dayLimit * 30;

    this.db.updateUserBudget(userId, dayLimit, resolvedMonthLimit);
    this.sendJson(res, 200, { success: true, dayLimit, monthLimit: resolvedMonthLimit });
  }

  private async handleContextClear(
    res: http.ServerResponse,
    userId: string,
    groupId?: string,
  ): Promise<void> {
    this.sessionManager.clearContext(userId, groupId);
    this.sendJson(res, 200, { success: true });
  }

  // ---- Helpers ----

  private isAdmin(userId: string): boolean {
    if (this.adminUsers.size === 0) return true;
    return this.adminUsers.has(userId);
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendError(
    res: http.ServerResponse,
    status: number,
    error: string,
    message?: string,
  ): void {
    this.sendJson(res, status, message !== undefined ? { error, message } : { error });
  }

  // ---- Static stub generation ----

  /**
   * Returns the content of the CJS stub index.js with placeholders replaced.
   * Placeholders: __TASK_ID__, __USER_ID__, __GROUP_ID__
   */
  static generateStubJs(taskId: string, userId: string, groupId?: string): string {
    return STUB_TEMPLATE_JS.replace('__TASK_ID__', taskId)
      .replace('__USER_ID__', userId)
      .replace('__GROUP_ID__', groupId ?? '');
  }

  // ---- Static skill info for Router ----

  static getSystemCommandsSkillInfo(): SkillInfo {
    const tools: SkillToolDefinition[] = [
      {
        name: 'system_schedule_list',
        description: '列出当前用户的所有定时任务，包括 ID、cron 表达式、任务描述、启用状态和下次执行时间。',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'system_schedule_create',
        description:
          '为当前用户创建定时任务。cron_expression 为标准 5 字段 cron（分 时 日 月 周），例如：' +
          '每天早9点="0 9 * * *"，每周一早9点="0 9 * * 1"，每5分钟="*/5 * * * *"。' +
          'task_prompt 为任务执行时发送给 AI 的提示词。',
        input_schema: {
          type: 'object',
          properties: {
            cron_expression: { type: 'string', description: '标准 5 字段 cron 表达式' },
            task_prompt: { type: 'string', description: '定时执行的任务描述' },
          },
          required: ['cron_expression', 'task_prompt'],
        },
      },
      {
        name: 'system_schedule_remove',
        description: '删除指定的定时任务。schedule_id 可以是完整 UUID 或其前缀（至少 4 位）。',
        input_schema: {
          type: 'object',
          properties: {
            schedule_id: { type: 'string', description: '要删除的任务 ID 或 ID 前缀' },
          },
          required: ['schedule_id'],
        },
      },
      {
        name: 'system_schedule_enable',
        description: '启用指定的定时任务，使其在下次到期时执行。',
        input_schema: {
          type: 'object',
          properties: {
            schedule_id: { type: 'string', description: '要启用的任务 ID 或 ID 前缀' },
          },
          required: ['schedule_id'],
        },
      },
      {
        name: 'system_schedule_disable',
        description: '禁用指定的定时任务，暂停其执行但保留记录。',
        input_schema: {
          type: 'object',
          properties: {
            schedule_id: { type: 'string', description: '要禁用的任务 ID 或 ID 前缀' },
          },
          required: ['schedule_id'],
        },
      },
      {
        name: 'system_skill_list',
        description: '列出所有已安装的 Skill，包括名称、版本和启用状态。',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'system_skill_install',
        description: '安装新的 Skill（需要管理员权限）。source_path 为宿主机上 Skill 目录的绝对路径。',
        input_schema: {
          type: 'object',
          properties: {
            source_path: { type: 'string', description: 'Skill 目录的绝对路径' },
          },
          required: ['source_path'],
        },
      },
      {
        name: 'system_skill_remove',
        description: '卸载已安装的 Skill（需要管理员权限）。',
        input_schema: {
          type: 'object',
          properties: {
            skill_name: { type: 'string', description: '要卸载的 Skill 名称' },
          },
          required: ['skill_name'],
        },
      },
      {
        name: 'system_skill_enable',
        description: '启用已安装的 Skill（需要管理员权限）。',
        input_schema: {
          type: 'object',
          properties: {
            skill_name: { type: 'string', description: '要启用的 Skill 名称' },
          },
          required: ['skill_name'],
        },
      },
      {
        name: 'system_skill_disable',
        description: '禁用已安装的 Skill（需要管理员权限）。',
        input_schema: {
          type: 'object',
          properties: {
            skill_name: { type: 'string', description: '要禁用的 Skill 名称' },
          },
          required: ['skill_name'],
        },
      },
      {
        name: 'system_model_switch',
        description:
          '切换当前用户使用的 AI 模型。支持别名：sonnet、haiku、opus、gpt4o、gpt4o-mini、llama3、deepseek，' +
          '或完整模型标识如 "claude:claude-sonnet-4-5-20250929"。',
        input_schema: {
          type: 'object',
          properties: {
            model: { type: 'string', description: '模型别名或完整模型标识' },
          },
          required: ['model'],
        },
      },
      {
        name: 'system_budget_check',
        description: '查询当前用户的预算设置和今日/本月消耗情况（单位：美元）。',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'system_budget_set',
        description: '设置当前用户的日/月预算上限（单位：美元）。',
        input_schema: {
          type: 'object',
          properties: {
            day_limit: { type: 'number', description: '日预算上限（美元）' },
            month_limit: { type: 'number', description: '月预算上限（美元），省略时默认为日预算×30' },
          },
          required: ['day_limit'],
        },
      },
      {
        name: 'system_context_clear',
        description: '清空当前会话的对话上下文，开始新的对话。',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
    ];

    return {
      name: 'system-commands',
      version: '1.0.0',
      tools,
      codePath: 'built-in',
    };
  }
}

// ---- Stub template ----
// CJS module loaded inside the container via require(). Placeholders are replaced at generation time.
const STUB_TEMPLATE_JS = `
'use strict';

const TASK_ID = '__TASK_ID__';
const USER_ID = '__USER_ID__';
const GROUP_ID = '__GROUP_ID__';

function toolNameToRoute(name) {
  return '/' + name.replace(/_/g, '/');
}

function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, function(_, c) { return c.toUpperCase(); });
}

function remapParams(params) {
  const result = {};
  for (const key of Object.keys(params)) {
    result[snakeToCamel(key)] = params[key];
  }
  return result;
}

function createTool(def) {
  return {
    name: def.name,
    description: def.description,
    input_schema: def.input_schema,
    execute: async function(params) {
      const bridgeUrl = process.env.COMMAND_BRIDGE_URL;
      if (!bridgeUrl) {
        return 'Error: COMMAND_BRIDGE_URL environment variable is not set';
      }
      const route = toolNameToRoute(def.name);
      const url = bridgeUrl.replace(/\\/$/, '') + route;
      const body = Object.assign(
        { taskId: TASK_ID, userId: USER_ID, groupId: GROUP_ID || undefined },
        remapParams(params),
      );
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return 'Error: CommandBridge unavailable (' + (err instanceof Error ? err.message : String(err)) + ')';
      }
    },
  };
}

module.exports = { createTool };
`.trimStart();

