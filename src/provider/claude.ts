import Anthropic from '@anthropic-ai/sdk';
import type {
  IProvider,
  ChatParams,
  ChatResponse,
  ChatChunk,
  ContentBlock,
  ITool,
} from './types.js';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-3-5-20250929': { input: 1.0, output: 5.0 },
  'claude-opus-4-20250929': { input: 15.0, output: 75.0 },
};

export class ClaudeProvider implements IProvider {
  readonly name = 'claude';
  private client: Anthropic;

  constructor(options?: { baseURL?: string; apiKey?: string }) {
    this.client = new Anthropic({
      ...(options?.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options?.apiKey ? { apiKey: options.apiKey } : {}),
    });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const systemPrompt = this.buildSystemPrompt(params);
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: this.toAnthropicMessages(params.messages),
      ...(params.tools && params.tools.length > 0
        ? { tools: params.tools as Anthropic.Tool[] }
        : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    });

    return {
      content: response.content as ContentBlock[],
      stopReason: response.stop_reason as ChatResponse['stopReason'],
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
    };
  }

  async *stream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const systemPrompt = this.buildSystemPrompt(params);
    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: this.toAnthropicMessages(params.messages),
      ...(params.tools && params.tools.length > 0
        ? { tools: params.tools as Anthropic.Tool[] }
        : {}),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          yield { type: 'tool_use_start', toolName: block.name, toolId: block.id };
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text_delta', text: delta.text };
        } else if (delta.type === 'input_json_delta') {
          yield { type: 'tool_input_delta', partialJson: delta.partial_json };
        }
      } else if (event.type === 'content_block_stop') {
        yield { type: 'block_stop' };
      } else if (event.type === 'message_stop') {
        yield { type: 'message_stop' };
      }
    }
  }

  toolDefinitions(tools: ITool[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.schema as Anthropic.Tool.InputSchema,
    }));
  }

  estimateCost(inputTokens: number, outputTokens: number, model: string): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return 0;
    return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  }

  private toAnthropicMessages(messages: ChatParams['messages']): Anthropic.MessageParam[] {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
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

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}
