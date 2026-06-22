import { logger } from './logger.js';
import type { VigilClawDB } from './db.js';
import type { CostGuard } from './cost-guard.js';
import type { IProvider, ChatResponse } from './provider/types.js';
import type { QueuedTask } from './types.js';
import type { TaskExecutor, SubTask, SubAgentResult } from './orchestration-types.js';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SYNTH_MAX_TOKENS = 4096;
const SUB_AGENT_TOOLS = ['bash', 'read', 'write', 'edit'];

const CLASSIFY_SYSTEM = [
  'You decide whether a user request should be decomposed into multiple sub-tasks and run by several agents.',
  'Answer "yes" ONLY when the request clearly contains multiple distinct deliverables or independent steps that benefit from parallel/structured execution (e.g. "研究 A、B、C 并对比", "do X, then Y, then summarize").',
  'Answer "no" for simple single-step requests, questions, or chit-chat.',
  'Be conservative: when unsure, answer "no".',
  'Respond with exactly one word: yes or no.',
].join('\n');

const PLAN_SYSTEM = [
  'Decompose the user goal into a small set of concrete sub-tasks for separate agents.',
  '',
  'Output ONLY a JSON array, each item: {"id": "t1", "description": "...", "dependsOn": []}.',
  'Rules:',
  '- Each "description" is a self-contained instruction in the SAME LANGUAGE as the user.',
  '- "dependsOn" lists ids of sub-tasks whose results this one needs (empty if independent).',
  '- Prefer independent sub-tasks so they can run in parallel; add dependencies only when truly required.',
  '- Keep it minimal: only split when it genuinely helps. If the goal is simple, return [].',
  '- No prose, no code fences — just the JSON array.',
].join('\n');

const SYNTH_SYSTEM = [
  'You are combining the results of several sub-agents into one final answer for the user.',
  'Integrate the sub-task results into a coherent, complete response to the original request.',
  'Write in the SAME LANGUAGE as the original request. Do not mention the orchestration mechanism.',
].join('\n');

export interface OrchestrationConfig {
  enabled: boolean;
  maxSubtasks: number;
  maxParallel: number;
}

export interface OrchestrationOutcome {
  content: string;
  totalCost: number;
}

export class Orchestrator {
  constructor(
    private db: VigilClawDB,
    private taskExecutor: TaskExecutor,
    private costGuard: CostGuard,
    private haikuProvider: IProvider,
    private resolveProvider: (providerType: string) => Promise<IProvider>,
    private config: OrchestrationConfig,
  ) {}

  /**
   * Entry point used by the task executor. Returns an outcome when the request
   * was handled by orchestration, or null to signal the caller should run the
   * normal single-agent path.
   */
  async maybeRun(task: QueuedTask): Promise<OrchestrationOutcome | null> {
    if (!this.config.enabled) return null;

    let complex: boolean;
    try {
      complex = await this.shouldOrchestrate(task);
    } catch (err) {
      logger.warn({ err, taskId: task.id }, 'Orchestration classification failed');
      return null;
    }
    if (!complex) return null;

    return this.orchestrate(task);
  }

  /** Heuristic gate + Haiku classifier deciding whether to orchestrate. */
  async shouldOrchestrate(task: QueuedTask): Promise<boolean> {
    if (!this.config.enabled) return false;
    const text = lastUserText(task);
    if (!passesHeuristicGate(text)) return false;

    const response = await this.haikuProvider.chat({
      model: HAIKU_MODEL,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: 'user', content: text }],
      maxTokens: 8,
      temperature: 0,
    });
    this.recordCall(`orchestrate-classify:${task.id}`, task, 'anthropic', this.haikuProvider, HAIKU_MODEL, response.usage);

    const out = textOf(response).toLowerCase();
    return out.includes('yes') || out.includes('true');
  }

  private async orchestrate(task: QueuedTask): Promise<OrchestrationOutcome | null> {
    const budget = this.costGuard.checkBudget(task.userId);
    if (budget.exceeded) {
      return { content: this.costGuard.formatExceededMessage(budget), totalCost: 0 };
    }

    const goal = lastUserText(task);
    if (!goal) return null;

    let totalCost = 0;

    let subtasks: SubTask[];
    try {
      const planned = await this.plan(task, goal);
      if (!planned) return null;
      subtasks = planned.subtasks;
      totalCost += planned.cost;
    } catch (err) {
      logger.warn({ err, taskId: task.id }, 'Orchestration planning failed');
      return null;
    }
    if (subtasks.length <= 1) return null;

    void task.replyFn(`🧩 已将请求拆解为 ${subtasks.length} 个子任务，正在并行处理…`).catch(() => {
      // progress message is best-effort
    });

    const results = await this.scheduleWaves(task, subtasks, (c) => {
      totalCost += c;
    });

    const synth = await this.synthesize(task, goal, subtasks, results);
    totalCost += synth.cost;

    return { content: synth.content, totalCost };
  }

  private async plan(
    task: QueuedTask,
    goal: string,
  ): Promise<{ subtasks: SubTask[]; cost: number } | null> {
    const response = await this.haikuProvider.chat({
      model: HAIKU_MODEL,
      system: PLAN_SYSTEM,
      messages: [{ role: 'user', content: goal }],
      maxTokens: 1024,
      temperature: 0.2,
    });
    const cost = this.recordCall(
      `orchestrate-plan:${task.id}`,
      task,
      'anthropic',
      this.haikuProvider,
      HAIKU_MODEL,
      response.usage,
    );

    const subtasks = parsePlan(textOf(response)).slice(0, this.config.maxSubtasks);
    if (subtasks.length === 0) return null;
    return { subtasks, cost };
  }

  private async scheduleWaves(
    task: QueuedTask,
    subtasks: SubTask[],
    addCost: (cost: number) => void,
  ): Promise<Map<string, SubAgentResult>> {
    const byId = new Map(subtasks.map((s) => [s.id, s]));
    const remaining = new Set(subtasks.map((s) => s.id));
    const done = new Map<string, SubAgentResult>();
    const userProvider = await this.resolveProvider(task.provider);

    while (remaining.size > 0) {
      let ready = [...remaining].filter((id) => {
        const st = byId.get(id);
        return st ? st.dependsOn.every((d) => done.has(d) || !byId.has(d)) : false;
      });
      // Break dependency cycles / unresolved refs by running the rest as-is.
      if (ready.length === 0) ready = [...remaining];

      await runPool(ready, this.config.maxParallel, async (id) => {
        const st = byId.get(id);
        if (!st) return;
        const prompt = composePrompt(task, byId, st, done);
        const res = await this.taskExecutor.execute({
          taskId: task.id,
          subId: st.id,
          userId: task.userId,
          groupId: task.groupId,
          provider: task.provider,
          model: task.model,
          prompt,
          tools: SUB_AGENT_TOOLS,
        });
        const cost = this.recordCall(
          `orchestrate-sub:${task.id}:${st.id}`,
          task,
          task.provider,
          userProvider,
          res.model,
          res.usage,
        );
        addCost(cost);
        done.set(id, res);
      });

      for (const id of ready) remaining.delete(id);
    }

    return done;
  }

  private async synthesize(
    task: QueuedTask,
    goal: string,
    subtasks: SubTask[],
    results: Map<string, SubAgentResult>,
  ): Promise<{ content: string; cost: number }> {
    const sections = subtasks
      .map((st) => {
        const r = results.get(st.id);
        const body =
          r && r.success && r.content
            ? r.content
            : r?.error
              ? `（失败：${r.error}）`
              : '（无输出）';
        return `【${st.description}】\n${body}`;
      })
      .join('\n\n');

    try {
      const provider = await this.resolveProvider(task.provider);
      const response = await provider.chat({
        model: task.model,
        system: SYNTH_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `原始请求：${goal}\n\n各子任务结果：\n\n${sections}\n\n请综合以上结果，完整回答原始请求。`,
          },
        ],
        maxTokens: SYNTH_MAX_TOKENS,
      });
      const cost = this.recordCall(
        `orchestrate-synth:${task.id}`,
        task,
        task.provider,
        provider,
        task.model,
        response.usage,
      );
      const content = textOf(response) || sections;
      return { content, cost };
    } catch (err) {
      logger.warn({ err, taskId: task.id }, 'Orchestration synthesis failed, concatenating outputs');
      return { content: `（综合失败，直接汇总各子任务结果）\n\n${sections}`, cost: 0 };
    }
  }

  private recordCall(
    taskId: string,
    task: QueuedTask,
    providerName: string,
    estimator: IProvider,
    model: string,
    usage: { inputTokens: number; outputTokens: number },
  ): number {
    const cost = estimator.estimateCost(usage.inputTokens, usage.outputTokens, model);
    this.db.recordApiCall({
      taskId,
      userId: task.userId,
      groupId: task.groupId,
      provider: providerName,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
    });
    return cost;
  }
}

// ---- helpers ----

function lastUserText(task: QueuedTask): string {
  const m = [...task.messages].reverse().find((msg) => msg.role === 'user');
  return m?.content ?? '';
}

function textOf(response: ChatResponse): string {
  const block = response.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text.trim() : '';
}

/** Zero-cost gate: only longer, multi-part messages reach the classifier. */
export function passesHeuristicGate(text: string): boolean {
  if (text.length < 40) return false;
  if (text.length > 200) return true;
  const signals =
    /然后|接着|分别|并且|，并|依次|步骤|对比|汇总|多个|、.+、|\band\b|\bthen\b|after that|compare|summari[sz]e|step by step/i;
  return signals.test(text);
}

export function parsePlan(text: string): SubTask[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SubTask[] = [];
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const description = typeof o.description === 'string' ? o.description.trim() : '';
        if (!description) continue;
        const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `t${out.length + 1}`;
        const dependsOn = Array.isArray(o.dependsOn)
          ? o.dependsOn.filter((d): d is string => typeof d === 'string')
          : [];
        out.push({ id, description, dependsOn });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function composePrompt(
  task: QueuedTask,
  byId: Map<string, SubTask>,
  st: SubTask,
  done: Map<string, SubAgentResult>,
): string {
  const parts = [`总体目标：${lastUserText(task)}`, '', `你的子任务：${st.description}`];
  const deps = st.dependsOn.filter((d) => done.has(d));
  if (deps.length > 0) {
    parts.push('', '已完成的前置子任务结果：');
    for (const d of deps) {
      const r = done.get(d);
      if (r) parts.push(`【${byId.get(d)?.description ?? d}】\n${r.content}`);
    }
  }
  parts.push('', '请只完成你的子任务，给出简洁、可被后续汇总使用的结果。');
  return parts.join('\n');
}

/** Run `worker` over `items` with at most `limit` concurrent executions. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let idx = 0;
  const runNext = async (): Promise<void> => {
    const i = idx++;
    if (i >= items.length) return;
    await worker(items[i]!);
    await runNext();
  };
  const n = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: n }, () => runNext()));
}
