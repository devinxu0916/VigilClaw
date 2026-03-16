import type { QueuedTask, TaskResult } from './types.js';

export interface IRunner {
  runTask(task: QueuedTask): Promise<TaskResult>;
  drainAll(timeoutMs: number): Promise<void>;
  ping(): Promise<boolean>;
}
