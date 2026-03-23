import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { SearchBridge } from '../../src/search-bridge.js';
import { generateWebSearchStubJs } from '../../src/skills/web-search-stub.js';

// ---- Minimal DB mock ----

function makeDb(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    getCredential: vi.fn().mockReturnValue(null),
    insertSecurityEvent: vi.fn(),
    ...overrides,
  };
}

const FAKE_MASTER_KEY = Buffer.alloc(32, 0xab);

// ---- Helpers ----

async function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
  });
}

async function httpPost(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    };
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ---- Tests ----

describe('SearchBridge', () => {
  let bridge: SearchBridge;

  beforeEach(() => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
  });

  afterEach(async () => {
    await bridge?.destroyAll();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('API Key 双渠道读取', () => {
    it('环境变量优先于 DB credentials', async () => {
      vi.stubEnv('BRAVE_SEARCH_API_KEY', 'env-key-123');
      const db = makeDb({
        getCredential: vi.fn().mockReturnValue({ keyEncrypted: Buffer.from('x'), iv: Buffer.from('y') }),
      });
      bridge = new SearchBridge(db as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-1');

      // mock fetch to capture headers
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ web: { results: [] } }),
      } as Response);

      const result = await httpGet(port, '/search?q=test');
      expect(result.status).toBe(200);
      expect(result.body).toBe('No results found for: test');

      const callArgs = fetchSpy.mock.calls[0];
      expect(callArgs).toBeDefined();
      const headers = (callArgs![1] as RequestInit).headers as Record<string, string>;
      expect(headers['X-Subscription-Token']).toBe('env-key-123');
      // DB credential should NOT have been queried (env was set)
      expect((db.getCredential as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    });

    it('env 未设置时回退到 DB credentials', async () => {
      const { encrypt } = await import('../../src/crypto.js');
      const masterKey = Buffer.alloc(32, 0x42);
      const { encrypted, iv } = encrypt('db-brave-key', masterKey);
      const db = makeDb({
        getCredential: vi.fn().mockImplementation((key: string) => {
          if (key === 'brave-search') return { keyEncrypted: encrypted, iv };
          return null;
        }),
      });
      bridge = new SearchBridge(db as never, masterKey);
      const port = await bridge.createBridgeForTask('task-2');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ web: { results: [] } }),
      } as Response);

      await httpGet(port, '/search?q=hello');
      const headers = ((fetchSpy.mock.calls[0]![1] as RequestInit).headers) as Record<string, string>;
      expect(headers['X-Subscription-Token']).toBe('db-brave-key');
    });

    it('API Key 未配置时返回 503', async () => {
      bridge = new SearchBridge(makeDb() as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-3');
      const result = await httpGet(port, '/search?q=test');
      expect(result.status).toBe(503);
      expect(result.body).toContain('Brave Search API key not configured');
      expect(result.body).toContain('/setkey brave-search');
    });
  });

  describe('/search 端点格式化', () => {
    beforeEach(() => {
      vi.stubEnv('BRAVE_SEARCH_API_KEY', 'test-key');
    });

    it('返回格式化 Markdown 列表', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: {
            results: [
              {
                title: 'Rust async guide',
                url: 'https://example.com/rust-async',
                description: 'A comprehensive guide to Rust async programming.',
                extra_snippets: ['Tokio is the most popular runtime.', 'async-std offers std-like API.'],
              },
              {
                title: 'Another article',
                url: 'https://example.com/other',
                description: 'Brief description.',
              },
            ],
          },
        }),
      } as Response);

      bridge = new SearchBridge(makeDb() as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-fmt');
      const result = await httpGet(port, '/search?q=rust+async&count=2');

      expect(result.status).toBe(200);
      expect(result.body).toContain('Search results for "rust async"');
      expect(result.body).toContain('**Rust async guide**');
      expect(result.body).toContain('https://example.com/rust-async');
      expect(result.body).toContain('A comprehensive guide to Rust async programming.');
      expect(result.body).toContain('› Tokio is the most popular runtime.');
      expect(result.body).toContain('(2 results)');
    });

    it('结果为空时返回 No results found', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ web: { results: [] } }),
      } as Response);

      bridge = new SearchBridge(makeDb() as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-empty');
      const result = await httpGet(port, '/search?q=nothing');

      expect(result.status).toBe(200);
      expect(result.body).toBe('No results found for: nothing');
    });

    it('Brave API 返回错误时返回 502', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response);

      bridge = new SearchBridge(makeDb() as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-err');
      const result = await httpGet(port, '/search?q=test');

      expect(result.status).toBe(502);
      expect(result.body).toContain('Brave Search API error');
    });
  });

  describe('/fetch 端点私有 IP 拦截', () => {
    it('拦截 10.x.x.x (RFC1918 A 段)', async () => {
      const db = makeDb();
      bridge = new SearchBridge(db as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-ssrf-a');
      const result = await httpPost(port, '/fetch', { url: 'http://10.0.0.1/secret' });
      expect(result.status).toBe(403);
      expect(result.body).toContain('Blocked');
      expect((db.insertSecurityEvent as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it('拦截 172.16-31.x.x (RFC1918 B 段)', async () => {
      const db = makeDb();
      bridge = new SearchBridge(db as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-ssrf-b');
      const result = await httpPost(port, '/fetch', { url: 'http://172.20.0.1/data' });
      expect(result.status).toBe(403);
      expect(result.body).toContain('Blocked');
    });

    it('拦截 192.168.x.x (RFC1918 C 段)', async () => {
      bridge = new SearchBridge(makeDb() as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-ssrf-c');
      const result = await httpPost(port, '/fetch', { url: 'http://192.168.1.100/admin' });
      expect(result.status).toBe(403);
    });

    it('拦截 169.254.x.x (link-local/云元数据)', async () => {
      const db = makeDb();
      bridge = new SearchBridge(db as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-ssrf-meta');
      const result = await httpPost(port, '/fetch', { url: 'http://169.254.169.254/latest/meta-data' });
      expect(result.status).toBe(403);
      expect(result.body).toContain('Blocked');
    });

    it('拦截 localhost', async () => {
      bridge = new SearchBridge(makeDb() as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-ssrf-localhost');
      const result = await httpPost(port, '/fetch', { url: 'http://localhost:8080/internal' });
      expect(result.status).toBe(403);
    });

    it('127.0.0.1 同样被拦截', async () => {
      bridge = new SearchBridge(makeDb() as never, FAKE_MASTER_KEY);
      const port = await bridge.createBridgeForTask('task-ssrf-loop');
      const result = await httpPost(port, '/fetch', { url: 'http://127.0.0.1/config' });
      expect(result.status).toBe(403);
    });
  });
});

describe('generateWebSearchStubJs', () => {
  it('返回包含 web_search 工具定义的 CJS 代码', () => {
    const stub = generateWebSearchStubJs();
    expect(stub).toContain("'use strict'");
    expect(stub).toContain('web_search');
    expect(stub).toContain('web_fetch');
    expect(stub).toContain('module.exports');
    expect(stub).toContain('createTool');
    expect(stub).toContain('SEARCH_BRIDGE_URL');
  });

  it('生成的代码包含有效的 CJS 模块结构', () => {
    const stub = generateWebSearchStubJs();
    // Verify structural completeness without executing
    expect(stub).toContain('module.exports');
    expect(stub).toContain('execute:');
    expect(stub).toContain('input_schema:');
  });

  it('web_search 工具包含必要的 input_schema', () => {
    const stub = generateWebSearchStubJs();
    expect(stub).toContain('query');
    expect(stub).toContain('count');
    expect(stub).toContain('input_schema');
  });

  it('web_fetch 工具包含 url 和 prompt 参数', () => {
    const stub = generateWebSearchStubJs();
    expect(stub).toContain('web_fetch');
    expect(stub).toContain('params.url');
    expect(stub).toContain('params.prompt');
  });
});
