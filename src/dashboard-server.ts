import type http from 'node:http';
import type { VigilClawDB } from './db.js';
import type { SkillRegistry } from './skill-registry.js';
import type { TaskScheduler } from './task-scheduler.js';
import { checkAuth, setSessionCookie } from './dashboard-auth.js';
import {
  renderPage,
  renderOverview,
  renderTasks,
  renderSystem,
  renderScheduledTaskRow,
  renderSkillRow,
} from './dashboard-views.js';
import type {
  HealthChecks,
  TaskRow,
  SecurityEventRow,
  ScheduledTaskView,
  SkillView,
  CredentialView,
} from './dashboard-views.js';
import { logger } from './logger.js';

export interface DashboardDeps {
  db: VigilClawDB;
  token: string;
  skillRegistry: SkillRegistry | null;
  taskScheduler: TaskScheduler | null;
  healthChecks: () => Promise<HealthChecks>;
}

interface ParsedRoute {
  pathname: string;
  params: URLSearchParams;
  segments: string[];
}

function parseRoute(url: string): ParsedRoute {
  const parsed = new URL(url, 'http://localhost');
  const segments = parsed.pathname.split('/').filter(Boolean);
  return { pathname: parsed.pathname, params: parsed.searchParams, segments };
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendNotFound(res: http.ServerResponse): void {
  sendHtml(res, 404, '<h1>404 Not Found</h1>');
}

function sendUnauthorized(res: http.ServerResponse): void {
  sendHtml(res, 401, '<h1>401 Unauthorized</h1><p>Provide a valid token via ?token= or Authorization: Bearer header.</p>');
}

export function createDashboardHandler(
  deps: DashboardDeps,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const { db, token, skillRegistry, healthChecks } = deps;

  return (req: http.IncomingMessage, res: http.ServerResponse): void => {
    void (async (): Promise<void> => {
      try {
        const method = req.method ?? 'GET';
        const route = parseRoute(req.url ?? '/');

        // Auth check — all dashboard routes require token
        if (!checkAuth(req, token)) {
          sendUnauthorized(res);
          return;
        }

        // Set session cookie if not already present (so browser remembers auth)
        const cookieHeader = req.headers.cookie ?? '';
        if (!cookieHeader.includes('vigilclaw_session=')) {
          setSessionCookie(res, token);
        }

        // ---- Full page ----
        if (route.pathname === '/' && method === 'GET') {
          const [stats, modelBreakdown, health] = await Promise.all([
            Promise.resolve(db.getOverviewStats()),
            Promise.resolve(db.getModelBreakdownToday()),
            healthChecks(),
          ]);
          const overviewHtml = renderOverview(stats, modelBreakdown, health);
          sendHtml(res, 200, renderPage(overviewHtml, token, process.uptime(), 'overview'));
          return;
        }

        // ---- API fragments (htmx) ----

        if (route.pathname === '/api/overview' && method === 'GET') {
          const [stats, modelBreakdown, health] = await Promise.all([
            Promise.resolve(db.getOverviewStats()),
            Promise.resolve(db.getModelBreakdownToday()),
            healthChecks(),
          ]);
          sendHtml(res, 200, renderOverview(stats, modelBreakdown, health));
          return;
        }

        if (route.pathname === '/api/tasks' && method === 'GET') {
          const page = Math.max(1, parseInt(route.params.get('page') ?? '1', 10) || 1);
          const pageSize = 20;
          const { tasks, total } = db.getTasksPaginated(page, pageSize);
          const scheduledTasks = db.getAllScheduledTasks();
          sendHtml(
            res,
            200,
            renderTasks(
              tasks as unknown as TaskRow[],
              { page, pageSize, total },
              scheduledTasks as unknown as ScheduledTaskView[],
              token,
            ),
          );
          return;
        }

        if (route.pathname === '/api/system' && method === 'GET') {
          const skills = getSkillViews(skillRegistry);
          const page = Math.max(1, parseInt(route.params.get('page') ?? '1', 10) || 1);
          const pageSize = 20;
          const { events, total } = db.getSecurityEventsPaginated(page, pageSize);
          const credentials = db.listCredentialStatus();
          sendHtml(
            res,
            200,
            renderSystem(
              skills,
              events as unknown as SecurityEventRow[],
              { page, pageSize, total },
              credentials as unknown as CredentialView[],
              token,
            ),
          );
          return;
        }

        // ---- Schedule operations ----

        // POST /api/schedules/:id/toggle
        if (
          route.segments.length === 4 &&
          route.segments[0] === 'api' &&
          route.segments[1] === 'schedules' &&
          route.segments[3] === 'toggle' &&
          method === 'POST'
        ) {
          const schedId = route.segments[2]!;
          const task = db.getScheduledTaskById(schedId);
          if (!task) {
            sendHtml(res, 404, '');
            return;
          }
          const newEnabled = task.enabled === 0;
          db.adminToggleScheduledTask(schedId, newEnabled);
          if (newEnabled) {
            const { TaskScheduler: TS } = await import('./task-scheduler.js');
            const nextRunAt = TS.computeNextRun(task.cron_expression);
            if (nextRunAt) db.updateScheduledTaskNextRun(task.id, nextRunAt);
          }
          const updated = db.getScheduledTaskById(schedId);
          if (updated) {
            sendHtml(res, 200, renderScheduledTaskRow(updated as ScheduledTaskView, token));
          } else {
            sendHtml(res, 200, '');
          }
          return;
        }

        // DELETE /api/schedules/:id
        if (
          route.segments.length === 3 &&
          route.segments[0] === 'api' &&
          route.segments[1] === 'schedules' &&
          method === 'DELETE'
        ) {
          const schedId = route.segments[2]!;
          db.adminDeleteScheduledTask(schedId);
          sendHtml(res, 200, '');
          return;
        }

        // ---- Skill operations ----

        // POST /api/skills/:name/toggle
        if (
          route.segments.length === 4 &&
          route.segments[0] === 'api' &&
          route.segments[1] === 'skills' &&
          route.segments[3] === 'toggle' &&
          method === 'POST'
        ) {
          const skillName = decodeURIComponent(route.segments[2]!);
          if (!skillRegistry) {
            sendHtml(res, 404, '');
            return;
          }
          const currentSkills = skillRegistry.listSkills();
          const current = currentSkills.find((s) => s.name === skillName);
          if (!current) {
            sendHtml(res, 404, '');
            return;
          }
          if (current.enabled) {
            skillRegistry.disableSkill(skillName);
          } else {
            skillRegistry.enableSkill(skillName);
          }
          const updatedList = skillRegistry.listSkills();
          const updated = updatedList.find((s) => s.name === skillName);
          if (updated) {
            sendHtml(
              res,
              200,
              renderSkillRow(
                {
                  name: updated.name,
                  version: updated.version,
                  description: updated.description,
                  enabled: updated.enabled,
                },
                token,
              ),
            );
          } else {
            sendHtml(res, 200, '');
          }
          return;
        }

        // ---- Partial endpoints ----

        if (route.pathname === '/api/schedules' && method === 'GET') {
          const scheduledTasks = db.getAllScheduledTasks();
          const rows = (scheduledTasks as ScheduledTaskView[])
            .map((s) => renderScheduledTaskRow(s, token))
            .join('');
          sendHtml(res, 200, rows || '<tr><td colspan="7">No scheduled tasks</td></tr>');
          return;
        }

        if (route.pathname === '/api/skills' && method === 'GET') {
          const skills = getSkillViews(skillRegistry);
          const rows = skills.map((s) => renderSkillRow(s, token)).join('');
          sendHtml(res, 200, rows || '<tr><td colspan="5">No skills installed</td></tr>');
          return;
        }

        if (route.pathname === '/api/security' && method === 'GET') {
          const page = Math.max(1, parseInt(route.params.get('page') ?? '1', 10) || 1);
          const pageSize = 20;
          const { events, total } = db.getSecurityEventsPaginated(page, pageSize);
          const skills = getSkillViews(skillRegistry);
          const credentials = db.listCredentialStatus();
          sendHtml(
            res,
            200,
            renderSystem(
              skills,
              events as unknown as SecurityEventRow[],
              { page, pageSize, total },
              credentials as unknown as CredentialView[],
              token,
            ),
          );
          return;
        }

        if (route.pathname === '/api/credentials' && method === 'GET') {
          const credentials = db.listCredentialStatus();
          const rows = (credentials as CredentialView[])
            .map(
              (c) =>
                `<tr><td>${c.provider}</td><td>${c.last_rotated_at ?? 'Never'}</td></tr>`,
            )
            .join('');
          sendHtml(
            res,
            200,
            rows || '<tr><td colspan="2">No credentials stored</td></tr>',
          );
          return;
        }

        sendNotFound(res);
      } catch (err) {
        logger.error({ err }, 'Dashboard request error');
        if (!res.headersSent) {
          sendHtml(res, 500, '<h1>500 Internal Server Error</h1>');
        }
      }
    })();
  };
}

// ---- Helpers ----

function getSkillViews(skillRegistry: SkillRegistry | null): SkillView[] {
  if (!skillRegistry) return [];
  return skillRegistry.listSkills().map((s) => ({
    name: s.name,
    version: s.version,
    description: s.description,
    enabled: s.enabled,
  }));
}
