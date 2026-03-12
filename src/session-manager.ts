import type { VigilClawDB } from './db.js';
import type { Message } from './types.js';

export class SessionManager {
  constructor(
    private db: VigilClawDB,
    private contextLength: number = 20,
  ) {}

  getContext(userId: string, groupId?: string): Message[] {
    const sessionKey = groupId ?? userId;
    const rows = this.db.getRecentMessages(sessionKey, this.contextLength);
    return rows.map((r) => ({ role: r.role as Message['role'], content: r.content }));
  }

  clearContext(userId: string, groupId?: string): void {
    const sessionKey = groupId ?? userId;
    this.db.deleteMessages(sessionKey);
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
