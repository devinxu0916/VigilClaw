import OpenAI from 'openai';
import type {
  IProvider,
  ChatParams,
  ChatResponse,
  ChatChunk,
  ContentBlock,
  ITool,
} from './types.js';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'o4-mini': { input: 1.1, output: 4.4 },
};

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;

export class OpenAIProvider implements IProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor(options?: { apiKey?: string; baseURL?: string }) {
    this.client = new OpenAI({
      ...(options?.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options?.baseURL ? { baseURL: options.baseURL } : {}),
    });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const systemPrompt = this.buildSystemPrompt(params);
    const messages = this.toOpenAIMessages(params.messages);
    if (systemPrompt) {
      messages.unshift({ role: 'system', content: systemPrompt });
    }

    const response = await this.client.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages,
      ...(params.tools && params.tools.length > 0 ? { tools: params.tools as OpenAITool[] } : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    });

    const choice = response.choices[0];
    if (!choice) throw new Error('No response choice from OpenAI');

    return {
      content: this.convertResponseContent(choice.message),
      stopReason: this.convertFinishReason(choice.finish_reason),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      model: response.model,
    };
  }

  async *stream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const systemPrompt = this.buildSystemPrompt(params);
    const messages = this.toOpenAIMessages(params.messages);
    if (systemPrompt) {
      messages.unshift({ role: 'system', content: systemPrompt });
    }

    const stream = await this.client.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages,
      ...(params.tools && params.tools.length > 0 ? { tools: params.tools as OpenAITool[] } : {}),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: 'text_delta', text: delta.content };
      }
      if (chunk.choices[0]?.finish_reason) {
        yield { type: 'message_stop' };
      }
    }
  }

  toolDefinitions(tools: ITool[]): OpenAITool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema as unknown as OpenAI.FunctionParameters,
      },
    }));
  }

  estimateCost(inputTokens: number, outputTokens: number, model: string): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return 0;
    return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  }

  private toOpenAIMessages(messages: ChatParams['messages']): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;
      const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
      result.push({ role, content: msg.content });
    }

    return result;
  }

  private convertResponseContent(
    message: OpenAI.Chat.Completions.ChatCompletionMessage,
  ): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    if (message.content) {
      blocks.push({ type: 'text', text: message.content });
    }

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type !== 'function') continue;
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          input = { _raw: tc.function.arguments };
        }
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    return blocks;
  }

  private convertFinishReason(reason: string | null): ChatResponse['stopReason'] {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }

  private buildSystemPrompt(params: ChatParams): string | undefined {
    const injected = params.messages.filter((m) => m.role === 'system').map((m) => m.content);
    if (params.system && injected.length > 0) {
      return params.system + '\n\n' + injected.join('\n\n');
    }
    if (injected.length > 0) {
      return injected.join('\n\n');
    }
    return params.system;
  }
}

export function calculateOpenAICost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}
