import pino from 'pino';
import type { ContainerRunner } from './container-runner.js';
import type { QueuedTask, TaskResult } from './types.js';

const logger = pino({ name: 'group-queue' });

export class GroupQueue {
  private queues = new Map<string, QueuedTask[]>();
  private activeGroups = new Set<string>();
  private activeCount = 0;
  private executeTaskFn: ((task: QueuedTask) => Promise<void>) | null = null;

  constructor(private maxConcurrent: number = 5) {}

  setExecutor(fn: (task: QueuedTask) => Promise<void>): void {
    this.executeTaskFn = fn;
  }

  enqueue(task: QueuedTask): void {
    const key = task.groupId ?? task.userId;
    const queue = this.queues.get(key) ?? [];
    queue.push(task);
    this.queues.set(key, queue);
    this.processNext();
  }

  isGroupActive(key: string): boolean {
    return this.activeGroups.has(key);
  }

  get pendingCount(): number {
    let count = 0;
    for (const queue of this.queues.values()) {
      count += queue.length;
    }
    return count;
  }

  get runningCount(): number {
    return this.activeCount;
  }

  private processNext(): void {
    if (this.activeCount >= this.maxConcurrent) return;
    if (!this.executeTaskFn) return;

    for (const [key, queue] of this.queues) {
      if (queue.length === 0) continue;
      if (this.activeGroups.has(key)) continue;

      const task = queue.shift()!;
      if (queue.length === 0) this.queues.delete(key);

      this.activeCount++;
      this.activeGroups.add(key);

      const executor = this.executeTaskFn;
      executor(task)
        .catch((err) => logger.error({ err, taskId: task.id }, 'Task execution failed'))
        .finally(() => {
          this.activeCount--;
          this.activeGroups.delete(key);
          this.processNext();
        });

      if (this.activeCount >= this.maxConcurrent) break;
    }
  }
}
