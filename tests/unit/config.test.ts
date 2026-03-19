import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../../src/config.js';

describe('ConfigSchema', () => {
  it('should require masterKey', () => {
    const result = ConfigSchema.safeParse({
      telegram: { botToken: 'test' },
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid minimal config', () => {
    const result = ConfigSchema.safeParse({
      masterKey: 'a'.repeat(64),
      telegram: { botToken: 'test-token' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logLevel).toBe('info');
      expect(result.data.docker.memoryLimit).toBe(512 * 1024 * 1024);
      expect(result.data.cost.maxCostPerDay).toBe(10.0);
      expect(result.data.rateLimit.perUser).toBe(10);
      expect(result.data.maxConcurrentContainers).toBe(5);
    }
  });

  it('should reject masterKey shorter than 64 chars', () => {
    const result = ConfigSchema.safeParse({
      masterKey: 'tooshort',
      telegram: { botToken: 'test-token' },
    });
    expect(result.success).toBe(false);
  });

  it('should apply custom overrides', () => {
    const result = ConfigSchema.safeParse({
      masterKey: 'b'.repeat(64),
      telegram: { botToken: 'tok', mode: 'webhook', webhookUrl: 'https://example.com/hook' },
      cost: { maxCostPerDay: 50.0 },
      maxConcurrentContainers: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.telegram.mode).toBe('webhook');
      expect(result.data.cost.maxCostPerDay).toBe(50.0);
      expect(result.data.maxConcurrentContainers).toBe(10);
    }
  });
});
