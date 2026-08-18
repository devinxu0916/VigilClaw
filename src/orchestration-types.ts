import type { Message } from './types.js';

/** A planned subtask in an orchestration decomposition. */
export interface SubTask {
  id: string;
  description: string;
  dependsOn: string[];
}

/** Input to a single sub-agent execution. */
export interface SubAgentInput {
  taskId: string;
  subId: string;
  userId: string;
  groupId?: string;
  provider: string;
  model: string;
  /** A composed prompt for the sub-agent (used when `messages` is absent). */
  prompt?: string;
  /** Full message list, used as-is when provided (overrides `prompt`). */
  messages?: Message[];
  tools: string[];
}

/** Result of a single sub-agent execution. */
export interface SubAgentResult {
  subId: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  success: boolean;
  error?: string;
}

/**
 * TaskExecutor — abstraction the Orchestrator depends on to run one sub-agent.
 * Decouples orchestration logic from the container runtime; the default
 * implementation (`RunnerTaskExecutor`) is backed by `IRunner`.
 */
export interface TaskExecutor {
  execute(input: SubAgentInput): Promise<SubAgentResult>;
}
