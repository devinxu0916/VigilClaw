import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VigilClawDB } from '../../src/db.js';
import { CostGuard } from '../../src/cost-guard.js';
import { Orchestrator, passesHeuristicGate, parsePlan } from '../../src/orchestrator.js';
import type { IProvider } from '../../src/provider/types.js';
import type { QueuedTask } from '../../src/types.js';
import type { TaskExecutor, SubAgentInput, SubAgentResult } from '../../src/orchestration-types.js';

const COMPLEX_TEXT =
  '请分别调研 A、B、C 三个库的优劣，给出代码示例，并最后汇总成一个对比表格供我参考';

function chatResponse(text: string): unknown {
  return {
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage: { inputTokens: 50, outputTokens: 20 },
    model: 'claude-haiku-4-5-20251001',
  };
}

function makeHaikuProvider(responses: string[]): IProvider {
  const chat = vi.fn();
  for (const r of responses) chat.mockResolvedValueOnce(chatResponse(r));
  return {
    name: 'anthropic',
    chat,
    estimateCost: vi.fn().mockReturnValue(0.0001),
    stream: vi.fn(),
    toolDefinitions: vi.fn(),
  } as unknown as IProvider;
}

function makeUserProvider(synthText = '最终综合结果', shouldFail = false): IProvider {
  return {
    name: 'claude',
    chat: shouldFail
      ? vi.fn().mockRejectedValue(new Error('synth down'))
      : vi.fn().mockResolvedValue(chatResponse(synthText)),
    estimateCost: vi.fn().mockReturnValue(0.01),
    stream: vi.fn(),
    toolDefinitions: vi.fn(),
  } as unknown as IProvider;
}

interface MockExecutor {
  executor: TaskExecutor;
  calls: SubAgentInput[];
  peak: () => number;
}

function makeExecutor(): MockExecutor {
  const calls: SubAgentInput[] = [];
  let active = 0;
  let peak = 0;
  const executor: TaskExecutor = {
    execute: vi.fn(async (input: SubAgentInput): Promise<SubAgentResult> => {
      calls.push(input);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return {
        subId: input.subId,
        content: `result-of-${input.subId}`,
        usage: { inputTokens: 10, outputTokens: 5 },
        model: input.model,
        success: true,
      };
    }),
  };
  return { executor, calls, peak: () => peak };
}

function makeTask(text: string): QueuedTask {
  return {
    id: 'task1',
    userId: 'user1',
    messages: [{ role: 'user', content: text }],
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    tools: ['bash', 'read', 'write', 'edit'],
    createdAt: new Date(),
    replyFn: vi.fn().mockResolvedValue(undefined),
  };
}

const defaultConfig = { enabled: true, maxSubtasks: 5, maxParallel: 3 };

describe('Orchestrator', () => {
  let db: VigilClawDB;
  let costGuard: CostGuard;

  beforeEach(() => {
    db = new VigilClawDB(':memory:');
    db.getOrCreateUser('user1', 'User 1');
    costGuard = new CostGuard(db);
  });

  function make(
    haiku: IProvider,
    exec: TaskExecutor,
    user: IProvider = makeUserProvider(),
    config = defaultConfig,
  ): Orchestrator {
    return new Orchestrator(db, exec, costGuard, haiku, () => Promise.resolve(user), config);
  }

  describe('heuristic gate', () => {
    it('rejects short simple messages', () => {
      expect(passesHeuristicGate('现在几点')).toBe(false);
    });
    it('passes long multi-part messages', () => {
      expect(passesHeuristicGate(COMPLEX_TEXT)).toBe(true);
    });
  });

  describe('shouldOrchestrate', () => {
    it('skips classifier for simple messages', async () => {
      const haiku = makeHaikuProvider([]);
      const orch = make(haiku, makeExecutor().executor);
      const result = await orch.shouldOrchestrate(makeTask('现在几点'));
      expect(result).toBe(false);
      expect(haiku.chat).not.toHaveBeenCalled();
    });

    it('classifies compound messages and returns true on yes', async () => {
      const haiku = makeHaikuProvider(['yes']);
      const orch = make(haiku, makeExecutor().executor);
      expect(await orch.shouldOrchestrate(makeTask(COMPLEX_TEXT))).toBe(true);
      expect(haiku.chat).toHaveBeenCalledOnce();
    });

    it('returns false on classifier no', async () => {
      const haiku = makeHaikuProvider(['no']);
      const orch = make(haiku, makeExecutor().executor);
      expect(await orch.shouldOrchestrate(makeTask(COMPLEX_TEXT))).toBe(false);
    });
  });

  describe('maybeRun', () => {
    it('returns null when disabled', async () => {
      const haiku = makeHaikuProvider(['yes']);
      const orch = make(haiku, makeExecutor().executor, makeUserProvider(), {
        ...defaultConfig,
        enabled: false,
      });
      expect(await orch.maybeRun(makeTask(COMPLEX_TEXT))).toBeNull();
      expect(haiku.chat).not.toHaveBeenCalled();
    });

    it('returns null (degrade) when classifier says no', async () => {
      const haiku = makeHaikuProvider(['no']);
      const { executor, calls } = makeExecutor();
      const orch = make(haiku, executor);
      expect(await orch.maybeRun(makeTask(COMPLEX_TEXT))).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('orchestrates: plan -> parallel subtasks -> synthesis', async () => {
      const plan = JSON.stringify([
        { id: 't1', description: '调研 A', dependsOn: [] },
        { id: 't2', description: '调研 B', dependsOn: [] },
        { id: 't3', description: '调研 C', dependsOn: [] },
      ]);
      const haiku = makeHaikuProvider(['yes', plan]);
      const { executor, calls } = makeExecutor();
      const orch = make(haiku, executor, makeUserProvider('对比表格'));

      const outcome = await orch.maybeRun(makeTask(COMPLEX_TEXT));
      expect(outcome).not.toBeNull();
      expect(outcome!.content).toBe('对比表格');
      expect(calls).toHaveLength(3);
      expect(outcome!.totalCost).toBeGreaterThan(0);
    });

    it('runs independent subtasks up to maxParallel concurrently', async () => {
      const plan = JSON.stringify([
        { id: 't1', description: 'A', dependsOn: [] },
        { id: 't2', description: 'B', dependsOn: [] },
        { id: 't3', description: 'C', dependsOn: [] },
        { id: 't4', description: 'D', dependsOn: [] },
      ]);
      const haiku = makeHaikuProvider(['yes', plan]);
      const exec = makeExecutor();
      const orch = make(haiku, exec.executor, makeUserProvider(), {
        ...defaultConfig,
        maxParallel: 2,
      });

      await orch.maybeRun(makeTask(COMPLEX_TEXT));
      expect(exec.peak()).toBeLessThanOrEqual(2);
      expect(exec.calls).toHaveLength(4);
    });

    it('waits for dependencies and injects their outputs', async () => {
      const plan = JSON.stringify([
        { id: 't1', description: 'A', dependsOn: [] },
        { id: 't2', description: 'B', dependsOn: [] },
        { id: 't3', description: '汇总', dependsOn: ['t1', 't2'] },
      ]);
      const haiku = makeHaikuProvider(['yes', plan]);
      const exec = makeExecutor();
      const orch = make(haiku, exec.executor);

      await orch.maybeRun(makeTask(COMPLEX_TEXT));

      const t3 = exec.calls.find((c) => c.subId === 't3');
      expect(t3).toBeDefined();
      expect(t3!.prompt).toContain('result-of-t1');
      expect(t3!.prompt).toContain('result-of-t2');
      // t3 must be the last to start
      expect(exec.calls[exec.calls.length - 1]!.subId).toBe('t3');
    });

    it('truncates subtasks beyond maxSubtasks', async () => {
      const plan = JSON.stringify([
        { id: 't1', description: 'A', dependsOn: [] },
        { id: 't2', description: 'B', dependsOn: [] },
        { id: 't3', description: 'C', dependsOn: [] },
      ]);
      const haiku = makeHaikuProvider(['yes', plan]);
      const exec = makeExecutor();
      const orch = make(haiku, exec.executor, makeUserProvider(), {
        ...defaultConfig,
        maxSubtasks: 2,
      });

      await orch.maybeRun(makeTask(COMPLEX_TEXT));
      expect(exec.calls).toHaveLength(2);
    });

    it('degrades to single-agent (null) for a single-subtask plan', async () => {
      const plan = JSON.stringify([{ id: 't1', description: 'only one', dependsOn: [] }]);
      const haiku = makeHaikuProvider(['yes', plan]);
      const exec = makeExecutor();
      const orch = make(haiku, exec.executor);

      expect(await orch.maybeRun(makeTask(COMPLEX_TEXT))).toBeNull();
      expect(exec.calls).toHaveLength(0);
    });

    it('degrades to null for an empty / invalid plan', async () => {
      const haiku = makeHaikuProvider(['yes', 'not json']);
      const exec = makeExecutor();
      const orch = make(haiku, exec.executor);
      expect(await orch.maybeRun(makeTask(COMPLEX_TEXT))).toBeNull();
    });

    it('falls back to concatenation when synthesis fails', async () => {
      const plan = JSON.stringify([
        { id: 't1', description: 'A', dependsOn: [] },
        { id: 't2', description: 'B', dependsOn: [] },
      ]);
      const haiku = makeHaikuProvider(['yes', plan]);
      const exec = makeExecutor();
      const orch = make(haiku, exec.executor, makeUserProvider('x', true));

      const outcome = await orch.maybeRun(makeTask(COMPLEX_TEXT));
      expect(outcome).not.toBeNull();
      expect(outcome!.content).toContain('result-of-t1');
      expect(outcome!.content).toContain('result-of-t2');
    });

    it('does not orchestrate when over budget', async () => {
      db.updateUserBudget('user1', 0, 0); // zero budget => exceeded
      const haiku = makeHaikuProvider(['yes']);
      const exec = makeExecutor();
      const orch = make(haiku, exec.executor);

      const outcome = await orch.maybeRun(makeTask(COMPLEX_TEXT));
      expect(outcome).not.toBeNull();
      expect(outcome!.content).toContain('预算');
      expect(exec.calls).toHaveLength(0);
    });

    it('records an api_call for every orchestration LLM call', async () => {
      const plan = JSON.stringify([
        { id: 't1', description: 'A', dependsOn: [] },
        { id: 't2', description: 'B', dependsOn: [] },
        { id: 't3', description: 'C', dependsOn: [] },
      ]);
      const haiku = makeHaikuProvider(['yes', plan]);
      const exec = makeExecutor();
      const orch = make(haiku, exec.executor);

      await orch.maybeRun(makeTask(COMPLEX_TEXT));
      // classify + plan + 3 subtasks + synthesis = 6
      expect(db.getOverviewStats().todayCalls).toBe(6);
    });
  });

  describe('parsePlan', () => {
    it('parses a JSON array of subtasks', () => {
      const out = parsePlan('[{"id":"t1","description":"do X","dependsOn":[]}]');
      expect(out).toEqual([{ id: 't1', description: 'do X', dependsOn: [] }]);
    });
    it('tolerates code fences and prose', () => {
      const out = parsePlan('Here:\n```json\n[{"id":"a","description":"y"}]\n```');
      expect(out).toHaveLength(1);
      expect(out[0]!.dependsOn).toEqual([]);
    });
    it('returns empty on malformed output', () => {
      expect(parsePlan('nope')).toEqual([]);
    });
  });
});
