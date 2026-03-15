import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  estimateTokens,
  estimateMessagesTokens,
  ContextCompressor,
} from '../../src/context-compressor.js';
import { VigilClawDB } from '../../src/db.js';
import type { ClaudeProvider } from '../../src/provider/claude.js';
import type { Message } from '../../src/types.js';

function makeMessages(count: number, charsPer = 200): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as Message['role'],
    content: `Message ${i}: ${'x'.repeat(charsPer)}`,
  }));
}

function mockProvider(summaryText = 'Mocked summary'): ClaudeProvider {
  return {
    chat: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: summaryText }],
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: 'claude-haiku-3-5-20250929',
    }),
    estimateCost: vi.fn().mockReturnValue(0.25),
  } as unknown as ClaudeProvider;
}

describe('estimateTokens', () => {
  it('should estimate tokens from character count', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('estimateMessagesTokens', () => {
  it('should sum token estimates across messages with overhead', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'a'.repeat(40) },
      { role: 'assistant', content: 'b'.repeat(80) },
    ];
    const expected = Math.ceil(40 / 4) + 4 + Math.ceil(80 / 4) + 4;
    expect(estimateMessagesTokens(msgs)).toBe(expected);
  });

  it('should return 0 for empty array', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});

describe('ContextCompressor', () => {
  let db: VigilClawDB;
  const defaultConfig = { maxContextTokens: 200, recentMessagesKeep: 2 };

  beforeEach(() => {
    db = new VigilClawDB(':memory:');
    db.getOrCreateUser('user1', 'Test User');
  });

  it('should return messages as-is when under budget', async () => {
    const provider = mockProvider();
    const compressor = new ContextCompressor(provider, db, defaultConfig);
    const msgs: Message[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ];

    const result = await compressor.compress('session1', msgs, 'user1');
    expect(result).toEqual(msgs);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('should compress when over budget', async () => {
    const provider = mockProvider('Test summary');
    const compressor = new ContextCompressor(provider, db, defaultConfig);
    const msgs = makeMessages(10, 100);

    const result = await compressor.compress('session1', msgs, 'user1');

    expect(provider.chat).toHaveBeenCalledOnce();
    expect(result[0]).toEqual({
      role: 'system',
      content: '[Conversation Summary]\nTest summary',
    });
    expect(result.length).toBe(3);
    expect(result[1]).toEqual(msgs[8]);
    expect(result[2]).toEqual(msgs[9]);
  });

  it('should persist summary to database', async () => {
    const provider = mockProvider('Persisted summary');
    const compressor = new ContextCompressor(provider, db, defaultConfig);
    const msgs = makeMessages(10, 100);

    await compressor.compress('session1', msgs, 'user1');

    const stored = db.getContextSummary('session1');
    expect(stored).toBe('Persisted summary');
  });

  it('should record summarization cost in api_calls', async () => {
    const provider = mockProvider('Cost tracked summary');
    const compressor = new ContextCompressor(provider, db, defaultConfig);
    const msgs = makeMessages(10, 100);

    await compressor.compress('session1', msgs, 'user1');

    const dayCost = db.getUserDayCost('user1');
    expect(dayCost).toBeGreaterThan(0);
  });

  it('should load existing summary for under-budget sessions', async () => {
    const provider = mockProvider();
    const compressor = new ContextCompressor(provider, db, defaultConfig);

    db.upsertContextSummary('session1', 'Previous summary');

    const msgs: Message[] = [{ role: 'user', content: 'short' }];

    const result = await compressor.compress('session1', msgs, 'user1');
    expect(result[0]).toEqual({
      role: 'system',
      content: '[Conversation Summary]\nPrevious summary',
    });
    expect(result[1]).toEqual(msgs[0]);
  });

  it('should do incremental summarization with existing summary', async () => {
    const provider = mockProvider('Updated summary');
    const compressor = new ContextCompressor(provider, db, defaultConfig);

    db.upsertContextSummary('session1', 'Old summary');

    const msgs = makeMessages(10, 100);
    await compressor.compress('session1', msgs, 'user1');

    const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(chatCall.messages[0].content).toContain('Old summary');

    expect(db.getContextSummary('session1')).toBe('Updated summary');
  });

  it('should fall back to truncation on API failure', async () => {
    const provider = {
      chat: vi.fn().mockRejectedValue(new Error('API down')),
      estimateCost: vi.fn().mockReturnValue(0),
    } as unknown as ClaudeProvider;
    const compressor = new ContextCompressor(provider, db, defaultConfig);
    const msgs = makeMessages(10, 100);

    const result = await compressor.compress('session1', msgs, 'user1');

    expect(result.length).toBe(2);
    expect(result[0]).toEqual(msgs[8]);
    expect(result[1]).toEqual(msgs[9]);
  });

  it('should handle all messages being recent', async () => {
    const provider = mockProvider();
    const compressor = new ContextCompressor(provider, db, {
      maxContextTokens: 10,
      recentMessagesKeep: 20,
    });
    const msgs = makeMessages(3, 100);

    const result = await compressor.compress('session1', msgs, 'user1');
    expect(result).toEqual(msgs);
    expect(provider.chat).not.toHaveBeenCalled();
  });
});
