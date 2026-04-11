import http from 'node:http';
import type Docker from 'dockerode';
import type { VigilClawDB } from './db.js';
import { logger } from './logger.js';

export interface HealthChecks {
  sqlite: boolean;
  docker: boolean;
  uptime: number;
  memoryMB: number;
}

export function checkSqlite(db: VigilClawDB): boolean {
  try {
    db.getUserDayCost('__health_check__');
    return true;
  } catch {
    return false;
  }
}

export async function checkDocker(docker: Docker | null): Promise<boolean> {
  if (!docker) return false;
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export function startHealthServer(
  port: number,
  db: VigilClawDB,
  docker: Docker | null,
  host: string = '0.0.0.0',
  dashboardHandler?: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): http.Server {
  const server = http.createServer((req, res) => {
    void (async () => {
      // /health always accessible without auth
      if (req.url === '/health') {
        const checks: HealthChecks = {
          sqlite: checkSqlite(db),
          docker: await checkDocker(docker),
          uptime: process.uptime(),
          memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        };

        const healthy = checks.sqlite && (docker === null || checks.docker);
        res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', checks }));
        return;
      }

      // Delegate to dashboard handler if available
      if (dashboardHandler) {
        dashboardHandler(req, res);
        return;
      }

      res.writeHead(404);
      res.end();
    })();
  });

  server.listen(port, host, () => {
    logger.info({ port }, 'Health check server started');
  });

  return server;
}
