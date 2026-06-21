import type { VigilClawDB } from './db.js';
import type { ContextCompressor } from './context-compressor.js';
import type { MemoryStore } from './memory-store.js';
import type { KnowledgeGraphStore } from './knowledge-graph-store.js';
import type { Message } from './types.js';

export class SessionManager {
  private compressor: ContextCompressor | null = null;
  private memoryStore: MemoryStore | null = null;
  private kgStore: KnowledgeGraphStore | null = null;

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

  setKnowledgeGraphStore(kgStore: KnowledgeGraphStore): void {
    this.kgStore = kgStore;
  }

  async getContext(userId: string, groupId?: string): Promise<Message[]> {
    const sessionKey = groupId ?? userId;
    const rows = this.db.getRecentMessages(sessionKey, this.contextLength);
    let messages: Message[] = rows.map((r) => ({
      role: r.role as Message['role'],
      content: r.content,
    }));

    if (this.compressor) {
      messages = await this.compressor.compress(sessionKey, messages, userId, groupId);
    }

    if (this.memoryStore && messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) {
        const memories = await this.memoryStore.recall(userId, groupId, lastUserMsg.content);
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

    if (this.kgStore && messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) {
        const facts = await this.kgStore.recall(userId, groupId, lastUserMsg.content);
        if (facts.length > 0) {
          const kgMsg: Message = {
            role: 'system',
            content: this.kgStore.formatGraphMessage(facts),
          };
          // Inject after [Relevant Memories] if present, else after the summary, else at the front.
          const memoryIdx = messages.findIndex(
            (m) => m.role === 'system' && m.content.startsWith('[Relevant Memories]'),
          );
          let insertAt: number;
          if (memoryIdx >= 0) {
            insertAt = memoryIdx + 1;
          } else {
            const summaryIdx = messages.findIndex(
              (m) => m.role === 'system' && m.content.startsWith('[Conversation Summary]'),
            );
            insertAt = summaryIdx >= 0 ? summaryIdx + 1 : 0;
          }
          messages.splice(insertAt, 0, kgMsg);
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
