import type { VigilClawDB } from './db.js';
import type { ContextCompressor } from './context-compressor.js';
import type { MemoryStore } from './memory-store.js';
import type { Message } from './types.js';
import { logger } from './logger.js';

export class SessionManager {
  private compressor: ContextCompressor | null = null;
  private memoryStore: MemoryStore | null = null;

  constructor(
    private db: VigilClawDB,
    private contextLength: number = 50,
  ) {}

  setCompressor(compressor: ContextCompressor): void {
    this.compressor = compressor;
  }

  setMemoryStore(memoryStore: MemoryStore): void {
    this.memoryStore = memoryStore;
  }

  async getContext(userId: string, groupId?: string): Promise<Message[]> {
    const sessionKey = groupId ?? userId;
    const rows = this.db.getRecentMessages(sessionKey, this.contextLength);
    let messages: Message[] = rows.map((r) => ({
      role: r.role as Message['role'],
      content: r.content,
    }));

    logger.info(
      {
        hasCompressor: !!this.compressor,
        hasMemoryStore: !!this.memoryStore,
        msgCount: messages.length,
      },
      'getContext state',
    );

    if (this.compressor) {
      messages = await this.compressor.compress(sessionKey, messages, userId, groupId);
    }

    if (this.memoryStore && messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      logger.debug(
        { hasMemoryStore: true, msgCount: messages.length, hasLastUser: !!lastUserMsg },
        'Memory recall check',
      );
      if (lastUserMsg) {
        const memories = await this.memoryStore.recall(userId, groupId, lastUserMsg.content);
        logger.debug({ memoriesFound: memories.length }, 'Memory recall result');

        if (memories.length > 0) {
          const memoryMsg: Message = {
            role: 'system',
            content: this.memoryStore.formatMemoriesMessage(memories),
          };
          const summaryIdx = messages.findIndex(
            (m) => m.role === 'system' && m.content.startsWith('[Conversation Summary]'),
          );
          const insertAt = summaryIdx >= 0 ? summaryIdx + 1 : 0;
          messages.splice(insertAt, 0, memoryMsg);
        }
      }
    }

    return messages;
  }

  clearContext(userId: string, groupId?: string): void {
    const sessionKey = groupId ?? userId;
    this.db.deleteMessages(sessionKey);
    this.db.deleteContextSummary(sessionKey);
  }

  saveUserMessage(userId: string, groupId: string | undefined, content: string): void {
    const sessionKey = groupId ?? userId;
    this.db.insertMessage({
      sessionKey,
      userId,
      groupId,
      role: 'user',
      content,
    });
  }

  saveAssistantMessage(userId: string, groupId: string | undefined, content: string): void {
    const sessionKey = groupId ?? userId;
    this.db.insertMessage({
      sessionKey,
      userId,
      groupId,
      role: 'assistant',
      content,
    });
  }
}
