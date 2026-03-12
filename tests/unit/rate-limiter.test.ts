import { describe, it, expect, vi } from 'vitest';
import { RateLimiter } from '../../src/rate-limiter.js';

describe('RateLimiter', () => {
  it('should allow requests within per-user limit', () => {
    const limiter = new RateLimiter({ perUser: 3, perGroup: 10, global: 100 });

    expect(limiter.isLimited('user-1')).toBe(false);
    expect(limiter.isLimited('user-1')).toBe(false);
    expect(limiter.isLimited('user-1')).toBe(false);
  });

  it('should block when per-user limit exceeded', () => {
    const limiter = new RateLimiter({ perUser: 2, perGroup: 10, global: 100 });

    limiter.isLimited('user-1');
    limiter.isLimited('user-1');
    expect(limiter.isLimited('user-1')).toBe(true);
  });

  it('should not affect different users', () => {
    const limiter = new RateLimiter({ perUser: 1, perGroup: 10, global: 100 });

    limiter.isLimited('user-1');
    expect(limiter.isLimited('user-1')).toBe(true);
    expect(limiter.isLimited('user-2')).toBe(false);
  });

  it('should enforce group limit', () => {
    const limiter = new RateLimiter({ perUser: 100, perGroup: 2, global: 100 });

    limiter.isLimited('user-1', 'group-1');
    limiter.isLimited('user-2', 'group-1');
    expect(limiter.isLimited('user-3', 'group-1')).toBe(true);
  });

  it('should enforce global limit', () => {
    const limiter = new RateLimiter({ perUser: 100, perGroup: 100, global: 2 });

    limiter.isLimited('user-1');
    limiter.isLimited('user-2');
    expect(limiter.isLimited('user-3')).toBe(true);
  });

  it('should reset after time window', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ perUser: 1, perGroup: 10, global: 100 });

    limiter.isLimited('user-1');
    expect(limiter.isLimited('user-1')).toBe(true);

    vi.advanceTimersByTime(61_000);
    expect(limiter.isLimited('user-1')).toBe(false);

    vi.useRealTimers();
  });

  it('should cleanup expired entries', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ perUser: 100, perGroup: 100, global: 100 });

    limiter.isLimited('user-1');
    limiter.isLimited('user-2');

    vi.advanceTimersByTime(61_000);
    limiter.cleanup();

    expect(limiter.isLimited('user-1')).toBe(false);

    vi.useRealTimers();
  });
});
