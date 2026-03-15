import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider, calculateOpenAICost } from '../../src/provider/openai.js';
import type { ITool } from '../../src/provider/types.js';

const openaiMock = vi.hoisted(() => {
  const create = vi.fn();
  let lastOptions: { apiKey?: string; baseURL?: string } | undefined;

  class MockOpenAI {
    chat: { completions: { create: typeof create } };

    constructor(options: { apiKey?: string; baseURL?: string }) {
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

describe('OpenAIProvider estimateCost', () => {
  it('should calculate costs for known models', () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });

    expect(provider.estimateCost(1_000_000, 1_000_000, 'gpt-4o')).toBeCloseTo(12.5, 6);
    expect(provider.estimateCost(2_000_000, 3_000_000, 'gpt-4o-mini')).toBeCloseTo(2.1, 6);
    expect(provider.estimateCost(100_000, 200_000, 'o4-mini')).toBeCloseTo(0.99, 6);
  });

  it('should return 0 for unknown models', () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    expect(provider.estimateCost(100, 200, 'unknown-model')).toBe(0);
  });
});

describe('calculateOpenAICost', () => {
  it('should compute pricing for known models', () => {
    expect(calculateOpenAICost('gpt-4o', 1_000_000, 1_000_000)).toBeCloseTo(12.5, 6);
    expect(calculateOpenAICost('gpt-4o-mini', 2_000_000, 3_000_000)).toBeCloseTo(2.1, 6);
  });

  it('should return 0 for unknown models', () => {
    expect(calculateOpenAICost('nope', 10, 20)).toBe(0);
  });
});

describe('OpenAIProvider toolDefinitions', () => {
  it('should map tool schema to OpenAI parameters', () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });
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
          parameters: tool.schema,
        },
      },
    ]);
  });
});

describe('OpenAIProvider chat response conversion', () => {
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
                function: { name: 'raw', arguments: '{bad' },
              },
              {
                id: 'tool-3',
                type: 'not_function',
                function: { name: 'skip', arguments: '{}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
      model: 'gpt-4o',
    };

    openaiMock.create.mockResolvedValue(response);

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    const result = await provider.chat({
      model: 'gpt-4o',
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
        { type: 'tool_use', id: 'tool-2', name: 'raw', input: { _raw: '{bad' } },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 11, outputTokens: 7 },
      model: 'gpt-4o',
    });
  });
});
