import { logger } from './logger.js';
import type { VigilClawDB } from './db.js';
import type { CostGuard } from './cost-guard.js';
import type { SessionManager } from './session-manager.js';
import type { GroupQueue } from './group-queue.js';
import type { RateLimiter } from './rate-limiter.js';
import type { IChannel } from './channels/types.js';
import type { IncomingMessage, CostReport } from './types.js';
import { encrypt } from './crypto.js';
import crypto from 'node:crypto';

export class Router {
  private channels: IChannel[] = [];
  private masterKey: Buffer | null = null;
  private adminUsers: Set<string> = new Set();

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

    const context = this.sessionManager.getContext(msg.userId, msg.groupId);
    const user = this.db.getUser(msg.userId);
    const model = user?.currentModel ?? this.defaultModel;

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

    this.groupQueue.enqueue({
      id: taskId,
      userId: msg.userId,
      groupId: msg.groupId,
      messages: context,
      model,
      tools: ['bash', 'read', 'write', 'edit'],
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

    const modelMap: Record<string, string> = {
      sonnet: 'claude-sonnet-4-5-20250929',
      haiku: 'claude-haiku-3-5-20250929',
      opus: 'claude-opus-4-20250929',
    };

    const modelKey = args[0]!.toLowerCase();
    const model = modelMap[modelKey] ?? args[0]!;
    await this.reply(msg, `✅ 模型已切换为: ${model}`);
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

  private helpText(): string {
    return [
      '🐾 **VigilClaw Commands**',
      '',
      '/cost — 查看费用报告',
      '/model [name] — 查看/切换模型 (sonnet, haiku, opus)',
      '/budget [day] [month] — 查看/设置预算',
      '/setkey <name> <value> — 设置凭证 (管理员)',
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
