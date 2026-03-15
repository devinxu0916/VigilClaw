import { logger } from './logger.js';
import type { VigilClawDB } from './db.js';
import type { IProvider } from './provider/types.js';
import type { Embedder } from './embedder.js';

const EXTRACTION_MODEL = 'claude-haiku-3-5-20250929';

const EXTRACTION_SYSTEM = [
  'Analyze this conversation exchange and extract facts worth remembering for future conversations.',
  '',
  'Extract ONLY:',
  '- User preferences and habits (e.g., "User prefers TypeScript", "User uses pnpm")',
  '- Technical details about their projects (e.g., "User\'s project uses Vitest for testing")',
  '- Important decisions or constraints mentioned',
  '- Personal context (e.g., "User wants to be called 老板", "User named the assistant 皮皮虾")',
  '',
  'Rules:',
  '- CRITICAL: Write each fact in the SAME LANGUAGE as the user message. If user speaks Chinese, write in Chinese. If English, write in English.',
  '- Always start each fact with "User" (or "用户" in Chinese) as subject to clarify WHO the fact is about',
  '- Clearly distinguish between facts about the USER vs facts about the ASSISTANT',
  '- Return each fact as a separate line, prefixed with "- "',
  '- If there is NOTHING worth remembering (e.g., greetings, simple questions), return exactly "NONE"',
  '- Keep each fact concise (one sentence)',
  '- Do not include transient information (e.g., "User asked about X" without lasting value)',
  '- Do NOT extract facts that are essentially the same as what was already discussed — avoid redundancy',
].join('\n');

interface MemoryConfig {
  enabled: boolean;
  similarityThreshold: number;
  maxRecallCount: number;
}

export class MemoryStore {
  private operational: boolean;

  constructor(
    private db: VigilClawDB,
    private embedder: Embedder,
    private provider: IProvider,
    private config: MemoryConfig,
  ) {
    this.operational = config.enabled && db.vecAvailable && embedder.available;
    if (!this.operational && config.enabled) {
      logger.warn(
        'Memory features requested but not available (sqlite-vec or embedder unavailable)',
      );
    }
  }

  async extractMemory(
    userId: string,
    groupId: string | undefined,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    if (!this.operational) return;

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
        taskId: `memory-extract:${groupId ?? userId}`,
        userId,
        groupId,
        provider: 'anthropic',
        model: EXTRACTION_MODEL,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd: cost,
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

      if (!text || text === 'NONE') return;

      const facts = text
        .split('\n')
        .map((line) => line.replace(/^-\s*/, '').trim())
        .filter((line) => line.length > 0);

      const scopeKey = groupId ?? userId;

      for (const fact of facts) {
        await this.storeMemory(userId, groupId, scopeKey, fact);
      }
    } catch (err) {
      logger.warn({ err, userId }, 'Memory extraction failed');
    }
  }

  async recall(userId: string, groupId: string | undefined, queryText: string): Promise<string[]> {
    if (!this.operational) return [];

    try {
      const scopeKey = groupId ?? userId;
      const queryEmbedding = await this.embedder.embed(queryText);

      const results = this.db.searchMemoryVectors(queryEmbedding, this.config.maxRecallCount * 3);

      const memories: string[] = [];
      for (const { rowid, distance } of results) {
        const similarity = 1 - (distance * distance) / 2;
        if (similarity < this.config.similarityThreshold) continue;

        const memory = this.db.getMemoryById(rowid);
        if (!memory) continue;
        if (memory.scope_key !== scopeKey) continue;

        memories.push(memory.content);
        if (memories.length >= this.config.maxRecallCount) break;
      }

      return memories;
    } catch (err) {
      logger.warn({ err, userId }, 'Memory recall failed');
      return [];
    }
  }

  formatMemoriesMessage(memories: string[]): string {
    return '[Relevant Memories]\n' + memories.map((m) => `- ${m}`).join('\n');
  }

  private async storeMemory(
    userId: string,
    groupId: string | undefined,
    scopeKey: string,
    content: string,
  ): Promise<void> {
    try {
      const embedding = await this.embedder.embed(content);

      const duplicates = this.db.searchMemoryVectors(embedding, 3);
      for (const { rowid, distance } of duplicates) {
        const similarity = 1 - (distance * distance) / 2;
        if (similarity >= 0.85) {
          const existing = this.db.getMemoryById(rowid);
          if (existing && existing.scope_key === scopeKey) {
            return;
          }
        }
      }

      const rowid = this.db.insertMemory({
        userId,
        groupId,
        scopeKey,
        content,
      });

      this.db.insertMemoryVector(rowid, embedding);
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to store memory');
    }
  }
}
