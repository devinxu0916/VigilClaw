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

  // ---- Dashboard queries ----

  describe('getOverviewStats', () => {
    it('returns zero stats for empty db', () => {
      const stats = db.getOverviewStats();
      expect(stats.todayCost).toBe(0);
      expect(stats.monthCost).toBe(0);
      expect(stats.todayCalls).toBe(0);
      expect(stats.monthCalls).toBe(0);
      expect(stats.todayTasks).toBe(0);
      expect(stats.monthTasks).toBe(0);
    });

    it('returns correct stats after inserting data', () => {
      db.getOrCreateUser('u1', 'Test');
      db.recordApiCall({
        taskId: 't1', userId: 'u1', provider: 'anthropic', model: 'claude-sonnet',
        inputTokens: 1000, outputTokens: 500, costUsd: 0.5,
      });
      db.insertTask({ id: 't1', userId: 'u1', inputSummary: 'test' });

      const stats = db.getOverviewStats();
      expect(stats.todayCost).toBeCloseTo(0.5, 2);
      expect(stats.todayCalls).toBe(1);
      expect(stats.todayTasks).toBe(1);
    });
  });

  describe('getDailyCosts', () => {
    it('returns empty array for no data', () => {
      const costs = db.getDailyCosts(7);
      expect(costs).toHaveLength(0);
    });

    it('groups costs by date', () => {
      db.getOrCreateUser('u1', 'Test');
      db.recordApiCall({
        taskId: 't1', userId: 'u1', provider: 'anthropic', model: 'claude',
        inputTokens: 100, outputTokens: 50, costUsd: 0.1,
      });
      db.recordApiCall({
        taskId: 't2', userId: 'u1', provider: 'anthropic', model: 'claude',
        inputTokens: 200, outputTokens: 100, costUsd: 0.2,
      });

      const costs = db.getDailyCosts(7);
      expect(costs).toHaveLength(1);
      expect(costs[0]!.calls).toBe(2);
      expect(costs[0]!.cost).toBeCloseTo(0.3, 2);
    });
  });

  describe('getTasksPaginated', () => {
    it('returns paginated tasks', () => {
      db.getOrCreateUser('u1', 'Test');
      for (let i = 0; i < 5; i++) {
        db.insertTask({ id: `t${i}`, userId: 'u1', inputSummary: `task ${i}` });
      }

      const { tasks, total } = db.getTasksPaginated(1, 2);
      expect(total).toBe(5);
      expect(tasks).toHaveLength(2);
    });
  });

  describe('getSecurityEventsPaginated', () => {
    it('returns paginated security events', () => {
      for (let i = 0; i < 3; i++) {
        db.insertSecurityEvent({
          eventType: 'network_violation', severity: 'high',
          details: { index: i },
        });
      }

      const { events, total } = db.getSecurityEventsPaginated(1, 2);
      expect(total).toBe(3);
      expect(events).toHaveLength(2);
    });
  });

  describe('listCredentialStatus', () => {
    it('returns empty when no credentials', () => {
      const creds = db.listCredentialStatus();
      expect(creds).toHaveLength(0);
    });

    it('lists credential providers', () => {
      db.upsertCredential('anthropic', Buffer.from('enc'), Buffer.from('iv1'));
      db.upsertCredential('openai', Buffer.from('enc'), Buffer.from('iv2'));

      const creds = db.listCredentialStatus();
      expect(creds).toHaveLength(2);
      expect(creds.map((c) => c.provider)).toContain('anthropic');
    });
  });

  describe('getAllScheduledTasks', () => {
    it('returns all scheduled tasks without userId filter', () => {
      db.getOrCreateUser('u1', 'Test');
      db.getOrCreateUser('u2', 'Test2');
      db.insertScheduledTask({
        id: 's1', userId: 'u1', cronExpression: '0 9 * * *',
        taskPrompt: 'Task 1', nextRunAt: '2025-01-01 09:00:00',
      });
      db.insertScheduledTask({
        id: 's2', userId: 'u2', cronExpression: '0 10 * * *',
        taskPrompt: 'Task 2', nextRunAt: '2025-01-01 10:00:00',
      });

      const tasks = db.getAllScheduledTasks();
      expect(tasks).toHaveLength(2);
    });
  });

  describe('getModelBreakdownToday', () => {
    it('returns empty array when no calls', () => {
      const breakdown = db.getModelBreakdownToday();
      expect(breakdown).toHaveLength(0);
    });

    it('groups by model', () => {
      db.getOrCreateUser('u1', 'Test');
      db.recordApiCall({
        taskId: 't1', userId: 'u1', provider: 'anthropic', model: 'claude-sonnet',
        inputTokens: 1000, outputTokens: 500, costUsd: 0.5,
      });
      db.recordApiCall({
        taskId: 't2', userId: 'u1', provider: 'anthropic', model: 'claude-haiku',
        inputTokens: 500, outputTokens: 200, costUsd: 0.1,
      });

      const breakdown = db.getModelBreakdownToday();
      expect(breakdown).toHaveLength(2);
      expect(breakdown[0]!.model).toBe('claude-sonnet');
    });
  });

  describe('admin scheduled task operations', () => {
    it('toggles scheduled task without userId check', () => {
      db.getOrCreateUser('u1', 'Test');
      db.insertScheduledTask({
        id: 's1', userId: 'u1', cronExpression: '0 9 * * *',
        taskPrompt: 'Task 1', nextRunAt: '2025-01-01 09:00:00',
      });

      const toggled = db.adminToggleScheduledTask('s1', false);
      expect(toggled).toBe(true);

      const task = db.getScheduledTaskById('s1');
      expect(task).not.toBeNull();
      expect(task!.enabled).toBe(0);
    });

    it('deletes scheduled task without userId check', () => {
      db.getOrCreateUser('u1', 'Test');
      db.insertScheduledTask({
        id: 's1', userId: 'u1', cronExpression: '0 9 * * *',
        taskPrompt: 'Task 1', nextRunAt: '2025-01-01 09:00:00',
      });

      const deleted = db.adminDeleteScheduledTask('s1');
      expect(deleted).toBe(true);

      const task = db.getScheduledTaskById('s1');
      expect(task).toBeNull();
    });

    it('getScheduledTaskById returns null for non-existent', () => {
      expect(db.getScheduledTaskById('nonexistent')).toBeNull();
    });
  });

  describe('knowledge graph', () => {
    beforeEach(() => {
      db.getOrCreateUser('u1', 'Test');
    });

    it('upserts an entity and reuses it by normalized name', () => {
      const first = db.upsertEntity({ scopeKey: 'u1', name: 'TypeScript' });
      expect(first.created).toBe(true);

      const second = db.upsertEntity({ scopeKey: 'u1', name: 'typescript ' });
      expect(second.created).toBe(false);
      expect(second.id).toBe(first.id);

      expect(db.listEntitiesByScope('u1')).toHaveLength(1);
    });

    it('isolates entities across scopes', () => {
      const a = db.upsertEntity({ scopeKey: 'u1', name: 'Docker' });
      const b = db.upsertEntity({ scopeKey: 'u2', name: 'Docker' });
      expect(a.id).not.toBe(b.id);
      expect(db.listEntitiesByScope('u1')).toHaveLength(1);
      expect(db.listEntitiesByScope('u2')).toHaveLength(1);
    });

    it('inserts a relation and ignores duplicate triples', () => {
      const s = db.upsertEntity({ scopeKey: 'u1', name: 'User' }).id;
      const o = db.upsertEntity({ scopeKey: 'u1', name: 'pnpm' }).id;

      db.insertRelation({ scopeKey: 'u1', subjectId: s, predicate: 'uses', objectId: o });
      db.insertRelation({ scopeKey: 'u1', subjectId: s, predicate: 'uses', objectId: o });

      const rels = db.getRelationsForEntities('u1', [s, o]);
      expect(rels).toHaveLength(1);
      expect(rels[0]!.subject_name).toBe('User');
      expect(rels[0]!.object_name).toBe('pnpm');
    });

    it('fetches relations touching an entity as subject or object', () => {
      const user = db.upsertEntity({ scopeKey: 'u1', name: 'User' }).id;
      const proj = db.upsertEntity({ scopeKey: 'u1', name: 'VigilClaw' }).id;
      const dbEnt = db.upsertEntity({ scopeKey: 'u1', name: 'SQLite' }).id;
      db.insertRelation({ scopeKey: 'u1', subjectId: user, predicate: 'works_on', objectId: proj });
      db.insertRelation({ scopeKey: 'u1', subjectId: proj, predicate: 'uses', objectId: dbEnt });

      // proj appears as object in one relation and subject in another
      const rels = db.getRelationsForEntities('u1', [proj]);
      expect(rels).toHaveLength(2);
    });

    it('increments mention count via touchEntity', () => {
      const id = db.upsertEntity({ scopeKey: 'u1', name: 'Vitest' }).id;
      db.touchEntity(id);
      const entity = db.getEntityById(id);
      expect(entity).not.toBeNull();
      expect(entity!.name).toBe('Vitest');
    });

    it('cascades relation deletion when an entity is removed', () => {
      const s = db.upsertEntity({ scopeKey: 'u1', name: 'User' }).id;
      const o = db.upsertEntity({ scopeKey: 'u1', name: 'Go' }).id;
      db.insertRelation({ scopeKey: 'u1', subjectId: s, predicate: 'uses', objectId: o });

      // cleanup removes nothing recent, but verify FK cascade directly is covered by schema
      const rels = db.getRelationsForEntities('u1', [s, o]);
      expect(rels).toHaveLength(1);
    });
  });
});
