import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import pino from 'pino';
import type { VigilClawDB } from './db.js';
import { decrypt } from './crypto.js';

const logger = pino({ name: 'credential-proxy' });

const ALLOWED_PATHS = ['/v1/messages', '/v1/complete', '/v1/chat/completions', '/chat/completions'];

const DEFAULT_PROVIDER_HOSTS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  claude: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};

export class CredentialProxy {
  private activeServers = new Map<string, { server: net.Server; port: number }>();

  constructor(
    private db: VigilClawDB,
    private masterKey: Buffer,
  ) {}

  async createProxyForTask(taskId: string, provider: string): Promise<number> {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res, taskId, provider).catch((err) => {
        logger.error({ err, taskId }, 'Proxy request failed');
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'Proxy error' }));
      });
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });

    this.activeServers.set(taskId, { server, port });
    logger.debug({ taskId, port }, 'Proxy started on TCP port');
    return port;
  }

  async destroyProxyForTask(taskId: string): Promise<void> {
    const entry = this.activeServers.get(taskId);
    if (entry) {
      await new Promise<void>((resolve) => {
        entry.server.close(() => resolve());
      });
      this.activeServers.delete(taskId);
    }
  }

  async destroyAll(): Promise<void> {
    const tasks = [...this.activeServers.keys()];
    await Promise.allSettled(tasks.map((id) => this.destroyProxyForTask(id)));
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string,
    provider: string,
  ): Promise<void> {
    const requestPath = req.url ?? '';

    if (!ALLOWED_PATHS.some((p) => requestPath.startsWith(p))) {
      this.db.insertSecurityEvent({
        eventType: 'credential_access',
        userId: taskId,
        severity: 'medium',
        details: { blocked_path: requestPath },
      });
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Path "${requestPath}" not allowed` }));
      return;
    }

    const targetBase = this.getProviderHost(provider);
    if (!targetBase) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown provider: ${provider}` }));
      return;
    }

    const apiKey = this.getAuthToken(provider);

    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(bodyChunks);

    const base = targetBase.endsWith('/') ? targetBase.slice(0, -1) : targetBase;
    const targetUrl = new URL(base + requestPath);

    const headers: Record<string, string> = {
      host: targetUrl.hostname,
      'content-type': req.headers['content-type'] ?? 'application/json',
      'content-length': body.length.toString(),
    };

    if (provider === 'claude' || provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['authorization'] = `Bearer ${apiKey}`;
    }

    if (req.headers['accept']) {
      headers['accept'] = req.headers['accept'] as string;
    }

    const proxyReq = https.request(targetUrl, {
      method: req.method ?? 'POST',
      headers,
    });

    proxyReq.on('response', (proxyRes) => {
      const resHeaders: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (value !== undefined) {
          resHeaders[key] = value;
        }
      }
      res.writeHead(proxyRes.statusCode ?? 500, resHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      logger.error({ err, taskId }, 'Upstream request failed');
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Upstream request failed' }));
    });

    proxyReq.write(body);
    proxyReq.end();
  }

  private decryptCredential(key: string): string | null {
    const cred = this.db.getCredential(key);
    if (!cred) return null;
    return decrypt(cred.keyEncrypted, cred.iv, this.masterKey);
  }

  private mapProviderToCredentialKey(provider: string): string {
    if (provider === 'claude') return 'anthropic';
    return provider;
  }

  private getProviderHost(provider: string): string | null {
    const credKey = this.mapProviderToCredentialKey(provider);
    const customUrl = this.decryptCredential(`${credKey}.base_url`);
    if (customUrl) return customUrl;
    return DEFAULT_PROVIDER_HOSTS[provider] ?? null;
  }

  private getAuthToken(provider: string): string {
    const credKey = this.mapProviderToCredentialKey(provider);
    const customToken = this.decryptCredential(`${credKey}.auth_token`);
    if (customToken) return customToken;

    const apiKey = this.decryptCredential(credKey);
    if (apiKey) return apiKey;

    throw new Error(`No credential found for provider: ${provider}`);
  }
}
