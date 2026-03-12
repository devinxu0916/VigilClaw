import { describe, it, expect } from 'vitest';

describe('VigilClaw Scaffold', () => {
  it('should pass a sanity check', () => {
    expect(1 + 1).toBe(2);
  });

  it('should import types without error', async () => {
    const types = await import('../../src/types.js');
    expect(types).toBeDefined();
  });

  it('should import channel types without error', async () => {
    const types = await import('../../src/channels/types.js');
    expect(types).toBeDefined();
  });

  it('should import provider types without error', async () => {
    const types = await import('../../src/provider/types.js');
    expect(types).toBeDefined();
  });
});
