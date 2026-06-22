import type { IRunner } from './runner-types.js';
import type { TaskExecutor, SubAgentInput, SubAgentResult } from './orchestration-types.js';
import type { QueuedTask, Message } from './types.js';

const noopReply = (): Promise<void> => Promise.resolve();

/**
 * RunnerTaskExecutor — runs a sub-agent as an isolated single-agent task via
 * the existing IRunner. Sub-agents get only base tools, no skills, and a no-op
 * replyFn (their output returns to the Orchestrator, not the user).
 */
export class RunnerTaskExecutor implements TaskExecutor {
  constructor(private runner: IRunner) {}

  async execute(input: SubAgentInput): Promise<SubAgentResult> {
    const messages: Message[] = input.messages ?? [
      { role: 'user', content: input.prompt ?? '' },
    ];

    const task: QueuedTask = {
      id: `${input.taskId}-${input.subId}`,
      userId: input.userId,
      groupId: input.groupId,
      messages,
      provider: input.provider,
      model: input.model,
      tools: input.tools,
      createdAt: new Date(),
      replyFn: noopReply,
    };

    try {
      const result = await this.runner.runTask(task);
      return {
        subId: input.subId,
        content: result.response.content,
        usage: result.response.usage,
        model: result.response.model,
        success: result.success,
        error: result.error,
      };
    } catch (err) {
      return {
        subId: input.subId,
        content: '',
        usage: { inputTokens: 0, outputTokens: 0 },
        model: input.model,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
