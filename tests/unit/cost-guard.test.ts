import { describe, it, expect, beforeEach } from 'vitest';
import { VigilClawDB } from '../../src/db.js';
import { CostGuard } from '../../src/cost-guard.js';

describe('CostGuard', () => {
  let db: VigilClawDB;
  let guard: CostGuard;

  beforeEach(() => {
    db = new VigilClawDB(':memory:');
    guard = new CostGuard(db);
    db.getOrCreateUser('u1', 'Test');
  });

  it('should allow requests within budget', () => {
    const status = guard.checkBudget('u1');
    expect(status.exceeded).toBe(false);
    expect(status.remaining).toBe(10.0);
  });

  it('should reject when daily budget exceeded', () => {
    db.recordApiCall({
      taskId: 't1',
      userId: 'u1',
      provider: 'anthropic',
      model: 'claude-sonnet',
      inputTokens: 100_000,
      outputTokens: 50_000,
      costUsd: 10.01,
    });

    const status = guard.checkBudget('u1');
    expect(status.exceeded).toBe(true);
    expect(status.reason).toBe('day_limit');
  });

  it('should return correct remaining budget', () => {
    db.recordApiCall({
      taskId: 't1',
      userId: 'u1',
      provider: 'anthropic',
      model: 'claude-sonnet',
      inputTokens: 50_000,
      outputTokens: 10_000,
      costUsd: 3.5,
    });

    const status = guard.checkBudget('u1');
    expect(status.exceeded).toBe(false);
    expect(status.remaining).toBeCloseTo(6.5, 2);
  });

  it('should allow new users with default budget', () => {
    const status = guard.checkBudget('unknown-user');
    expect(status.exceeded).toBe(false);
    expect(status.budgetLimit).toBe(10.0);
  });

  it('should format day limit exceeded message', () => {
    const msg = guard.formatExceededMessage({
      exceeded: true,
      reason: 'day_limit',
      currentCost: 10.5,
      budgetLimit: 10.0,
      remaining: 0,
    });
    expect(msg).toContain('今日预算已用完');
    expect(msg).toContain('$10.50');
  });

  it('should format month limit exceeded message', () => {
    const msg = guard.formatExceededMessage({
      exceeded: true,
      reason: 'month_limit',
      currentCost: 100.0,
      budgetLimit: 100.0,
      remaining: 0,
    });
    expect(msg).toContain('本月预算已用完');
  });
});
