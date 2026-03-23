import http from 'node:http';
import net from 'node:net';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { logger } from './logger.js';
import type { VigilClawDB } from './db.js';
import { decrypt } from './crypto.js';

interface BridgeInstance {
  server: http.Server;
  port: number;
}

interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
  extra_snippets?: string[];
}

interface BraveSearchResponse {
  web?: {
    results: BraveWebResult[];
  };
}

interface AnthropicMessage {
  content: Array<{ type: string; text?: string }>;
}

// RFC1918 + link-local + loopback
const PRIVATE_IP_RE =
  /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+)$/;

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const FETCH_TIMEOUT_MS = 30_000;
const HAIKU_TIMEOUT_MS = 30_000;
const MARKDOWN_TRUNCATE = 15_000;
const RAW_TRUNCATE = 8_000;
const DEFAULT_SEARCH_COUNT = 5;

export class SearchBridge {
  private instances = new Map<string, BridgeInstance>();

  constructor(
    private db: VigilClawDB,
    private masterKey: Buffer,
  ) {}

  async createBridgeForTask(taskId: string): Promise<number> {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res, taskId).catch((err: unknown) => {
        logger.error({ err, taskId }, 'SearchBridge request failed');
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end('Internal error');
      });
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, '0.0.0.0', () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });

    this.instances.set(taskId, { server, port });
    logger.debug({ taskId, port }, 'SearchBridge started');
    return port;
  }

  async destroyBridgeForTask(taskId: string): Promise<void> {
    const instance = this.instances.get(taskId);
    if (instance) {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      this.instances.delete(taskId);
    }
  }

  async destroyAll(): Promise<void> {
    await Promise.allSettled(
      [...this.instances.keys()].map((id) => this.destroyBridgeForTask(id)),
    );
  }

  // Direct call interface for LocalRunner (no HTTP layer)
  async search(query: string, count = DEFAULT_SEARCH_COUNT): Promise<string> {
    const apiKey = this.getBraveApiKey();
    if (!apiKey) {
      return 'Error: Brave Search API key not configured. Use /setkey brave-search <key> or set BRAVE_SEARCH_API_KEY env var.';
    }
    return this.callBraveSearch(query, count, apiKey);
  }

  async fetchAndSummarize(url: string, prompt?: string): Promise<string> {
    const block = this.checkPrivateIp(url, undefined);
    if (block) return block;
    return this.fetchUrlAndSummarize(url, prompt);
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string,
  ): Promise<void> {
    const reqUrl = new URL(req.url ?? '/', `http://localhost`);

    if (req.method === 'GET' && reqUrl.pathname === '/search') {
      await this.handleSearch(res, reqUrl);
    } else if (req.method === 'POST' && reqUrl.pathname === '/fetch') {
      await this.handleFetch(req, res, taskId);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  }

  private async handleSearch(res: http.ServerResponse, reqUrl: URL): Promise<void> {
    const query = reqUrl.searchParams.get('q');
    const countStr = reqUrl.searchParams.get('count');
    const count = countStr ? parseInt(countStr, 10) : DEFAULT_SEARCH_COUNT;

    if (!query) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing q parameter');
      return;
    }

    const apiKey = this.getBraveApiKey();
    logger.info({ apiKey }, 'Brave Search API key');
    if (!apiKey) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end(
        'Brave Search API key not configured. Use /setkey brave-search <key> or set BRAVE_SEARCH_API_KEY env var.',
      );
      return;
    }

    try {
      const result = await this.callBraveSearch(query, count, apiKey);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(result);
    } catch (err) {
      logger.error({ err }, 'Brave Search API call failed');
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Brave Search API error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleFetch(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }

    let body: { url?: string; prompt?: string };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
        url?: string;
        prompt?: string;
      };
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid JSON body');
      return;
    }

    const { url: targetUrl, prompt } = body;
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url field');
      return;
    }

    const blocked = this.checkPrivateIp(targetUrl, taskId);
    if (blocked) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end(blocked);
      return;
    }

    try {
      const result = await this.fetchUrlAndSummarize(targetUrl, prompt);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(result);
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        res.writeHead(504, { 'Content-Type': 'text/plain' });
        res.end('Request timed out after 10s');
        return;
      }
      logger.error({ err, targetUrl }, 'web_fetch failed');
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private checkPrivateIp(targetUrl: string, taskId: string | undefined): string | null {
    let hostname: string;
    try {
      hostname = new URL(targetUrl).hostname;
    } catch {
      return 'Invalid URL';
    }

    if (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      PRIVATE_IP_RE.test(hostname)
    ) {
      if (taskId !== undefined) {
        this.db.insertSecurityEvent({
          eventType: 'ssrf_attempt',
          userId: taskId,
          severity: 'high',
          details: { blocked_url: targetUrl, reason: 'private_ip' },
        });
      }
      logger.warn({ targetUrl, taskId }, 'Blocked private IP fetch attempt');
      return 'Blocked: private or link-local address not allowed';
    }
    return null;
  }

  private async callBraveSearch(
    query: string,
    count: number,
    apiKey: string,
  ): Promise<string> {
    const searchUrl = new URL(BRAVE_SEARCH_URL);
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('count', String(Math.min(Math.max(count, 1), 20)));
    searchUrl.searchParams.set('extra_snippets', 'true');

    const response = await fetch(searchUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as BraveSearchResponse;
    return this.formatSearchResults(query, data);
  }

  private async fetchUrlAndSummarize(targetUrl: string, prompt?: string): Promise<string> {
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VigilClaw/1.0; +https://github.com/vigilclaw)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    let textContent: string;

    if (contentType.includes('text/html')) {
      const html = await response.text();
      textContent = NodeHtmlMarkdown.translate(html).slice(0, MARKDOWN_TRUNCATE);
    } else {
      textContent = (await response.text()).slice(0, RAW_TRUNCATE);
    }

    return this.summarizeWithHaiku(targetUrl, textContent, prompt);
  }

  private async summarizeWithHaiku(
    sourceUrl: string,
    content: string,
    prompt?: string,
  ): Promise<string> {
    const { apiKey, authToken } = this.getAnthropicCredentials();
    const effectivePrompt = prompt ?? 'Summarize the key information from this page content.';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    } else if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const body = JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      system:
        'You are a precise web content summarizer. Extract and summarize key information from the provided page content. Be concise and factual. Respond in the same language as the content.',
      messages: [
        {
          role: 'user',
          content: `URL: ${sourceUrl}\n\nPage content:\n${content}\n\nTask: ${effectivePrompt}`,
        },
      ],
    });

    let apiResponse: Response;
    try {
      apiResponse = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(HAIKU_TIMEOUT_MS),
      });
    } catch (err) {
      logger.warn({ err, sourceUrl }, 'Haiku summarization failed, returning truncated content');
      return `[Source: ${sourceUrl}]\n\n${content.slice(0, 3000)}`;
    }

    if (!apiResponse.ok) {
      logger.warn({ status: apiResponse.status, sourceUrl }, 'Haiku API error, returning truncated content');
      return `[Source: ${sourceUrl}]\n\n${content.slice(0, 3000)}`;
    }

    const data = (await apiResponse.json()) as AnthropicMessage;
    const text = data.content.find((c) => c.type === 'text')?.text ?? '';
    return `[Source: ${sourceUrl}]\n\n${text}`;
  }

  private formatSearchResults(query: string, data: BraveSearchResponse): string {
    const results = data.web?.results ?? [];
    if (results.length === 0) {
      return `No results found for: ${query}`;
    }

    const lines: string[] = [`Search results for "${query}":\n`];
    for (const [i, result] of results.entries()) {
      lines.push(`${i + 1}. **${result.title}**`);
      lines.push(`   ${result.url}`);
      if (result.description) {
        lines.push(`   ${result.description}`);
      }
      if (result.extra_snippets && result.extra_snippets.length > 0) {
        for (const snippet of result.extra_snippets.slice(0, 2)) {
          lines.push(`   › ${snippet}`);
        }
      }
      lines.push('');
    }
    lines.push(`(${results.length} results)`);
    return lines.join('\n');
  }

  private getBraveApiKey(): string | null {
    const envKey = process.env.BRAVE_SEARCH_API_KEY;
    if (envKey) return envKey;

    const cred = this.db.getCredential('brave-search');
    if (!cred) return null;
    return decrypt(cred.keyEncrypted, cred.iv, this.masterKey);
  }

  private getAnthropicCredentials(): { apiKey?: string; authToken?: string } {
    const apiKeyCred = this.db.getCredential('anthropic');
    const authTokenCred = this.db.getCredential('anthropic.auth_token');

    const apiKey = apiKeyCred
      ? decrypt(apiKeyCred.keyEncrypted, apiKeyCred.iv, this.masterKey)
      : (process.env.ANTHROPIC_API_KEY ?? undefined);

    const authToken = authTokenCred
      ? decrypt(authTokenCred.keyEncrypted, authTokenCred.iv, this.masterKey)
      : (process.env.ANTHROPIC_AUTH_TOKEN ?? undefined);

    return {
      apiKey: apiKey ?? undefined,
      authToken: authToken ?? undefined,
    };
  }
}
