import pino from 'pino';
import type { VigilClawDB } from './db.js';
import type { GroupQueue } from './group-queue.js';

const logger = pino({ name: 'task-scheduler' });

interface DeferredTask {
  taskRecord: Record<string, unknown>;
  deferredAt: Date;
  maxDeferUntil: Date;
}

export class TaskScheduler {
  private deferredTasks = new Map<string, DeferredTask[]>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: VigilClawDB,
    private groupQueue: GroupQueue,
  ) {}

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

  private checkScheduledTasks(): void {
    const dueTasks = this.db.getDueScheduledTasks();

    for (const task of dueTasks) {
      const groupKey = (task.group_id as string | null) ?? (task.user_id as string);

      if (this.groupQueue.isGroupActive(groupKey)) {
        this.deferTask(task, groupKey);
      } else {
        this.db.updateScheduledTaskLastRun(task.id as string);
      }
    }

    this.processDeferredTasks();
  }

  private deferTask(task: Record<string, unknown>, groupKey: string): void {
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
          continue;
        }

        this.db.updateScheduledTaskLastRun(item.taskRecord.id as string);
        break;
      }

      if (remaining.length > 0) {
        this.deferredTasks.set(key, remaining);
      } else {
        this.deferredTasks.delete(key);
      }
    }
  }
}
