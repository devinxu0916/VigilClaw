import { describe, it, expect } from 'vitest';
import { generateDashboardToken, checkAuth } from '../../src/dashboard-auth.js';
import type http from 'node:http';

function fakeReq(overrides: {
  authorization?: string;
  url?: string;
}): http.IncomingMessage {
  return {
    headers: {
      authorization: overrides.authorization,
    },
    url: overrides.url ?? '/',
  } as unknown as http.IncomingMessage;
}

describe('generateDashboardToken', () => {
  it('produces a deterministic 32-char hex string', () => {
    const key = Buffer.from('a'.repeat(32));
    const t1 = generateDashboardToken(key);
    const t2 = generateDashboardToken(key);
    expect(t1).toBe(t2);
    expect(t1).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(t1)).toBe(true);
  });

  it('produces different tokens for different keys', () => {
    const t1 = generateDashboardToken(Buffer.from('a'.repeat(32)));
    const t2 = generateDashboardToken(Buffer.from('b'.repeat(32)));
    expect(t1).not.toBe(t2);
  });
});

describe('checkAuth', () => {
  const TOKEN = 'abc123def456abc123def456abc123de';

  it('accepts valid Bearer header', () => {
    const req = fakeReq({ authorization: `Bearer ${TOKEN}` });
    expect(checkAuth(req, TOKEN)).toBe(true);
  });

  it('rejects invalid Bearer header', () => {
    const req = fakeReq({ authorization: 'Bearer wrong-token' });
    expect(checkAuth(req, TOKEN)).toBe(false);
  });

  it('accepts valid query parameter', () => {
    const req = fakeReq({ url: `/?token=${TOKEN}` });
    expect(checkAuth(req, TOKEN)).toBe(true);
  });

  it('rejects invalid query parameter', () => {
    const req = fakeReq({ url: '/?token=wrong-token' });
    expect(checkAuth(req, TOKEN)).toBe(false);
  });

  it('rejects when no auth provided', () => {
    const req = fakeReq({});
    expect(checkAuth(req, TOKEN)).toBe(false);
  });

  it('rejects empty authorization header', () => {
    const req = fakeReq({ authorization: '' });
    expect(checkAuth(req, TOKEN)).toBe(false);
  });

  it('rejects non-Bearer auth scheme', () => {
    const req = fakeReq({ authorization: `Basic ${TOKEN}` });
    expect(checkAuth(req, TOKEN)).toBe(false);
  });
});
