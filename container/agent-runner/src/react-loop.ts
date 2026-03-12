import Anthropic from '@anthropic-ai/sdk';
import type { TaskInput, TaskResult, Tool } from './types.js';
import { createTools } from './tools/index.js';

const MAX_TURNS = 30;

const SYSTEM_PROMPT = `You are a helpful AI assistant running inside a secure container. You can use tools to help users accomplish tasks.
When using the bash tool, be careful with destructive commands and explain what you're doing.
If a command fails, analyze the error and try a different approach.
Keep responses concise and focused.`;

function createClient(): Anthropic {
  const proxyUrl = process.env.CREDENTIAL_PROXY_URL;
  if (proxyUrl) {
    return new Anthropic({ baseURL: proxyUrl, apiKey: 'proxy-injected' });
  }
  return new Anthropic();
}

function truncateOutput(output: string, maxLen: number = 50_000): string {
  if (output.length <= maxLen) return output;
  const half = Math.floor(maxLen / 2) - 50;
  return (
    output.slice(0, half) +
    `\n\n... (truncated ${output.length - maxLen} characters) ...\n\n` +
    output.slice(-half)
  );
}

export async function reactLoop(taskInput: TaskInput): Promise<TaskResult> {
  const client = createClient();
  const tools = createTools(taskInput.tools);

  const messages: Anthropic.MessageParam[] = taskInput.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const toolDefs: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const response = await client.messages.create({
      model: taskInput.model,
      max_tokens: taskInput.maxTokens,
      system: SYSTEM_PROMPT,
      messages,
      ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
      const textContent = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      return {
        taskId: taskInput.taskId,
        success: true,
        response: {
          content: textContent,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          model: taskInput.model,
        },
      };
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const tool = tools.find((t) => t.name === block.name);
        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: Unknown tool "${block.name}"`,
            is_error: true,
          });
          continue;
        }

        try {
          const output = await tool.execute(block.input as Record<string, unknown>);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: truncateOutput(output),
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }

  return {
    taskId: taskInput.taskId,
    success: false,
    response: {
      content: 'Agent reached maximum number of tool call turns.',
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      model: taskInput.model,
    },
  };
}
