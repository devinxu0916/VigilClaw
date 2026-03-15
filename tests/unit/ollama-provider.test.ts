import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider } from '../../src/provider/ollama.js';
import type { ITool } from '../../src/provider/types.js';

const openaiMock = vi.hoisted(() => {
  const create = vi.fn();
  let lastOptions: { baseURL?: string; apiKey?: string } | undefined;

  class MockOpenAI {
    chat: { completions: { create: typeof create } };

    constructor(options: { baseURL?: string; apiKey?: string }) {
      lastOptions = options;
      this.chat = { completions: { create } };
    }
  }

  return {
    MockOpenAI,
    create,
    getLastOptions: () => lastOptions,
    reset: () => {
      create.mockReset();
      lastOptions = undefined;
    },
  };
});

vi.mock('openai', () => ({ default: openaiMock.MockOpenAI }));

beforeEach(() => {
  openaiMock.reset();
});

describe('OllamaProvider estimateCost', () => {
  it('should always return 0', () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    expect(provider.estimateCost()).toBe(0);
    expect(provider.estimateCost()).toBe(0);
  });
});

describe('OllamaProvider toolDefinitions', () => {
  it('should map tool schema to OpenAI parameters', () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    const tool: ITool = {
      name: 'lookup',
      description: 'Lookup data',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
      execute: async () => 'ok',
    };

    const definitions = provider.toolDefinitions([tool]);

    expect(definitions).toEqual([
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Lookup data',
          parameters: {
            type: 'object',
            properties: tool.schema.properties,
            required: ['query'],
          },
        },
      },
    ]);
  });
});

describe('OllamaProvider constructor', () => {
  it('should set baseURL with /v1 suffix', () => {
    new OllamaProvider({ baseUrl: 'http://ollama.local:1234' });
    expect(openaiMock.getLastOptions()).toEqual({
      baseURL: 'http://ollama.local:1234/v1',
      apiKey: 'ollama',
    });
  });

  it('should default baseURL when none provided', () => {
    new OllamaProvider();
    expect(openaiMock.getLastOptions()).toEqual({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'ollama',
    });
  });
});

describe('OllamaProvider chat response conversion', () => {
  it('should convert text and tool calls into content blocks', async () => {
    const response = {
      choices: [
        {
          message: {
            content: 'Hello!',
            tool_calls: [
              {
                id: 'tool-1',
                type: 'function',
                function: { name: 'calc', arguments: '{"value":3}' },
              },
              {
                id: 'tool-2',
                type: 'function',
                function: { name: 'empty', arguments: '' },
              },
            ],
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 7 },
      model: 'llama3',
    };

    openaiMock.create.mockResolvedValue(response);

    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    const result = await provider.chat({
      model: 'llama3',
      messages: [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Hi' },
      ],
    });

    expect(openaiMock.create).toHaveBeenCalledOnce();
    expect(result).toEqual({
      content: [
        { type: 'text', text: 'Hello!' },
        { type: 'tool_use', id: 'tool-1', name: 'calc', input: { value: 3 } },
        { type: 'tool_use', id: 'tool-2', name: 'empty', input: {} },
      ],
      stopReason: 'end_turn',
      usage: { inputTokens: 5, outputTokens: 7 },
      model: 'llama3',
    });
  });
});
