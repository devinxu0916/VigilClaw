import type { RateLimitConfig } from './config.js';

export class RateLimiter {
  private windows = new Map<string, number[]>();

  constructor(private config: RateLimitConfig) {}

  isLimited(userId: string, groupId?: string): boolean {
    const now = Date.now();
    const windowMs = 60_000;

    if (this.checkWindow(`user:${userId}`, now, windowMs, this.config.perUser)) {
      return true;
    }

    if (groupId && this.checkWindow(`group:${groupId}`, now, windowMs, this.config.perGroup)) {
      return true;
    }

    if (this.checkWindow('global', now, windowMs, this.config.global)) {
      return true;
    }

    return false;
  }

  private checkWindow(key: string, now: number, windowMs: number, limit: number): boolean {
    let timestamps = this.windows.get(key) ?? [];
    timestamps = timestamps.filter((t) => now - t < windowMs);

    if (timestamps.length >= limit) {
      return true;
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return false;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter((t) => now - t < 60_000);
      if (valid.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, valid);
      }
    }
  }
}
