import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VigilClawDB } from '../../src/db.js';
import { MemoryStore } from '../../src/memory-store.js';
import type { ClaudeProvider } from '../../src/provider/claude.js';
import type { Embedder } from '../../src/embedder.js';

function fakeEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = Math.sin(seed * (i + 1) * 0.01);
  }
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  for (let i = 0; i < 384; i++) arr[i] = arr[i]! / norm;
  return arr;
}

function mockEmbedder(seedMap?: Map<string, number>): Embedder {
  let callCount = 0;
  return {
    available: true,
    embed: vi.fn().mockImplementation(async (text: string) => {
      if (seedMap?.has(text)) return fakeEmbedding(seedMap.get(text)!);
      callCount++;
      return fakeEmbedding(callCount);
    }),
  } as unknown as Embedder;
}

function mockProvider(facts: string[] | null = null): ClaudeProvider {
  const text = facts ? facts.map((f) => `- ${f}`).join('\n') : 'NONE';
  return {
    chat: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text }],
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: 'claude-haiku-3-5-20250929',
    }),
    estimateCost: vi.fn().mockReturnValue(0.25),
  } as unknown as ClaudeProvider;
}

const defaultConfig = {
  enabled: true,
  similarityThreshold: 0.5,
  maxRecallCount: 5,
};

describe('MemoryStore', () => {
  let db: VigilClawDB;

  beforeEach(() => {
    db = new VigilClawDB(':memory:');
    db.getOrCreateUser('user1', 'User 1');
    db.getOrCreateUser('userA', 'User A');
    db.getOrCreateUser('userB', 'User B');
  });

  describe('extractMemory', () => {
    it('should extract and store facts from conversation', async () => {
      const seedMap = new Map<string, number>();
      seedMap.set('User prefers TypeScript', 1);
      seedMap.set('User uses pnpm', 2);
      const embedder = mockEmbedder(seedMap);
      const provider = mockProvider(['User prefers TypeScript', 'User uses pnpm']);
      const store = new MemoryStore(db, embedder, provider, defaultConfig);

      await store.extractMemory('user1', undefined, 'I love TypeScript and pnpm', 'Great choices!');

      expect(provider.chat).toHaveBeenCalledOnce();
      expect(embedder.embed).toHaveBeenCalledTimes(2);

      const memories = db.getMemoriesByScope('user1');
      expect(memories).toHaveLength(2);
      expect(memories[0]!.content).toBe('User prefers TypeScript');
      expect(memories[1]!.content).toBe('User uses pnpm');
    });

    it('should record extraction cost in api_calls', async () => {
      const embedder = mockEmbedder();
      const provider = mockProvider(['Some fact']);
      const store = new MemoryStore(db, embedder, provider, defaultConfig);

      await store.extractMemory('user1', undefined, 'msg', 'reply');

      const dayCost = db.getUserDayCost('user1');
      expect(dayCost).toBeGreaterThan(0);
    });

    it('should skip storage when LLM returns NONE', async () => {
      const embedder = mockEmbedder();
      const provider = mockProvider(null);
      const store = new MemoryStore(db, embedder, provider, defaultConfig);

      await store.extractMemory('user1', undefined, 'Hello', 'Hi there!');

      expect(embedder.embed).not.toHaveBeenCalled();
      expect(db.getMemoriesByScope('user1')).toHaveLength(0);
    });

    it('should not call provider when disabled', async () => {
      const embedder = mockEmbedder();
      const provider = mockProvider(['some fact']);
      const store = new MemoryStore(db, embedder, provider, { ...defaultConfig, enabled: false });

      await store.extractMemory('user1', undefined, 'msg', 'reply');

      expect(provider.chat).not.toHaveBeenCalled();
    });

    it('should scope memories to group when groupId provided', async () => {
      const embedder = mockEmbedder();
      const provider = mockProvider(['Group fact']);
      const store = new MemoryStore(db, embedder, provider, defaultConfig);

      await store.extractMemory('user1', 'group1', 'msg', 'reply');

      expect(db.getMemoriesByScope('group1')).toHaveLength(1);
      expect(db.getMemoriesByScope('user1')).toHaveLength(0);
    });

    it('should handle provider failure gracefully', async () => {
      const embedder = mockEmbedder();
      const provider = {
        chat: vi.fn().mockRejectedValue(new Error('API down')),
        estimateCost: vi.fn().mockReturnValue(0),
      } as unknown as ClaudeProvider;
      const store = new MemoryStore(db, embedder, provider, defaultConfig);

      await expect(
        store.extractMemory('user1', undefined, 'msg', 'reply'),
      ).resolves.toBeUndefined();
    });
  });

  describe('recall', () => {
    it('should recall similar memories', async () => {
      const seedMap = new Map<string, number>();
      seedMap.set('User prefers TypeScript', 10);
      seedMap.set('User uses Vitest', 11);
      seedMap.set('Tell me about TypeScript', 10);
      const embedder = mockEmbedder(seedMap);
      const provider = mockProvider();
      const store = new MemoryStore(db, embedder, provider, defaultConfig);

      const id1 = db.insertMemory({
        userId: 'user1',
        scopeKey: 'user1',
        content: 'User prefers TypeScript',
      });
      db.insertMemoryVector(id1, fakeEmbedding(10));
      const id2 = db.insertMemory({
        userId: 'user1',
        scopeKey: 'user1',
        content: 'User uses Vitest',
      });
      db.insertMemoryVector(id2, fakeEmbedding(11));

      const results = await store.recall('user1', undefined, 'Tell me about TypeScript');

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]).toBe('User prefers TypeScript');
    });

    it('should respect scope isolation between users', async () => {
      const seedMap = new Map<string, number>();
      seedMap.set('User A fact', 20);
      seedMap.set('User B fact', 21);
      seedMap.set('query', 20);
      const embedder = mockEmbedder(seedMap);
      const provider = mockProvider();
      const store = new MemoryStore(db, embedder, provider, defaultConfig);

      const id1 = db.insertMemory({ userId: 'userA', scopeKey: 'userA', content: 'User A fact' });
      db.insertMemoryVector(id1, fakeEmbedding(20));
      const id2 = db.insertMemory({ userId: 'userB', scopeKey: 'userB', content: 'User B fact' });
      db.insertMemoryVector(id2, fakeEmbedding(21));

      const resultsB = await store.recall('userB', undefined, 'query');

      for (const memory of resultsB) {
        expect(memory).not.toBe('User A fact');
      }
    });

    it('should return empty array when disabled', async () => {
      const embedder = mockEmbedder();
      const provider = mockProvider();
      const store = new MemoryStore(db, embedder, provider, { ...defaultConfig, enabled: false });

      const results = await store.recall('user1', undefined, 'anything');
      expect(results).toEqual([]);
    });

    it('should return empty array when embedder unavailable', async () => {
      const embedder = { available: false, embed: vi.fn() } as unknown as Embedder;
      const provider = mockProvider();
      const store = new MemoryStore(db, embedder, provider, defaultConfig);

      const results = await store.recall('user1', undefined, 'anything');
      expect(results).toEqual([]);
    });

    it('should respect maxRecallCount', async () => {
      const embedder = mockEmbedder();
      const provider = mockProvider();
      const config = { ...defaultConfig, maxRecallCount: 2, similarityThreshold: 0 };
      const store = new MemoryStore(db, embedder, provider, config);

      for (let i = 0; i < 10; i++) {
        const id = db.insertMemory({ userId: 'user1', scopeKey: 'user1', content: `Fact ${i}` });
        db.insertMemoryVector(id, fakeEmbedding(i + 100));
      }

      const results = await store.recall('user1', undefined, 'query');
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('formatMemoriesMessage', () => {
    it('should format memories as bulleted list', () => {
      const embedder = mockEmbedder();
      const provider = mockProvider();
      const store = new MemoryStore(db, embedder, provider, defaultConfig);

      const result = store.formatMemoriesMessage(['Fact A', 'Fact B']);
      expect(result).toBe('[Relevant Memories]\n- Fact A\n- Fact B');
    });
  });
});
