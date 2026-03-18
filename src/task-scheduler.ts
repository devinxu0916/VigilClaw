import { CronExpressionParser } from 'cron-parser';
import crypto from 'node:crypto';
import { logger } from './logger.js';
import { parseProviderModel } from './provider/factory.js';
import type { VigilClawDB } from './db.js';
import type { GroupQueue } from './group-queue.js';
import type { ScheduledTaskRow } from './types.js';

/** 渠道注册表，用于向用户发送定时任务执行结果 */
export interface ChannelRegistry {
  sendToUser(userId: string, groupId: string | null, text: string): Promise<void>;
}

interface DeferredTask {
  taskRecord: ScheduledTaskRow;
  deferredAt: Date;
  maxDeferUntil: Date;
}

export class TaskScheduler {
  private deferredTasks = new Map<string, DeferredTask[]>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private channelRegistry: ChannelRegistry | null = null;

  constructor(
    private db: VigilClawDB,
    private groupQueue: GroupQueue,
  ) {}

  setChannelRegistry(registry: ChannelRegistry): void {
    this.channelRegistry = registry;
  }

  start(): void {
    this.checkInterval = setInterval(() => {
      this.checkScheduledTasks();
    }, 30_000);
    this.checkInterval.unref();
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * 计算 cron 表达式的下次运行时间
   * @returns SQLite datetime 格式的下次运行时间（UTC），或 null（无效 cron）
   */
  static computeNextRun(cronExpression: string): string | null {
    try {
      const interval = CronExpressionParser.parse(cronExpression);
      const nextDate = interval.next().toDate();
      // Format as SQLite-compatible datetime: 'YYYY-MM-DD HH:MM:SS'
      return nextDate.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    } catch {
      return null;
    }
  }

  /**
   * 创建定时任务
   * @returns 任务 ID，或 null（cron 无效时）
   */
  createTask(params: {
    userId: string;
    groupId?: string;
    cronExpression: string;
    taskPrompt: string;
  }): string | null {
    const nextRunAt = TaskScheduler.computeNextRun(params.cronExpression);
    if (!nextRunAt) return null;

    const id = crypto.randomUUID();
    this.db.insertScheduledTask({
      id,
      userId: params.userId,
      groupId: params.groupId,
      cronExpression: params.cronExpression,
      taskPrompt: params.taskPrompt,
      nextRunAt,
    });

    logger.info(
      { taskId: id, cron: params.cronExpression, nextRunAt },
      'Scheduled task created',
    );
    return id;
  }

  private checkScheduledTasks(): void {
    const dueTasks = this.db.getDueScheduledTasks();

    for (const task of dueTasks) {
      const groupKey = task.group_id ?? task.user_id;

      if (this.groupQueue.isGroupActive(groupKey)) {
        this.deferTask(task, groupKey);
      } else {
        this.executeScheduledTask(task);
      }
    }

    this.processDeferredTasks();
  }

  private executeScheduledTask(task: ScheduledTaskRow): void {
    const user = this.db.getUser(task.user_id);
    if (!user) {
      logger.warn({ taskId: task.id, userId: task.user_id }, 'Scheduled task user not found');
      this.advanceNextRun(task);
      return;
    }

    const { provider, model } = parseProviderModel(user.currentModel);
    const taskId = crypto.randomUUID();

    this.db.insertTask({
      id: taskId,
      userId: task.user_id,
      groupId: task.group_id ?? undefined,
      inputSummary: `[scheduled] ${task.task_prompt.slice(0, 180)}`,
    });

    const replyFn = async (text: string): Promise<void> => {
      if (!this.channelRegistry) {
        logger.warn({ taskId: task.id }, 'ChannelRegistry not set, cannot send scheduled reply');
        return;
      }
      await this.channelRegistry.sendToUser(
        task.user_id,
        task.group_id,
        `\u23F0 **定时任务执行结果**\n\n${text}`,
      );
    };

    this.groupQueue.enqueue({
      id: taskId,
      userId: task.user_id,
      groupId: task.group_id ?? undefined,
      messages: [{ role: 'user', content: task.task_prompt }],
      provider,
      model,
      tools: ['bash', 'read', 'write', 'edit'],
      createdAt: new Date(),
      replyFn,
    });

    this.db.updateScheduledTaskLastRun(task.id);
    this.advanceNextRun(task);

    logger.info(
      { scheduledTaskId: task.id, executionTaskId: taskId },
      'Scheduled task enqueued',
    );
  }

  /**
   * 计算并更新下次运行时间
   */
  private advanceNextRun(task: ScheduledTaskRow): void {
    const nextRunAt = TaskScheduler.computeNextRun(task.cron_expression);
    if (nextRunAt) {
      this.db.updateScheduledTaskNextRun(task.id, nextRunAt);
    } else {
      logger.error(
        { taskId: task.id, cron: task.cron_expression },
        'Failed to compute next run, disabling task',
      );
      this.db.updateScheduledTaskEnabled(task.id, task.user_id, false);
    }
  }

  private deferTask(task: ScheduledTaskRow, groupKey: string): void {
    const deferred = this.deferredTasks.get(groupKey) ?? [];
    const maxDeferUntil = new Date(Date.now() + 3600_000);

    deferred.push({
      taskRecord: task,
      deferredAt: new Date(),
      maxDeferUntil,
    });

    this.deferredTasks.set(groupKey, deferred);
    logger.warn({ taskId: task.id, groupKey }, 'Task deferred (group busy)');
  }

  private processDeferredTasks(): void {
    const now = new Date();

    for (const [key, deferred] of this.deferredTasks) {
      if (this.groupQueue.isGroupActive(key)) continue;

      const remaining: DeferredTask[] = [];

      for (const item of deferred) {
        if (now > item.maxDeferUntil) {
          logger.warn({ taskId: item.taskRecord.id }, 'Deferred task expired (>1h)');
          this.advanceNextRun(item.taskRecord);
          continue;
        }

        this.executeScheduledTask(item.taskRecord);
      }

      if (remaining.length > 0) {
        this.deferredTasks.set(key, remaining);
      } else {
        this.deferredTasks.delete(key);
      }
    }
  }
}
