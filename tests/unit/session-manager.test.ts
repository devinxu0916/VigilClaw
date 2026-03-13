import { describe, it, expect, beforeEach } from 'vitest';
import { VigilClawDB } from '../../src/db.js';
import { SessionManager } from '../../src/session-manager.js';

describe('SessionManager', () => {
  let db: VigilClawDB;
  let session: SessionManager;

  beforeEach(() => {
    db = new VigilClawDB(':memory:');
    session = new SessionManager(db, 20);
    db.getOrCreateUser('u1', 'Test');
  });

  it('should return empty context for new session', async () => {
    const ctx = await session.getContext('u1');
    expect(ctx).toHaveLength(0);
  });

  it('should save and retrieve user messages', async () => {
    session.saveUserMessage('u1', undefined, 'Hello');
    session.saveAssistantMessage('u1', undefined, 'Hi!');

    const ctx = await session.getContext('u1');
    expect(ctx).toHaveLength(2);
    expect(ctx[0]!.role).toBe('user');
    expect(ctx[0]!.content).toBe('Hello');
    expect(ctx[1]!.role).toBe('assistant');
    expect(ctx[1]!.content).toBe('Hi!');
  });

  it('should use groupId as session key when provided', async () => {
    session.saveUserMessage('u1', 'g1', 'In group');
    session.saveUserMessage('u1', undefined, 'In private');

    const groupCtx = await session.getContext('u1', 'g1');
    expect(groupCtx).toHaveLength(1);
    expect(groupCtx[0]!.content).toBe('In group');

    const privateCtx = await session.getContext('u1');
    expect(privateCtx).toHaveLength(1);
    expect(privateCtx[0]!.content).toBe('In private');
  });

  it('should respect context length limit', async () => {
    const mgr = new SessionManager(db, 3);
    for (let i = 0; i < 10; i++) {
      session.saveUserMessage('u1', undefined, `msg-${i}`);
    }

    const ctx = await mgr.getContext('u1');
    expect(ctx).toHaveLength(3);
    expect(ctx[0]!.content).toBe('msg-7');
  });

  it('should clear context', async () => {
    session.saveUserMessage('u1', undefined, 'Hello');
    session.saveAssistantMessage('u1', undefined, 'Hi!');
    session.clearContext('u1');

    const ctx = await session.getContext('u1');
    expect(ctx).toHaveLength(0);
  });
});
