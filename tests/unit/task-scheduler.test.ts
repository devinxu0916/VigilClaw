import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskScheduler } from '../../src/task-scheduler.js';
import { VigilClawDB } from '../../src/db.js';
import { GroupQueue } from '../../src/group-queue.js';
import type { ChannelRegistry } from '../../src/task-scheduler.js';
import type { QueuedTask } from '../../src/types.js';

/**
 * Helper to invoke the private checkScheduledTasks() method.
 * This avoids needing to wait for the 30s setInterval in tests.
 */
function triggerCheck(scheduler: TaskScheduler): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  (scheduler as any).checkScheduledTasks();
}

/** Format a Date as SQLite-compatible datetime string (UTC). */
function toSqliteDatetime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

describe('TaskScheduler', () => {
  let db: VigilClawDB;
  let groupQueue: GroupQueue;
  let scheduler: TaskScheduler;

  beforeEach(() => {
    db = new VigilClawDB(':memory:');
    groupQueue = new GroupQueue(5);
    scheduler = new TaskScheduler(db, groupQueue);
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('computeNextRun', () => {
    it('should compute next run for valid cron', () => {
      const result = TaskScheduler.computeNextRun('0 9 * * *');
      expect(result).not.toBeNull();
      expect(new Date(result!).getTime()).toBeGreaterThan(Date.now());
    });

    it('should compute next run for every-5-minutes cron', () => {
      const result = TaskScheduler.computeNextRun('*/5 * * * *');
      expect(result).not.toBeNull();
      const nextDate = new Date(result!);
      // Should be within the next 5 minutes
      expect(nextDate.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
    });

    it('should return null for invalid cron', () => {
      expect(TaskScheduler.computeNextRun('invalid')).toBeNull();
      expect(TaskScheduler.computeNextRun('99 99 99 99 99')).toBeNull();
    });
  });

  describe('createTask', () => {
    it('should insert task into DB and return ID', () => {
      db.getOrCreateUser('u1', 'Test');

      const taskId = scheduler.createTask({
        userId: 'u1',
        cronExpression: '0 9 * * *',
        taskPrompt: '总结今日待办',
      });

      expect(taskId).not.toBeNull();
      expect(typeof taskId).toBe('string');

      const tasks = db.listScheduledTasks('u1');
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.cron_expression).toBe('0 9 * * *');
      expect(tasks[0]!.task_prompt).toBe('总结今日待办');
      expect(tasks[0]!.next_run_at).not.toBeNull();
      expect(tasks[0]!.enabled).toBe(1);
    });

    it('should set correct group_id', () => {
      db.getOrCreateUser('u1', 'Test');

      scheduler.createTask({
        userId: 'u1',
        groupId: 'g1',
        cronExpression: '*/10 * * * *',
        taskPrompt: '检查系统状态',
      });

      const tasks = db.listScheduledTasks('u1');
      expect(tasks[0]!.group_id).toBe('g1');
    });

    it('should return null for invalid cron', () => {
      db.getOrCreateUser('u1', 'Test');

      const taskId = scheduler.createTask({
        userId: 'u1',
        cronExpression: 'not-a-cron',
        taskPrompt: 'test',
      });

      expect(taskId).toBeNull();
      expect(db.listScheduledTasks('u1')).toHaveLength(0);
    });
  });

  describe('scheduled task execution', () => {
    it('should enqueue due task to GroupQueue', async () => {
      db.getOrCreateUser('u1', 'Test');

      const enqueuedTasks: QueuedTask[] = [];
      groupQueue.setExecutor(async (task) => {
        await Promise.resolve();
        enqueuedTasks.push(task);
      });

      // Create a task
      const taskId = scheduler.createTask({
        userId: 'u1',
        cronExpression: '* * * * *', // every minute
        taskPrompt: '执行测试任务',
      });
      expect(taskId).not.toBeNull();

      // Set next_run_at to the past (SQLite datetime('now') uses real system time)
      db.updateScheduledTaskNextRun(taskId!, toSqliteDatetime(new Date(Date.now() - 60_000)));

      // Directly trigger the check
      triggerCheck(scheduler);

      // Allow microtasks to settle
      await new Promise((r) => setTimeout(r, 50));

      expect(enqueuedTasks.length).toBeGreaterThanOrEqual(1);
      expect(enqueuedTasks[0]!.userId).toBe('u1');
      expect(enqueuedTasks[0]!.messages[0]!.content).toBe('执行测试任务');

      // Verify last_run_at was updated
      const tasks = db.listScheduledTasks('u1');
      expect(tasks[0]!.last_run_at).not.toBeNull();

      // Verify next_run_at was updated (should be a valid future datetime)
      expect(tasks[0]!.next_run_at).not.toBeNull();
      // next_run_at is in SQLite datetime format (UTC without 'Z'), parse as UTC
      const nextRunTime = new Date(tasks[0]!.next_run_at! + 'Z').getTime();
      expect(nextRunTime).toBeGreaterThan(Date.now() - 10_000);
    });

    it('should defer task when group is busy', async () => {
      db.getOrCreateUser('u1', 'Test');

      // Keep group busy with a long-running task
      groupQueue.setExecutor(async () => {
        await new Promise((r) => setTimeout(r, 120_000));
      });

      // Enqueue a long-running task first to occupy the group
      groupQueue.enqueue({
        id: 'blocker',
        userId: 'u1',
        messages: [],
        provider: 'claude',
        model: 'sonnet',
        tools: [],
        createdAt: new Date(),
        replyFn: vi.fn().mockResolvedValue(undefined),
      });

      // Wait for the blocking task to start executing
      await new Promise((r) => setTimeout(r, 10));
      expect(groupQueue.isGroupActive('u1')).toBe(true);

      // Create a scheduled task
      const taskId = scheduler.createTask({
        userId: 'u1',
        cronExpression: '* * * * *',
        taskPrompt: '被阻塞的任务',
      });
      db.updateScheduledTaskNextRun(taskId!, toSqliteDatetime(new Date(Date.now() - 60_000)));

      // Trigger check — group should be active, so task should be deferred
      triggerCheck(scheduler);

      // Task should still exist
      const tasks = db.listScheduledTasks('u1');
      expect(tasks).toHaveLength(1);
    });
  });

  describe('channelRegistry', () => {
    it('should not throw when channelRegistry is not set', async () => {
      db.getOrCreateUser('u1', 'Test');

      const enqueuedTasks: QueuedTask[] = [];
      groupQueue.setExecutor(async (task) => {
        await Promise.resolve();
        enqueuedTasks.push(task);
        // Call replyFn without channelRegistry — should not throw
        await task.replyFn('test response');
      });

      const taskId = scheduler.createTask({
        userId: 'u1',
        cronExpression: '* * * * *',
        taskPrompt: '无渠道测试',
      });
      db.updateScheduledTaskNextRun(taskId!, toSqliteDatetime(new Date(Date.now() - 60_000)));

      triggerCheck(scheduler);
      await new Promise((r) => setTimeout(r, 50));

      expect(enqueuedTasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should send reply via channelRegistry with ⏰ prefix', async () => {
      db.getOrCreateUser('u1', 'Test');

      const sentMessages: Array<{ userId: string; groupId: string | null; text: string }> = [];
      const mockRegistry: ChannelRegistry = {
        sendToUser: vi.fn(
          (userId: string, groupId: string | null, text: string): Promise<void> => {
            sentMessages.push({ userId, groupId, text });
            return Promise.resolve();
          },
        ),
      };
      scheduler.setChannelRegistry(mockRegistry);

      groupQueue.setExecutor(async (task) => {
        await task.replyFn('任务完成');
      });

      const taskId = scheduler.createTask({
        userId: 'u1',
        groupId: 'g1',
        cronExpression: '* * * * *',
        taskPrompt: '定时回复测试',
      });
      db.updateScheduledTaskNextRun(taskId!, toSqliteDatetime(new Date(Date.now() - 60_000)));

      triggerCheck(scheduler);
      await new Promise((r) => setTimeout(r, 50));

      expect(sentMessages.length).toBeGreaterThanOrEqual(1);
      expect(sentMessages[0]!.userId).toBe('u1');
      expect(sentMessages[0]!.groupId).toBe('g1');
      expect(sentMessages[0]!.text).toContain('\u23F0');
      expect(sentMessages[0]!.text).toContain('任务完成');
    });
  });

  describe('DB CRUD methods', () => {
    it('should delete scheduled task with ownership check', () => {
      db.getOrCreateUser('u1', 'Test');
      db.getOrCreateUser('u2', 'Other');

      const taskId = scheduler.createTask({
        userId: 'u1',
        cronExpression: '0 9 * * *',
        taskPrompt: 'test',
      });

      // Other user cannot delete
      expect(db.deleteScheduledTask(taskId!, 'u2')).toBe(false);
      expect(db.listScheduledTasks('u1')).toHaveLength(1);

      // Owner can delete
      expect(db.deleteScheduledTask(taskId!, 'u1')).toBe(true);
      expect(db.listScheduledTasks('u1')).toHaveLength(0);
    });

    it('should enable/disable with ownership check', () => {
      db.getOrCreateUser('u1', 'Test');

      const taskId = scheduler.createTask({
        userId: 'u1',
        cronExpression: '0 9 * * *',
        taskPrompt: 'test',
      });

      // Disable
      expect(db.updateScheduledTaskEnabled(taskId!, 'u1', false)).toBe(true);
      const tasks = db.listScheduledTasks('u1');
      expect(tasks[0]!.enabled).toBe(0);

      // Re-enable
      expect(db.updateScheduledTaskEnabled(taskId!, 'u1', true)).toBe(true);
      const updated = db.listScheduledTasks('u1');
      expect(updated[0]!.enabled).toBe(1);

      // Other user cannot toggle
      expect(db.updateScheduledTaskEnabled(taskId!, 'u2', false)).toBe(false);
    });

    it('should update next_run_at', () => {
      db.getOrCreateUser('u1', 'Test');

      const taskId = scheduler.createTask({
        userId: 'u1',
        cronExpression: '0 9 * * *',
        taskPrompt: 'test',
      });

      const newTime = '2030-01-01T09:00:00.000Z';
      db.updateScheduledTaskNextRun(taskId!, newTime);

      const tasks = db.listScheduledTasks('u1');
      expect(tasks[0]!.next_run_at).toBe(newTime);
    });
  });
});
