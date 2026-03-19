import OpenAI from 'openai';
import type {
  IProvider,
  ChatParams,
  ChatResponse,
  ChatChunk,
  ContentBlock,
  ITool,
} from './types.js';

export class OllamaProvider implements IProvider {
  readonly name = 'ollama';
  private client: OpenAI;

  constructor(options?: { baseUrl?: string }) {
    const baseUrl = options?.baseUrl ?? 'http://localhost:11434';
    this.client = new OpenAI({
      baseURL: `${baseUrl}/v1`,
      apiKey: 'ollama',
    });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const systemPrompt = this.buildSystemPrompt(params);
    const response = await this.client.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: this.toOpenAIMessages(params.messages),
      ...(params.tools && params.tools.length > 0
        ? { tools: params.tools as OpenAI.Chat.ChatCompletionTool[] }
        : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    });

    const content: ContentBlock[] = [];

    if (response.choices[0]?.message.content) {
      content.push({
        type: 'text',
        text: response.choices[0].message.content,
      });
    }

    if (
      response.choices[0]?.message.tool_calls &&
      response.choices[0].message.tool_calls.length > 0
    ) {
      for (const toolCall of response.choices[0].message.tool_calls) {
        if (toolCall.type === 'function') {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>,
          });
        }
      }
    }

    const stopReason = this.mapStopReason(response.choices[0]?.finish_reason ?? 'stop');

    return {
      content,
      stopReason,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      model: response.model,
    };
  }

  async *stream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const systemPrompt = this.buildSystemPrompt(params);
    const stream = await this.client.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      stream: true,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: this.toOpenAIMessages(params.messages),
      ...(params.tools && params.tools.length > 0
        ? { tools: params.tools as OpenAI.Chat.ChatCompletionTool[] }
        : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    });

    let currentToolId = '';
    let currentToolName = '';

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;

      if (delta.content) {
        yield { type: 'text_delta', text: delta.content };
      }

      if (delta.tool_calls && delta.tool_calls.length > 0) {
        for (const toolCall of delta.tool_calls) {
          if (toolCall.type === 'function') {
            if (toolCall.id && !currentToolId) {
              currentToolId = toolCall.id;
              currentToolName = toolCall.function?.name ?? '';
              yield { type: 'tool_use_start', toolName: currentToolName, toolId: currentToolId };
            }

            if (toolCall.function?.arguments) {
              yield { type: 'tool_input_delta', partialJson: toolCall.function.arguments };
            }
          }
        }
      }

      if (choice.finish_reason) {
        yield { type: 'block_stop' };
        currentToolId = '';
        currentToolName = '';
      }
    }

    yield { type: 'message_stop' };
  }

  toolDefinitions(tools: ITool[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.schemaToOpenAIParameters(tool.schema),
      },
    }));
  }

  estimateCost(): number {
    return 0;
  }

  private toOpenAIMessages(
    messages: ChatParams['messages'],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
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

  private schemaToOpenAIParameters(schema: ITool['schema']): Record<string, unknown> {
    return {
      type: 'object',
      properties: schema.properties,
      ...(schema.required ? { required: schema.required } : {}),
    };
  }

  private mapStopReason(finishReason: string | null): ChatResponse['stopReason'] {
    switch (finishReason) {
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      case 'stop':
      default:
        return 'end_turn';
    }
  }
}
