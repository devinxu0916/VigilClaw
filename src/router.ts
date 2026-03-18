import { logger } from './logger.js';
import { parseProviderModel, formatProviderModel } from './provider/factory.js';
import { routeModel } from './model-router.js';
import type { VigilClawDB } from './db.js';
import type { CostGuard } from './cost-guard.js';
import type { SessionManager } from './session-manager.js';
import type { GroupQueue } from './group-queue.js';
import type { RateLimiter } from './rate-limiter.js';
import type { SkillRegistry } from './skill-registry.js';
import type { TaskScheduler } from './task-scheduler.js';
import type { RoutingConfig } from './config.js';
import type { IChannel } from './channels/types.js';
import type { IncomingMessage, CostReport } from './types.js';
import { encrypt } from './crypto.js';
import crypto from 'node:crypto';

export class Router {
  private channels: IChannel[] = [];
  private masterKey: Buffer | null = null;
  private adminUsers: Set<string> = new Set();
  private routingConfig: RoutingConfig = { enabled: false, simpleThresholdChars: 500 };
  private skillRegistry: SkillRegistry | null = null;
  private taskScheduler: TaskScheduler | null = null;

  constructor(
    private db: VigilClawDB,
    private costGuard: CostGuard,
    private sessionManager: SessionManager,
    private groupQueue: GroupQueue,
    private rateLimiter: RateLimiter,
    private defaultModel: string,
  ) {}

  setMasterKey(key: Buffer): void {
    this.masterKey = key;
  }

  setAdminUsers(users: string[]): void {
    this.adminUsers = new Set(users);
  }

  setRoutingConfig(config: RoutingConfig): void {
    this.routingConfig = config;
  }

  setSkillRegistry(registry: SkillRegistry): void {
    this.skillRegistry = registry;
  }

  setTaskScheduler(scheduler: TaskScheduler): void {
    this.taskScheduler = scheduler;
  }

  private isAdmin(userId: string): boolean {
    if (this.adminUsers.size === 0) return true;
    return this.adminUsers.has(userId);
  }

  registerChannel(channel: IChannel): void {
    this.channels.push(channel);
  }

  async handleMessage(msg: IncomingMessage): Promise<void> {
    this.db.getOrCreateUser(msg.userId, msg.userId);

    if (this.rateLimiter.isLimited(msg.userId, msg.groupId)) {
      await this.reply(msg, '⏳ 请求过于频繁，请稍后再试。');
      return;
    }

    const budgetStatus = this.costGuard.checkBudget(msg.userId);
    if (budgetStatus.exceeded) {
      await this.reply(msg, this.costGuard.formatExceededMessage(budgetStatus));
      return;
    }

    if (msg.text?.startsWith('/')) {
      await this.handleCommand(msg);
      return;
    }

    if (!msg.text && (!msg.images || msg.images.length === 0)) return;

    this.sessionManager.saveUserMessage(msg.userId, msg.groupId, msg.text ?? '[image]');

    const context = await this.sessionManager.getContext(msg.userId, msg.groupId);
    const user = this.db.getUser(msg.userId);
    const userModel = user?.currentModel ?? this.defaultModel;
    const routedModel = routeModel({
      userModel,
      messages: context,
      routingConfig: this.routingConfig,
    });
    const { provider, model } = parseProviderModel(routedModel);

    const taskId = crypto.randomUUID();
    this.db.insertTask({
      id: taskId,
      userId: msg.userId,
      groupId: msg.groupId,
      inputSummary: (msg.text ?? '').slice(0, 200),
    });

    const replyFn = async (text: string): Promise<void> => {
      await this.reply(msg, text);
    };

    const enabledSkills = this.skillRegistry?.getEnabledSkillInfos() ?? [];

    this.groupQueue.enqueue({
      id: taskId,
      userId: msg.userId,
      groupId: msg.groupId,
      messages: context,
      provider,
      model,
      tools: ['bash', 'read', 'write', 'edit'],
      skills: enabledSkills.length > 0 ? enabledSkills : undefined,
      createdAt: new Date(),
      replyFn,
    });
  }

  private async handleCommand(msg: IncomingMessage): Promise<void> {
    const text = msg.text ?? '';
    const [cmd, ...args] = text.split(' ');

    switch (cmd) {
      case '/cost':
        await this.handleCostCommand(msg);
        break;
      case '/model':
        await this.handleModelCommand(msg, args);
        break;
      case '/clear':
        this.sessionManager.clearContext(msg.userId, msg.groupId);
        await this.reply(msg, '✅ 上下文已清空。');
        break;
      case '/budget':
        await this.handleBudgetCommand(msg, args);
        break;
      case '/setkey':
        await this.handleSetKeyCommand(msg, args);
        break;
      case '/skill':
        await this.handleSkillCommand(msg, args);
        break;
      case '/schedule':
        await this.handleScheduleCommand(msg, args);
        break;
      case '/help':
        await this.reply(msg, this.helpText());
        break;
      case '/start':
        await this.reply(msg, '👋 Welcome to VigilClaw! Send /help for available commands.');
        break;
      default:
        await this.reply(msg, `未知命令: ${cmd}\n发送 /help 查看可用命令。`);
    }
  }

  private async handleCostCommand(msg: IncomingMessage): Promise<void> {
    const report = this.db.getCostReport(msg.userId);
    await this.reply(msg, formatCostReport(report));
  }

  private async handleModelCommand(msg: IncomingMessage, args: string[]): Promise<void> {
    if (args.length === 0) {
      const user = this.db.getUser(msg.userId);
      await this.reply(msg, `当前模型: ${user?.currentModel ?? this.defaultModel}`);
      return;
    }

    if (args[0] === 'list') {
      const lines = [
        '📋 **可用模型**\n',
        '**Claude:**',
        '  sonnet → claude-sonnet-4-5-20250929',
        '  haiku → claude-haiku-3-5-20250929',
        '  opus → claude-opus-4-20250929',
        '',
        '**OpenAI:**',
        '  gpt4o → openai:gpt-4o',
        '  gpt4o-mini → openai:gpt-4o-mini',
        '',
        '**Ollama (本地):**',
        '  llama3 → ollama:llama3.1',
        '  deepseek → ollama:deepseek-r1',
        '',
        '用法: /model <别名或provider:model>',
      ];
      await this.reply(msg, lines.join('\n'));
      return;
    }

    const modelMap: Record<string, string> = {
      sonnet: 'claude:claude-sonnet-4-5-20250929',
      haiku: 'claude:claude-haiku-3-5-20250929',
      opus: 'claude:claude-opus-4-20250929',
      gpt4o: 'openai:gpt-4o',
      'gpt4o-mini': 'openai:gpt-4o-mini',
      llama3: 'ollama:llama3.1',
      deepseek: 'ollama:deepseek-r1',
    };

    const modelKey = args[0]!.toLowerCase();
    const resolved = modelMap[modelKey] ?? args[0]!;
    const { provider, model } = parseProviderModel(resolved);
    const fullModel = formatProviderModel(provider, model);

    this.db.getOrCreateUser(msg.userId, msg.userId);
    this.db.updateUserModel(msg.userId, fullModel);
    logger.info({ userId: msg.userId, provider, model }, 'User model updated');
    await this.reply(msg, `✅ 模型已切换为: ${fullModel}`);
  }

  private async handleBudgetCommand(msg: IncomingMessage, args: string[]): Promise<void> {
    if (args.length === 0) {
      const user = this.db.getUser(msg.userId);
      const dayCost = this.db.getUserDayCost(msg.userId);
      const monthCost = this.db.getUserMonthCost(msg.userId);
      const dayBudget = user?.maxCostPerDay ?? 10.0;
      const monthBudget = user?.maxCostPerMonth ?? 100.0;
      await this.reply(
        msg,
        `💰 **预算设置**\n\n日预算: $${dayBudget.toFixed(2)} (已用 $${dayCost.toFixed(2)})\n月预算: $${monthBudget.toFixed(2)} (已用 $${monthCost.toFixed(2)})`,
      );
      return;
    }

    const dayLimit = parseFloat(args[0]!);
    const monthLimit = args[1] ? parseFloat(args[1]) : dayLimit * 30;

    if (isNaN(dayLimit) || dayLimit <= 0) {
      await this.reply(msg, '❌ 无效金额。用法: /budget 20 [600]');
      return;
    }

    this.db.updateUserBudget(msg.userId, dayLimit, monthLimit);
    await this.reply(
      msg,
      `✅ 预算已更新: 日 $${dayLimit.toFixed(2)} / 月 $${monthLimit.toFixed(2)}`,
    );
  }

  private async handleSetKeyCommand(msg: IncomingMessage, args: string[]): Promise<void> {
    if (!this.isAdmin(msg.userId)) {
      await this.reply(msg, '⛔ 仅管理员可设置 API Key。');
      return;
    }

    if (args.length < 2) {
      await this.reply(
        msg,
        [
          '用法: /setkey <key_name> <value>',
          '',
          '示例:',
          '  /setkey anthropic sk-ant-xxx',
          '  /setkey anthropic.base_url https://your-proxy.com',
          '  /setkey anthropic.auth_token your-token',
          '',
          'anthropic = API Key (标准方式)',
          'anthropic.base_url = 自定义 API 地址',
          'anthropic.auth_token = 自定义认证 Token',
        ].join('\n'),
      );
      return;
    }

    if (!this.masterKey) {
      await this.reply(msg, '❌ Master Key 未配置，无法加密存储。');
      return;
    }

    const keyName = args[0]!;
    const value = args.slice(1).join(' ');
    const { encrypted, iv } = encrypt(value, this.masterKey);
    this.db.upsertCredential(keyName, encrypted, iv);

    const displayValue = keyName.includes('url') ? value : value.slice(0, 8) + '***';
    await this.reply(msg, `✅ \`${keyName}\` 已加密存储 (${displayValue})。无需重启。`);
  }

  private async handleSkillCommand(msg: IncomingMessage, args: string[]): Promise<void> {
    if (!this.skillRegistry) {
      await this.reply(msg, '❌ Skill 系统未启用。');
      return;
    }

    const subCmd = args[0]?.toLowerCase();

    if (!subCmd || subCmd === 'list') {
      const skills = this.skillRegistry.listSkills();
      if (skills.length === 0) {
        await this.reply(msg, '📋 没有已安装的 Skill。\n使用 `/skill install <路径>` 安装。');
        return;
      }
      const lines = skills.map(
        (s) =>
          `${s.enabled ? '✅' : '⏸️'} **${s.name}** v${s.version}${s.description ? ` — ${s.description}` : ''}`,
      );
      await this.reply(msg, `📋 **已安装 Skill**\n\n${lines.join('\n')}`);
      return;
    }

    if (subCmd === 'install') {
      if (!this.isAdmin(msg.userId)) {
        await this.reply(msg, '⛔ 仅管理员可安装 Skill。');
        return;
      }
      const sourcePath = args[1];
      if (!sourcePath) {
        await this.reply(msg, '❌ 用法: `/skill install <本地路径>`');
        return;
      }
      const result = this.skillRegistry.installSkill(sourcePath, msg.userId);
      if (result.success) {
        await this.reply(msg, `✅ Skill 已安装。重启后生效。`);
      } else {
        await this.reply(msg, `❌ 安装失败: ${result.error ?? '未知错误'}`);
      }
      return;
    }

    if (subCmd === 'remove') {
      if (!this.isAdmin(msg.userId)) {
        await this.reply(msg, '⛔ 仅管理员可卸载 Skill。');
        return;
      }
      const name = args[1];
      if (!name) {
        await this.reply(msg, '❌ 用法: `/skill remove <名称>`');
        return;
      }
      const result = this.skillRegistry.removeSkill(name);
      if (result.success) {
        await this.reply(msg, `✅ Skill "${name}" 已卸载。`);
      } else {
        await this.reply(msg, `❌ ${result.error ?? '未知错误'}`);
      }
      return;
    }

    if (subCmd === 'enable' || subCmd === 'disable') {
      if (!this.isAdmin(msg.userId)) {
        await this.reply(msg, '⛔ 仅管理员可管理 Skill。');
        return;
      }
      const name = args[1];
      if (!name) {
        await this.reply(msg, `❌ 用法: \`/skill ${subCmd} <名称>\``);
        return;
      }
      const result =
        subCmd === 'enable'
          ? this.skillRegistry.enableSkill(name)
          : this.skillRegistry.disableSkill(name);
      if (result.success) {
        await this.reply(msg, `✅ Skill "${name}" 已${subCmd === 'enable' ? '启用' : '禁用'}。`);
      } else {
        await this.reply(msg, `❌ ${result.error ?? '未知错误'}`);
      }
      return;
    }

    if (subCmd === 'info') {
      const name = args[1];
      if (!name) {
        await this.reply(msg, '❌ 用法: `/skill info <名称>`');
        return;
      }
      const info = this.skillRegistry.getSkillInfo(name);
      if (!info) {
        await this.reply(msg, `❌ Skill "${name}" 不存在。`);
        return;
      }
      const lines = [
        `📦 **${info.manifest.name}** v${info.manifest.version}`,
        `描述: ${info.manifest.description}`,
        `作者: ${info.manifest.author ?? '未知'}`,
        `状态: ${info.enabled ? '✅ 已启用' : '⏸️ 已禁用'}`,
        `安装时间: ${info.installedAt}`,
        `权限: ${info.manifest.permissions.join(', ') || '无'}`,
        `工具: ${info.manifest.tools.map((t) => t.name).join(', ')}`,
      ];
      await this.reply(msg, lines.join('\n'));
      return;
    }

    await this.reply(
      msg,
      '❌ 未知子命令。\n用法: `/skill list|install|remove|enable|disable|info`',
    );
  }

  private async handleScheduleCommand(msg: IncomingMessage, args: string[]): Promise<void> {
    if (!this.taskScheduler) {
      await this.reply(msg, '❌ 定时任务系统未启用。');
      return;
    }

    const subCmd = args[0]?.toLowerCase();

    if (!subCmd || subCmd === 'list') {
      const tasks = this.db.listScheduledTasks(msg.userId);
      if (tasks.length === 0) {
        await this.reply(
          msg,
          '📋 没有定时任务。\n使用 `/schedule add <cron> <prompt>` 创建。',
        );
        return;
      }
      const lines = tasks.map((t) => {
        const status = t.enabled ? '✅' : '⏸️';
        const shortId = t.id.slice(0, 8);
        const nextRun = t.next_run_at ? t.next_run_at.replace('T', ' ').slice(0, 19) : '-';
        return `${status} \`${shortId}\` \`${t.cron_expression}\` → ${t.task_prompt.slice(0, 40)}${t.task_prompt.length > 40 ? '...' : ''}\n   下次: ${nextRun}`;
      });
      await this.reply(msg, `📋 **定时任务**\n\n${lines.join('\n\n')}`);
      return;
    }

    if (subCmd === 'add') {
      if (args.length < 7) {
        await this.reply(
          msg,
          '❌ 用法: `/schedule add <分> <时> <日> <月> <周> <任务描述>`\n示例: `/schedule add 0 9 * * * 总结今日待办`',
        );
        return;
      }
      const cronParts = args.slice(1, 6);
      const cronExpression = cronParts.join(' ');
      const taskPrompt = args.slice(6).join(' ');

      const taskId = this.taskScheduler.createTask({
        userId: msg.userId,
        groupId: msg.groupId,
        cronExpression,
        taskPrompt,
      });

      if (!taskId) {
        await this.reply(msg, '❌ 无效的 cron 表达式。格式: 分 时 日 月 周');
        return;
      }

      await this.reply(
        msg,
        `✅ 定时任务已创建\nID: \`${taskId.slice(0, 8)}\`\nCron: \`${cronExpression}\`\n任务: ${taskPrompt}`,
      );
      return;
    }

    if (subCmd === 'remove') {
      const idPrefix = args[1];
      if (!idPrefix) {
        await this.reply(msg, '❌ 用法: `/schedule remove <id>`');
        return;
      }
      const task = this.findTaskByPrefix(msg.userId, idPrefix);
      if (!task) {
        await this.reply(msg, `❌ 未找到 ID 前缀为 \`${idPrefix}\` 的任务。`);
        return;
      }
      const deleted = this.db.deleteScheduledTask(task.id, msg.userId);
      if (deleted) {
        await this.reply(msg, `✅ 定时任务 \`${task.id.slice(0, 8)}\` 已删除。`);
      } else {
        await this.reply(msg, `❌ 删除失败。`);
      }
      return;
    }

    if (subCmd === 'enable' || subCmd === 'disable') {
      const idPrefix = args[1];
      if (!idPrefix) {
        await this.reply(msg, `❌ 用法: \`/schedule ${subCmd} <id>\``);
        return;
      }
      const task = this.findTaskByPrefix(msg.userId, idPrefix);
      if (!task) {
        await this.reply(msg, `❌ 未找到 ID 前缀为 \`${idPrefix}\` 的任务。`);
        return;
      }
      const enabling = subCmd === 'enable';
      const updated = this.db.updateScheduledTaskEnabled(task.id, msg.userId, enabling);
      if (!updated) {
        await this.reply(msg, `❌ 操作失败。`);
        return;
      }
      if (enabling) {
        const { TaskScheduler } = await import('./task-scheduler.js');
        const nextRunAt = TaskScheduler.computeNextRun(task.cron_expression);
        if (nextRunAt) {
          this.db.updateScheduledTaskNextRun(task.id, nextRunAt);
        }
      }
      await this.reply(
        msg,
        `✅ 定时任务 \`${task.id.slice(0, 8)}\` 已${enabling ? '启用' : '禁用'}。`,
      );
      return;
    }

    await this.reply(
      msg,
      '❌ 未知子命令。\n用法: `/schedule list|add|remove|enable|disable`',
    );
  }

  private findTaskByPrefix(userId: string, prefix: string): { id: string; cron_expression: string } | null {
    const tasks = this.db.listScheduledTasks(userId);
    const match = tasks.find((t) => t.id.startsWith(prefix));
    return match ? { id: match.id, cron_expression: match.cron_expression } : null;
  }

  private helpText(): string {
    return [
      '🐾 **VigilClaw Commands**',
      '',
      '/cost — 查看费用报告',
      '/model [name] — 查看/切换模型 (sonnet, haiku, gpt4o, llama3)',
      '/model list — 列出所有可用模型',
      '/budget [day] [month] — 查看/设置预算',
      '/setkey <name> <value> — 设置凭证 (管理员)',
      '/skill list — 查看已安装 Skill',
      '/skill install <路径> — 安装 Skill (管理员)',
      '/skill remove <名称> — 卸载 Skill (管理员)',
      '/skill enable|disable <名称> — 启用/禁用 Skill',
      '/skill info <名称> — 查看 Skill 详情',
      '/schedule — 查看定时任务列表',
      '/schedule add <cron 5字段> <任务描述> — 创建定时任务',
      '/schedule remove <id> — 删除定时任务',
      '/schedule enable|disable <id> — 启用/禁用定时任务',
      '/clear — 清空对话上下文',
      '/help — 显示帮助信息',
    ].join('\n');
  }

  private async reply(msg: IncomingMessage, text: string): Promise<void> {
    for (const channel of this.channels) {
      try {
        await channel.sendMessage(msg.userId, msg.groupId, text);
        return;
      } catch (err) {
        logger.error({ err, channel: channel.name }, 'Failed to send reply');
      }
    }
  }
}

function formatCostReport(report: CostReport): string {
  const dayPercent =
    report.dayBudget > 0 ? Math.round((report.dayCost / report.dayBudget) * 100) : 0;
  const monthPercent =
    report.monthBudget > 0 ? Math.round((report.monthCost / report.monthBudget) * 100) : 0;

  let output = `📊 **费用报告**\n\n`;
  output += `今日消耗: $${report.dayCost.toFixed(2)} / $${report.dayBudget.toFixed(2)} (${dayPercent}%)\n`;
  output += `本月消耗: $${report.monthCost.toFixed(2)} / $${report.monthBudget.toFixed(2)} (${monthPercent}%)\n`;

  if (report.modelBreakdown.length > 0) {
    output += `\n📋 **模型明细 (今日)**\n`;
    for (const item of report.modelBreakdown) {
      const shortName = item.model.replace('claude-', '').replace(/-\d+$/, '');
      output += `• ${shortName}: $${item.total_cost.toFixed(2)} (${item.call_count} 次)\n`;
    }
  }

  if (report.topTasks.length > 0) {
    output += `\n🔝 **高消耗任务 (今日)**\n`;
    for (const [i, task] of report.topTasks.entries()) {
      const summary = task.input_summary?.slice(0, 30) ?? '(无摘要)';
      output += `${i + 1}. ${summary}... — $${task.total_cost_usd.toFixed(2)}\n`;
    }
  }

  if (dayPercent >= 80) {
    output += `\n⚠️ 今日预算已使用 ${dayPercent}%，接近上限！`;
  }

  return output;
}
