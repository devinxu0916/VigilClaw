import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { TaskInput, TaskResult, Tool } from './types.js';
import { createTools } from './tools/index.js';

const MAX_TURNS = 30;

const SYSTEM_PROMPT = `You are a helpful AI assistant running inside a secure container. You can use tools to help users accomplish tasks.
When using the bash tool, be careful with destructive commands and explain what you're doing.
If a command fails, analyze the error and try a different approach.
Keep responses concise and focused.`;

function createAnthropicClient(): Anthropic {
  const proxyUrl = process.env.CREDENTIAL_PROXY_URL;
  if (proxyUrl) {
    return new Anthropic({ baseURL: proxyUrl, apiKey: 'proxy-injected' });
  }
  return new Anthropic();
}

function createOpenAIClient(): OpenAI {
  const proxyUrl = process.env.CREDENTIAL_PROXY_URL;
  if (proxyUrl) {
    return new OpenAI({ baseURL: proxyUrl, apiKey: 'proxy-injected' });
  }
  return new OpenAI();
}

function buildSystemPrompt(messages: TaskInput['messages']): string {
  const injected = messages.filter((m) => m.role === 'system').map((m) => m.content);
  return injected.length > 0 ? SYSTEM_PROMPT + '\n\n' + injected.join('\n\n') : SYSTEM_PROMPT;
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
  const provider = taskInput.provider || 'claude';
  if (provider === 'openai' || provider === 'ollama') {
    return reactLoopOpenAI(taskInput);
  }
  return reactLoopAnthropic(taskInput);
}

async function reactLoopAnthropic(taskInput: TaskInput): Promise<TaskResult> {
  const client = createAnthropicClient();
  const tools = createTools(taskInput.tools);
  const systemPrompt = buildSystemPrompt(taskInput.messages);

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
      system: systemPrompt,
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

async function reactLoopOpenAI(taskInput: TaskInput): Promise<TaskResult> {
  const client = createOpenAIClient();
  const tools = createTools(taskInput.tools);
  const systemPrompt = buildSystemPrompt(taskInput.messages);

  const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as unknown as OpenAI.FunctionParameters,
    },
  }));

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...taskInput.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.chat.completions.create({
      model: taskInput.model,
      max_tokens: taskInput.maxTokens,
      messages,
      ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
    });

    const choice = response.choices[0];
    if (!choice) break;

    totalInputTokens += response.usage?.prompt_tokens ?? 0;
    totalOutputTokens += response.usage?.completion_tokens ?? 0;

    if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
      return {
        taskId: taskInput.taskId,
        success: true,
        response: {
          content: choice.message.content ?? '',
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          model: taskInput.model,
        },
      };
    }

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      messages.push(choice.message);

      for (const tc of choice.message.tool_calls) {
        if (tc.type !== 'function') continue;
        const tool = tools.find((t) => t.name === tc.function.name);
        if (!tool) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `Error: Unknown tool "${tc.function.name}"`,
          });
          continue;
        }
        try {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {}
          const output = await tool.execute(args);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: truncateOutput(output) });
        } catch (err) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
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
