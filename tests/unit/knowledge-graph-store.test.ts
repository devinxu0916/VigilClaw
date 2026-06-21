import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VigilClawDB } from '../../src/db.js';
import { KnowledgeGraphStore } from '../../src/knowledge-graph-store.js';
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
  let callCount = 1000;
  return {
    available: true,
    embed: vi.fn().mockImplementation(async (text: string) => {
      if (seedMap?.has(text)) return fakeEmbedding(seedMap.get(text)!);
      callCount++;
      return fakeEmbedding(callCount);
    }),
  } as unknown as Embedder;
}

interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

function mockProvider(triples: Triple[] | string | null = null): ClaudeProvider {
  const text =
    triples === null ? '[]' : typeof triples === 'string' ? triples : JSON.stringify(triples);
  return {
    chat: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text }],
      stopReason: 'end_turn',
      usage: { inputTokens: 120, outputTokens: 40 },
      model: 'claude-haiku-4-5-20251001',
    }),
    estimateCost: vi.fn().mockReturnValue(0.001),
  } as unknown as ClaudeProvider;
}

const defaultConfig = {
  enabled: true,
  maxHops: 1,
  maxFacts: 10,
  entitySimilarityThreshold: 0.5,
};

describe('KnowledgeGraphStore', () => {
  let db: VigilClawDB;

  beforeEach(() => {
    db = new VigilClawDB(':memory:');
    db.getOrCreateUser('user1', 'User 1');
    db.getOrCreateUser('userA', 'User A');
    db.getOrCreateUser('userB', 'User B');
  });

  describe('extractTriples', () => {
    it('stores entities and a relation from a triple', async () => {
      const provider = mockProvider([
        { subject: '用户', predicate: 'works_on', object: 'VigilClaw' },
      ]);
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, defaultConfig);

      await store.extractTriples('user1', undefined, '我在做 VigilClaw 项目', '不错！');

      const entities = db.listEntitiesByScope('user1');
      expect(entities.map((e) => e.name).sort()).toEqual(['VigilClaw', '用户']);

      const rels = db.getRelationsForEntities(
        'user1',
        entities.map((e) => e.id),
      );
      expect(rels).toHaveLength(1);
      expect(rels[0]!.predicate).toBe('works_on');
      expect(rels[0]!.subject_name).toBe('用户');
      expect(rels[0]!.object_name).toBe('VigilClaw');
    });

    it('records extraction cost in api_calls', async () => {
      const provider = mockProvider([{ subject: 'User', predicate: 'uses', object: 'pnpm' }]);
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, defaultConfig);

      await store.extractTriples('user1', undefined, 'I use pnpm', 'Nice');

      expect(db.getUserDayCost('user1')).toBeGreaterThan(0);
    });

    it('deduplicates entities by normalized name', async () => {
      const seedMap = new Map<string, number>([
        ['User', 1],
        ['TypeScript', 2],
        ['typescript ', 50],
      ]);
      const provider = mockProvider([
        { subject: 'User', predicate: 'prefers', object: 'TypeScript' },
        { subject: 'User', predicate: 'uses', object: 'typescript ' },
      ]);
      const store = new KnowledgeGraphStore(db, mockEmbedder(seedMap), provider, defaultConfig);

      await store.extractTriples('user1', undefined, 'msg', 'reply');

      const entities = db.listEntitiesByScope('user1');
      // User + TypeScript only (typescript dedups to TypeScript)
      expect(entities).toHaveLength(2);
    });

    it('deduplicates identical triples', async () => {
      const provider = mockProvider([
        { subject: 'User', predicate: 'prefers', object: 'TypeScript' },
        { subject: 'User', predicate: 'prefers', object: 'TypeScript' },
      ]);
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, defaultConfig);

      await store.extractTriples('user1', undefined, 'msg', 'reply');

      const entities = db.listEntitiesByScope('user1');
      const rels = db.getRelationsForEntities(
        'user1',
        entities.map((e) => e.id),
      );
      expect(rels).toHaveLength(1);
    });

    it('scopes triples to group when groupId provided', async () => {
      const provider = mockProvider([{ subject: 'User', predicate: 'uses', object: 'Docker' }]);
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, defaultConfig);

      await store.extractTriples('user1', 'group1', 'msg', 'reply');

      expect(db.listEntitiesByScope('group1')).toHaveLength(2);
      expect(db.listEntitiesByScope('user1')).toHaveLength(0);
    });

    it('does not call provider when disabled', async () => {
      const provider = mockProvider([{ subject: 'a', predicate: 'b', object: 'c' }]);
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, {
        ...defaultConfig,
        enabled: false,
      });

      await store.extractTriples('user1', undefined, 'msg', 'reply');

      expect(provider.chat).not.toHaveBeenCalled();
      expect(db.listEntitiesByScope('user1')).toHaveLength(0);
    });

    it('tolerates malformed JSON output without throwing', async () => {
      const provider = mockProvider('not json at all, sorry');
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, defaultConfig);

      await expect(store.extractTriples('user1', undefined, 'msg', 'reply')).resolves.toBeUndefined();
      expect(db.listEntitiesByScope('user1')).toHaveLength(0);
    });

    it('parses triples wrapped in code fences and prose', async () => {
      const provider = mockProvider(
        'Here are the triples:\n```json\n[{"subject":"User","predicate":"likes","object":"coffee"}]\n```',
      );
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, defaultConfig);

      await store.extractTriples('user1', undefined, 'msg', 'reply');
      expect(db.listEntitiesByScope('user1')).toHaveLength(2);
    });

    it('handles provider failure gracefully', async () => {
      const provider = {
        chat: vi.fn().mockRejectedValue(new Error('API down')),
        estimateCost: vi.fn().mockReturnValue(0),
      } as unknown as ClaudeProvider;
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, defaultConfig);

      await expect(store.extractTriples('user1', undefined, 'msg', 'reply')).resolves.toBeUndefined();
    });
  });

  describe('recall', () => {
    it('recalls a relation chain by traversing from a seed entity', async () => {
      const provider = mockProvider([
        { subject: '用户', predicate: 'works_on', object: 'VigilClaw' },
        { subject: 'VigilClaw', predicate: 'uses', object: 'SQLite' },
      ]);
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, {
        ...defaultConfig,
        maxHops: 2,
      });
      await store.extractTriples('user1', undefined, 'msg', 'reply');

      const facts = await store.recall('user1', undefined, '我的 VigilClaw 项目用什么数据库？');
      expect(facts).toContain('VigilClaw uses SQLite');
    });

    it('returns empty when no entity matches the query', async () => {
      const provider = mockProvider([{ subject: 'User', predicate: 'uses', object: 'pnpm' }]);
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, {
        ...defaultConfig,
        entitySimilarityThreshold: 0.99,
      });
      await store.extractTriples('user1', undefined, 'msg', 'reply');

      const facts = await store.recall('user1', undefined, 'tell me about cooking recipes');
      expect(facts).toEqual([]);
    });

    it('enforces the maxFacts limit', async () => {
      const triples: Triple[] = [];
      for (let i = 0; i < 15; i++) {
        triples.push({ subject: 'User', predicate: 'uses', object: `tool${i}` });
      }
      const provider = mockProvider(triples);
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, defaultConfig);
      await store.extractTriples('user1', undefined, 'msg', 'reply');

      const facts = await store.recall('user1', undefined, 'what does the User use?');
      expect(facts).toHaveLength(10);
    });

    it('respects maxHops bound', async () => {
      const provider = mockProvider([
        { subject: 'User', predicate: 'works_on', object: 'ProjectX' },
        { subject: 'ProjectX', predicate: 'uses', object: 'Postgres' },
      ]);
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, {
        ...defaultConfig,
        maxHops: 1,
      });
      await store.extractTriples('user1', undefined, 'msg', 'reply');

      // Seed = User; 1 hop reaches ProjectX relation but NOT ProjectX->Postgres
      const facts = await store.recall('user1', undefined, 'what is the User working on?');
      expect(facts).toContain('User works_on ProjectX');
      expect(facts).not.toContain('ProjectX uses Postgres');
    });

    it('isolates graphs by scope', async () => {
      const provider = mockProvider([{ subject: 'Alice', predicate: 'owns', object: 'SecretDoc' }]);
      const store = new KnowledgeGraphStore(db, mockEmbedder(), provider, defaultConfig);
      await store.extractTriples('userA', undefined, 'msg', 'reply');

      const facts = await store.recall('userB', undefined, 'tell me about Alice and SecretDoc');
      expect(facts).toEqual([]);
    });

    it('returns empty when disabled', async () => {
      const provider = mockProvider([{ subject: 'User', predicate: 'uses', object: 'pnpm' }]);
      const enabledStore = new KnowledgeGraphStore(db, mockEmbedder(), provider, defaultConfig);
      await enabledStore.extractTriples('user1', undefined, 'msg', 'reply');

      const disabledStore = new KnowledgeGraphStore(db, mockEmbedder(), provider, {
        ...defaultConfig,
        enabled: false,
      });
      const facts = await disabledStore.recall('user1', undefined, 'what does the User use?');
      expect(facts).toEqual([]);
    });
  });

  describe('formatGraphMessage', () => {
    it('formats facts with the [Knowledge Graph] header and bullets', () => {
      const store = new KnowledgeGraphStore(db, mockEmbedder(), mockProvider(), defaultConfig);
      const msg = store.formatGraphMessage(['User uses pnpm', 'User prefers TypeScript']);
      expect(msg).toBe('[Knowledge Graph]\n- User uses pnpm\n- User prefers TypeScript');
    });
  });
});
