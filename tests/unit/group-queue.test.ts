import { describe, it, expect, vi } from 'vitest';
import { GroupQueue } from '../../src/group-queue.js';

describe('GroupQueue', () => {
  function makeTask(id: string, userId: string, groupId?: string) {
    return {
      id,
      userId,
      groupId,
      messages: [],
      model: 'claude-sonnet',
      tools: [],
      createdAt: new Date(),
      replyFn: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('should process tasks', async () => {
    const queue = new GroupQueue(5);
    const executed: string[] = [];

    queue.setExecutor(async (task) => {
      executed.push(task.id);
      await new Promise((r) => setTimeout(r, 10));
    });

    queue.enqueue(makeTask('t1', 'u1'));
    queue.enqueue(makeTask('t2', 'u2'));

    await new Promise((r) => setTimeout(r, 100));
    expect(executed).toContain('t1');
    expect(executed).toContain('t2');
  });

  it('should serialize tasks within same group', async () => {
    const queue = new GroupQueue(5);
    const order: string[] = [];

    queue.setExecutor(async (task) => {
      order.push(`start-${task.id}`);
      await new Promise((r) => setTimeout(r, 30));
      order.push(`end-${task.id}`);
    });

    queue.enqueue(makeTask('t1', 'u1', 'g1'));
    queue.enqueue(makeTask('t2', 'u2', 'g1'));

    await new Promise((r) => setTimeout(r, 200));
    expect(order.indexOf('end-t1')).toBeLessThan(order.indexOf('start-t2'));
  });

  it('should respect max concurrent limit', async () => {
    const queue = new GroupQueue(1);
    let concurrentNow = 0;
    let maxConcurrent = 0;

    queue.setExecutor(async () => {
      concurrentNow++;
      maxConcurrent = Math.max(maxConcurrent, concurrentNow);
      await new Promise((r) => setTimeout(r, 20));
      concurrentNow--;
    });

    queue.enqueue(makeTask('t1', 'u1'));
    queue.enqueue(makeTask('t2', 'u2'));
    queue.enqueue(makeTask('t3', 'u3'));

    await new Promise((r) => setTimeout(r, 200));
    expect(maxConcurrent).toBe(1);
  });

  it('should track pending and running counts', () => {
    const queue = new GroupQueue(1);
    queue.setExecutor(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    queue.enqueue(makeTask('t1', 'u1'));
    queue.enqueue(makeTask('t2', 'u2'));

    expect(queue.runningCount).toBe(1);
    expect(queue.pendingCount).toBe(1);
  });

  it('should report group as active while task runs', async () => {
    const queue = new GroupQueue(5);

    queue.setExecutor(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    queue.enqueue(makeTask('t1', 'u1', 'g1'));
    await new Promise((r) => setTimeout(r, 5));

    expect(queue.isGroupActive('g1')).toBe(true);

    await new Promise((r) => setTimeout(r, 100));
    expect(queue.isGroupActive('g1')).toBe(false);
  });
});
