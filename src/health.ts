import http from 'node:http';
import type Docker from 'dockerode';
import type { VigilClawDB } from './db.js';
import { logger } from './logger.js';

interface HealthChecks {
  sqlite: boolean;
  docker: boolean;
  uptime: number;
  memoryMB: number;
}

function checkSqlite(db: VigilClawDB): boolean {
  try {
    db.getUserDayCost('__health_check__');
    return true;
  } catch {
    return false;
  }
}

async function checkDocker(docker: Docker): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export function startHealthServer(port: number, db: VigilClawDB, docker: Docker): http.Server {
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.url !== '/health') {
        res.writeHead(404);
        res.end();
        return;
      }

      const checks: HealthChecks = {
        sqlite: checkSqlite(db),
        docker: await checkDocker(docker),
        uptime: process.uptime(),
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      };

      const healthy = checks.sqlite && checks.docker;
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', checks }));
    })();
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'Health check server started');
  });

  return server;
}
