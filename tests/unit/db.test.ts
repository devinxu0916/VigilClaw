import { describe, it, expect, beforeEach } from 'vitest';
import { VigilClawDB } from '../../src/db.js';

describe('VigilClawDB', () => {
  let db: VigilClawDB;

  beforeEach(() => {
    db = new VigilClawDB(':memory:');
  });

  describe('users', () => {
    it('should create a new user', () => {
      const user = db.getOrCreateUser('telegram:123', 'Alice');
      expect(user.id).toBe('telegram:123');
    });

    it('should return existing user on conflict', () => {
      db.getOrCreateUser('telegram:123', 'Alice');
      const user = db.getOrCreateUser('telegram:123', 'Alice Updated');
      expect(user.id).toBe('telegram:123');
    });

    it('should get user budget defaults', () => {
      db.getOrCreateUser('telegram:123', 'Alice');
      const user = db.getUser('telegram:123');
      expect(user).not.toBeNull();
      expect(user!.maxCostPerDay).toBe(10.0);
      expect(user!.maxCostPerMonth).toBe(100.0);
    });

    it('should update user budget', () => {
      db.getOrCreateUser('telegram:123', 'Alice');
      db.updateUserBudget('telegram:123', 25.0, 500.0);
      const user = db.getUser('telegram:123');
      expect(user!.maxCostPerDay).toBe(25.0);
      expect(user!.maxCostPerMonth).toBe(500.0);
    });
  });

  describe('messages', () => {
    it('should insert and retrieve messages in correct order', () => {
      db.getOrCreateUser('u1', 'Test');
      db.insertMessage({ sessionKey: 's1', userId: 'u1', role: 'user', content: 'Hello' });
      db.insertMessage({ sessionKey: 's1', userId: 'u1', role: 'assistant', content: 'Hi!' });
      db.insertMessage({ sessionKey: 's1', userId: 'u1', role: 'user', content: 'Bye' });

      const msgs = db.getRecentMessages('s1', 10);
      expect(msgs).toHaveLength(3);
      expect(msgs[0]!.content).toBe('Hello');
      expect(msgs[2]!.content).toBe('Bye');
    });

    it('should respect limit parameter', () => {
      db.getOrCreateUser('u1', 'Test');
      for (let i = 0; i < 10; i++) {
        db.insertMessage({ sessionKey: 's1', userId: 'u1', role: 'user', content: `msg-${i}` });
      }

      const msgs = db.getRecentMessages('s1', 3);
      expect(msgs).toHaveLength(3);
      expect(msgs[0]!.content).toBe('msg-7');
    });

    it('should delete messages by session key', () => {
      db.getOrCreateUser('u1', 'Test');
      db.insertMessage({ sessionKey: 's1', userId: 'u1', role: 'user', content: 'a' });
      db.insertMessage({ sessionKey: 's2', userId: 'u1', role: 'user', content: 'b' });

      db.deleteMessages('s1');

      expect(db.getRecentMessages('s1', 10)).toHaveLength(0);
      expect(db.getRecentMessages('s2', 10)).toHaveLength(1);
    });
  });

  describe('cost tracking', () => {
    it('should record and sum daily cost', () => {
      db.getOrCreateUser('u1', 'Test');
      db.recordApiCall({
        taskId: 't1',
        userId: 'u1',
        provider: 'anthropic',
        model: 'claude-sonnet',
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.5,
      });
      db.recordApiCall({
        taskId: 't2',
        userId: 'u1',
        provider: 'anthropic',
        model: 'claude-sonnet',
        inputTokens: 2000,
        outputTokens: 1000,
        costUsd: 1.2,
      });

      expect(db.getUserDayCost('u1')).toBeCloseTo(1.7, 2);
    });

    it('should return 0 for user with no calls', () => {
      expect(db.getUserDayCost('nonexistent')).toBe(0);
      expect(db.getUserMonthCost('nonexistent')).toBe(0);
    });

    it('should generate cost report', () => {
      db.getOrCreateUser('u1', 'Test');
      db.recordApiCall({
        taskId: 't1',
        userId: 'u1',
        provider: 'anthropic',
        model: 'claude-sonnet',
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 2.5,
      });

      const report = db.getCostReport('u1');
      expect(report.dayCost).toBeCloseTo(2.5, 2);
      expect(report.dayBudget).toBe(10.0);
      expect(report.modelBreakdown).toHaveLength(1);
    });
  });

  describe('credentials', () => {
    it('should upsert and retrieve credentials', () => {
      const encrypted = Buffer.from('encrypted-data');
      const iv = Buffer.from('initialization-v');

      db.upsertCredential('anthropic', encrypted, iv);

      const cred = db.getCredential('anthropic');
      expect(cred).not.toBeNull();
      expect(Buffer.from(cred!.keyEncrypted)).toEqual(encrypted);
      expect(Buffer.from(cred!.iv)).toEqual(iv);
    });

    it('should return null for missing credential', () => {
      expect(db.getCredential('nonexistent')).toBeNull();
    });

    it('should overwrite on upsert', () => {
      db.upsertCredential('anthropic', Buffer.from('v1'), Buffer.from('iv1'));
      db.upsertCredential('anthropic', Buffer.from('v2'), Buffer.from('iv2'));

      const cred = db.getCredential('anthropic');
      expect(Buffer.from(cred!.keyEncrypted).toString()).toBe('v2');
    });
  });

  describe('security events', () => {
    it('should insert security event', () => {
      db.insertSecurityEvent({
        eventType: 'network_violation',
        userId: 'u1',
        severity: 'high',
        details: { target: '192.168.1.1' },
      });
    });
  });

  describe('tasks', () => {
    it('should create and update task lifecycle', () => {
      db.getOrCreateUser('u1', 'Test');
      db.insertTask({ id: 't1', userId: 'u1', inputSummary: 'Hello' });
      db.updateTaskRunning('t1', 'container-abc');
      db.updateTaskCompleted('t1', 'completed', {
        outputSummary: 'Hi!',
        totalCost: 0.5,
      });
    });
  });
});
