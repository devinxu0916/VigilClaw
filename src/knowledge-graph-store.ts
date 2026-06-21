import { logger } from './logger.js';
import { normalizeEntityName } from './db.js';
import type { VigilClawDB } from './db.js';
import type { IProvider } from './provider/types.js';
import type { Embedder } from './embedder.js';

const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';

/** Above this name-embedding similarity, two entities are treated as the same and merged. */
const ENTITY_MERGE_SIMILARITY = 0.9;

const EXTRACTION_SYSTEM = [
  'Extract structured knowledge-graph triples from this conversation exchange.',
  '',
  'A triple is (subject, predicate, object) capturing a lasting relationship, e.g.:',
  '- "我在做 VigilClaw 项目" → {"subject":"用户","predicate":"works_on","object":"VigilClaw"}',
  '- "它用 SQLite 存数据" → {"subject":"VigilClaw","predicate":"uses","object":"SQLite"}',
  '- "I always use pnpm" → {"subject":"User","predicate":"prefers","object":"pnpm"}',
  '',
  'Rules:',
  '- Output ONLY a JSON array of objects with keys "subject", "predicate", "object". No prose, no code fences.',
  '- "predicate" MUST be a short snake_case English verb phrase (e.g. prefers, uses, works_on, named, lives_in).',
  '- Keep "subject" and "object" entity names in the SAME LANGUAGE as the user message.',
  '- Use "用户"/"User" as the subject when the fact is about the person speaking.',
  '- Only extract lasting facts (preferences, projects, tech stack, decisions, personal context).',
  '- Skip greetings, transient questions, and anything not worth remembering.',
  '- If there is nothing worth extracting, output exactly: []',
].join('\n');

interface KnowledgeGraphConfig {
  enabled: boolean;
  maxHops: number;
  maxFacts: number;
  entitySimilarityThreshold: number;
}

interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

export class KnowledgeGraphStore {
  private readonly enabled: boolean;
  private readonly vecOperational: boolean;

  constructor(
    private db: VigilClawDB,
    private embedder: Embedder,
    private provider: IProvider,
    private config: KnowledgeGraphConfig,
  ) {
    this.enabled = config.enabled;
    this.vecOperational = config.enabled && db.vecAvailable && embedder.available;
    if (config.enabled && !db.vecAvailable) {
      logger.warn('Knowledge graph enabled but sqlite-vec unavailable — entity vector matching disabled, literal matching only');
    }
  }

  /** Extract triples from a conversation exchange and persist them into the graph. */
  async extractTriples(
    userId: string,
    groupId: string | undefined,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const prompt = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;

      const response = await this.provider.chat({
        model: EXTRACTION_MODEL,
        messages: [{ role: 'user', content: prompt }],
        system: EXTRACTION_SYSTEM,
        maxTokens: 512,
        temperature: 0.2,
      });

      const cost = this.provider.estimateCost(
        response.usage.inputTokens,
        response.usage.outputTokens,
        EXTRACTION_MODEL,
      );
      this.db.recordApiCall({
        taskId: `kg-extract:${groupId ?? userId}`,
        userId,
        groupId,
        provider: 'anthropic',
        model: EXTRACTION_MODEL,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd: cost,
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';

      const triples = parseTriples(text);
      if (triples.length === 0) return;

      const scopeKey = groupId ?? userId;
      for (const triple of triples) {
        await this.storeTriple(userId, scopeKey, triple);
      }
    } catch (err) {
      logger.warn({ err, userId }, 'Knowledge graph extraction failed');
    }
  }

  /** Recall graph facts relevant to a query via seed-entity location + bounded traversal. */
  async recall(userId: string, groupId: string | undefined, queryText: string): Promise<string[]> {
    if (!this.enabled) return [];

    try {
      const scopeKey = groupId ?? userId;
      const seedIds = await this.findSeedEntities(scopeKey, queryText);
      if (seedIds.length === 0) return [];

      return this.traverse(scopeKey, seedIds);
    } catch (err) {
      logger.warn({ err, userId }, 'Knowledge graph recall failed');
      return [];
    }
  }

  formatGraphMessage(facts: string[]): string {
    return '[Knowledge Graph]\n' + facts.map((f) => `- ${f}`).join('\n');
  }

  /** Resolve an entity name to an id (vector soft-merge → normalized match → insert). */
  private async resolveEntityId(scopeKey: string, name: string): Promise<number> {
    if (this.vecOperational) {
      try {
        const embedding = await this.embedder.embed(name);
        const near = this.db.searchEntityVectors(embedding, 3);
        for (const { rowid, distance } of near) {
          const similarity = 1 - (distance * distance) / 2;
          if (similarity < ENTITY_MERGE_SIMILARITY) continue;
          const entity = this.db.getEntityById(rowid);
          if (entity && entity.scope_key === scopeKey) {
            this.db.touchEntity(rowid);
            return rowid;
          }
        }
        const { id, created } = this.db.upsertEntity({ scopeKey, name });
        if (created) this.db.insertEntityVector(id, embedding);
        return id;
      } catch (err) {
        logger.warn({ err }, 'Entity vector resolution failed, falling back to exact match');
      }
    }
    return this.db.upsertEntity({ scopeKey, name }).id;
  }

  private async storeTriple(userId: string, scopeKey: string, triple: Triple): Promise<void> {
    const subject = triple.subject.trim();
    const predicate = triple.predicate.trim();
    const object = triple.object.trim();
    if (!subject || !predicate || !object) return;

    const subjectId = await this.resolveEntityId(scopeKey, subject);
    const objectId = await this.resolveEntityId(scopeKey, object);
    if (subjectId === objectId) return;

    this.db.insertRelation({
      scopeKey,
      subjectId,
      predicate,
      objectId,
      sourceUserId: userId,
    });
  }

  private async findSeedEntities(scopeKey: string, queryText: string): Promise<number[]> {
    const seeds = new Set<number>();

    // Vector seeding: entities whose name is semantically close to the query.
    if (this.vecOperational) {
      try {
        const embedding = await this.embedder.embed(queryText);
        const near = this.db.searchEntityVectors(embedding, this.config.maxFacts);
        for (const { rowid, distance } of near) {
          const similarity = 1 - (distance * distance) / 2;
          if (similarity < this.config.entitySimilarityThreshold) continue;
          const entity = this.db.getEntityById(rowid);
          if (entity && entity.scope_key === scopeKey) seeds.add(rowid);
        }
      } catch (err) {
        logger.warn({ err }, 'Entity vector seeding failed, using literal matching only');
      }
    }

    // Literal seeding: entity names that appear in the query text.
    const normQuery = normalizeEntityName(queryText);
    for (const entity of this.db.listEntitiesByScope(scopeKey)) {
      if (entity.name_norm.length > 0 && normQuery.includes(entity.name_norm)) {
        seeds.add(entity.id);
      }
    }

    return [...seeds];
  }

  private traverse(scopeKey: string, seedIds: number[]): string[] {
    const visited = new Set<number>(seedIds);
    let frontier = [...seedIds];
    const collected = new Map<
      number,
      { subject_name: string; predicate: string; object_name: string; confidence: number; created_at: string }
    >();

    for (let hop = 0; hop < this.config.maxHops && frontier.length > 0; hop++) {
      const rows = this.db.getRelationsForEntities(scopeKey, frontier);
      const next: number[] = [];
      for (const row of rows) {
        collected.set(row.id, {
          subject_name: row.subject_name,
          predicate: row.predicate,
          object_name: row.object_name,
          confidence: row.confidence,
          created_at: row.created_at,
        });
        if (!visited.has(row.subject_id)) {
          visited.add(row.subject_id);
          next.push(row.subject_id);
        }
        if (!visited.has(row.object_id)) {
          visited.add(row.object_id);
          next.push(row.object_id);
        }
      }
      frontier = next;
    }

    return [...collected.values()]
      .sort((a, b) => b.confidence - a.confidence || b.created_at.localeCompare(a.created_at))
      .slice(0, this.config.maxFacts)
      .map((r) => `${r.subject_name} ${r.predicate} ${r.object_name}`);
  }
}

/** Parse a JSON triple array from raw LLM output, tolerating code fences and surrounding prose. */
function parseTriples(text: string): Triple[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    const triples: Triple[] = [];
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (
          typeof obj.subject === 'string' &&
          typeof obj.predicate === 'string' &&
          typeof obj.object === 'string'
        ) {
          triples.push({ subject: obj.subject, predicate: obj.predicate, object: obj.object });
        }
      }
    }
    return triples;
  } catch {
    return [];
  }
}
