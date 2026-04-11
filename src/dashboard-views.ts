/**
 * Dashboard HTML template functions.
 * All functions return raw HTML strings — no template engine dependency.
 */

// ---- Types for view data ----

export interface OverviewStats {
  todayCost: number;
  monthCost: number;
  todayCalls: number;
  monthCalls: number;
  todayTasks: number;
  monthTasks: number;
}

export interface ModelBreakdown {
  model: string;
  call_count: number;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
}

export interface HealthChecks {
  sqlite: boolean;
  docker: boolean;
  uptime: number;
  memoryMB: number;
}

export interface TaskRow {
  id: string;
  user_id: string;
  group_id: string | null;
  status: string;
  input_summary: string | null;
  total_cost_usd: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface SecurityEventRow {
  id: number;
  event_type: string;
  user_id: string | null;
  severity: string;
  details: string | null;
  created_at: string;
}

export interface ScheduledTaskView {
  id: string;
  user_id: string;
  cron_expression: string;
  task_prompt: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export interface SkillView {
  name: string;
  version: string;
  description: string | null;
  enabled: boolean;
}

export interface CredentialView {
  provider: string;
  last_rotated_at: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

// ---- Helper ----

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function severityBadge(severity: string): string {
  const colors: Record<string, string> = {
    critical: '#dc3545',
    high: '#fd7e14',
    medium: '#ffc107',
    low: '#198754',
  };
  const color = colors[severity] ?? '#6c757d';
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.8em">${esc(severity)}</span>`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    completed: '#198754',
    running: '#0d6efd',
    pending: '#6c757d',
    failed: '#dc3545',
    timeout: '#fd7e14',
  };
  const color = colors[status] ?? '#6c757d';
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.8em">${esc(status)}</span>`;
}

function paginationNav(p: Pagination, endpoint: string, token: string): string {
  const totalPages = Math.max(1, Math.ceil(p.total / p.pageSize));
  if (totalPages <= 1) return '';

  let html = '<nav style="display:flex;gap:8px;justify-content:center;margin-top:16px">';
  if (p.page > 1) {
    html += `<a href="#" hx-get="${endpoint}?token=${esc(token)}&page=${p.page - 1}" hx-target="#tab-content" hx-swap="innerHTML">&laquo; Prev</a>`;
  }
  html += `<span>Page ${p.page} / ${totalPages}</span>`;
  if (p.page < totalPages) {
    html += `<a href="#" hx-get="${endpoint}?token=${esc(token)}&page=${p.page + 1}" hx-target="#tab-content" hx-swap="innerHTML">&raquo; Next</a>`;
  }
  html += '</nav>';
  return html;
}

// ---- Main page shell ----

export function renderPage(
  body: string,
  token: string,
  uptime: number,
  activeTab: string = 'overview',
): string {
  const tabs = [
    { id: 'overview', label: 'Overview', endpoint: '/api/overview' },
    { id: 'tasks', label: 'Tasks', endpoint: '/api/tasks' },
    { id: 'system', label: 'System', endpoint: '/api/system' },
  ];

  const tabHtml = tabs
    .map(
      (t) =>
        `<a href="#" role="tab" ${t.id === activeTab ? 'aria-selected="true" class="active-tab"' : ''}
          hx-get="${t.endpoint}?token=${esc(token)}"
          hx-target="#tab-content"
          hx-swap="innerHTML"
          onclick="document.querySelectorAll('[role=tab]').forEach(e=>e.removeAttribute('aria-selected'));document.querySelectorAll('[role=tab]').forEach(e=>e.classList.remove('active-tab'));this.setAttribute('aria-selected','true');this.classList.add('active-tab')"
        >${t.label}</a>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VigilClaw Dashboard</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    :root { --pico-font-size: 15px; }
    body { margin: 0; }
    nav.dashboard-nav {
      background: var(--pico-primary-background);
      color: #fff;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    nav.dashboard-nav .brand { font-weight: 700; font-size: 1.2em; }
    nav.dashboard-nav .status { font-size: 0.85em; opacity: 0.8; margin-left: auto; }
    .tab-bar { display: flex; gap: 0; border-bottom: 2px solid var(--pico-muted-border-color); margin-bottom: 24px; }
    .tab-bar a {
      padding: 10px 20px;
      text-decoration: none;
      border-bottom: 3px solid transparent;
      color: var(--pico-muted-color);
      font-weight: 500;
    }
    .tab-bar a.active-tab, .tab-bar a[aria-selected="true"] {
      border-bottom-color: var(--pico-primary);
      color: var(--pico-primary);
    }
    .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card {
      background: var(--pico-card-background-color);
      border: 1px solid var(--pico-muted-border-color);
      border-radius: 8px;
      padding: 16px;
    }
    .stat-card .label { font-size: 0.85em; color: var(--pico-muted-color); margin-bottom: 4px; }
    .stat-card .value { font-size: 1.6em; font-weight: 700; }
    table { width: 100%; font-size: 0.9em; }
    td, th { padding: 8px 12px; }
    .truncate { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  </style>
</head>
<body>
  <nav class="dashboard-nav">
    <span class="brand">VigilClaw</span>
    <span class="status">Uptime: ${formatUptime(uptime)}</span>
  </nav>
  <main class="container" style="padding-top:24px">
    <div class="tab-bar" role="tablist">
      ${tabHtml}
    </div>
    <div id="tab-content"
         hx-get="/api/${esc(activeTab)}?token=${esc(token)}"
         hx-trigger="load, every 30s"
         hx-swap="innerHTML">
      ${body}
    </div>
  </main>
</body>
</html>`;
}

// ---- Overview tab ----

export function renderOverview(
  stats: OverviewStats,
  modelBreakdown: ModelBreakdown[],
  health: HealthChecks,
): string {
  const cards = `
    <div class="card-grid">
      <div class="stat-card">
        <div class="label">Today Cost</div>
        <div class="value">${formatCost(stats.todayCost)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Month Cost</div>
        <div class="value">${formatCost(stats.monthCost)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Today API Calls</div>
        <div class="value">${stats.todayCalls}</div>
      </div>
      <div class="stat-card">
        <div class="label">Month API Calls</div>
        <div class="value">${stats.monthCalls}</div>
      </div>
      <div class="stat-card">
        <div class="label">Today Tasks</div>
        <div class="value">${stats.todayTasks}</div>
      </div>
      <div class="stat-card">
        <div class="label">Month Tasks</div>
        <div class="value">${stats.monthTasks}</div>
      </div>
    </div>`;

  const healthSection = `
    <h5>Health</h5>
    <div class="card-grid" style="margin-bottom:24px">
      <div class="stat-card">
        <div class="label">SQLite</div>
        <div class="value">${health.sqlite ? '&#9989;' : '&#10060;'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Docker</div>
        <div class="value">${health.docker ? '&#9989;' : '&#10060;'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Memory</div>
        <div class="value">${health.memoryMB} MB</div>
      </div>
    </div>`;

  let modelTable = '';
  if (modelBreakdown.length > 0) {
    const rows = modelBreakdown
      .map(
        (m) =>
          `<tr><td>${esc(m.model)}</td><td>${m.call_count}</td><td>${formatCost(m.total_cost)}</td><td>${m.input_tokens.toLocaleString()}</td><td>${m.output_tokens.toLocaleString()}</td></tr>`,
      )
      .join('');
    modelTable = `
      <h5>Model Breakdown (Today)</h5>
      <table>
        <thead><tr><th>Model</th><th>Calls</th><th>Cost</th><th>Input Tokens</th><th>Output Tokens</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  return cards + healthSection + modelTable;
}

// ---- Tasks tab ----

export function renderTasks(
  tasks: TaskRow[],
  pagination: Pagination,
  scheduledTasks: ScheduledTaskView[],
  token: string,
): string {
  const taskRows = tasks
    .map(
      (t) =>
        `<tr>
          <td style="font-family:monospace;font-size:0.8em">${esc(t.id.slice(0, 8))}</td>
          <td>${esc(t.user_id)}</td>
          <td>${statusBadge(t.status)}</td>
          <td class="truncate">${esc(t.input_summary ?? '-')}</td>
          <td>${t.total_cost_usd !== null ? formatCost(t.total_cost_usd) : '-'}</td>
          <td>${esc(t.created_at)}</td>
        </tr>`,
    )
    .join('');

  const tasksSection = `
    <h5>Recent Tasks</h5>
    <table>
      <thead><tr><th>ID</th><th>User</th><th>Status</th><th>Summary</th><th>Cost</th><th>Created</th></tr></thead>
      <tbody>${taskRows || '<tr><td colspan="6">No tasks found</td></tr>'}</tbody>
    </table>
    ${paginationNav(pagination, '/api/tasks', token)}`;

  const schedRows = scheduledTasks
    .map(
      (s) =>
        `<tr id="sched-${esc(s.id)}">
          <td style="font-family:monospace;font-size:0.8em">${esc(s.id.slice(0, 8))}</td>
          <td>${esc(s.user_id)}</td>
          <td><code>${esc(s.cron_expression)}</code></td>
          <td class="truncate">${esc(s.task_prompt)}</td>
          <td>${s.enabled ? '&#9989; Enabled' : '&#10060; Disabled'}</td>
          <td>${esc(s.next_run_at ?? '-')}</td>
          <td>
            <button
              hx-post="/api/schedules/${esc(s.id)}/toggle?token=${esc(token)}"
              hx-target="#sched-${esc(s.id)}"
              hx-swap="outerHTML"
              style="padding:4px 12px;font-size:0.8em"
            >${s.enabled ? 'Disable' : 'Enable'}</button>
            <button
              hx-delete="/api/schedules/${esc(s.id)}?token=${esc(token)}"
              hx-target="#sched-${esc(s.id)}"
              hx-swap="outerHTML"
              hx-confirm="Delete this scheduled task?"
              style="padding:4px 12px;font-size:0.8em;background:#dc3545;border-color:#dc3545"
            >Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  const schedSection = `
    <h5 style="margin-top:32px">Scheduled Tasks</h5>
    <table>
      <thead><tr><th>ID</th><th>User</th><th>Cron</th><th>Prompt</th><th>Status</th><th>Next Run</th><th>Actions</th></tr></thead>
      <tbody>${schedRows || '<tr><td colspan="7">No scheduled tasks</td></tr>'}</tbody>
    </table>`;

  return tasksSection + schedSection;
}

// ---- System tab ----

export function renderSystem(
  skills: SkillView[],
  securityEvents: SecurityEventRow[],
  securityPagination: Pagination,
  credentials: CredentialView[],
  token: string,
): string {
  const skillRows = skills
    .map(
      (s) =>
        `<tr id="skill-${esc(s.name)}">
          <td>${esc(s.name)}</td>
          <td>${esc(s.version)}</td>
          <td class="truncate">${esc(s.description ?? '-')}</td>
          <td>${s.enabled ? '&#9989; Enabled' : '&#10060; Disabled'}</td>
          <td>
            <button
              hx-post="/api/skills/${esc(s.name)}/toggle?token=${esc(token)}"
              hx-target="#skill-${esc(s.name)}"
              hx-swap="outerHTML"
              style="padding:4px 12px;font-size:0.8em"
            >${s.enabled ? 'Disable' : 'Enable'}</button>
          </td>
        </tr>`,
    )
    .join('');

  const skillsSection = `
    <h5>Skills</h5>
    <table>
      <thead><tr><th>Name</th><th>Version</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${skillRows || '<tr><td colspan="5">No skills installed</td></tr>'}</tbody>
    </table>`;

  const eventRows = securityEvents
    .map(
      (e) =>
        `<tr>
          <td>${severityBadge(e.severity)}</td>
          <td>${esc(e.event_type)}</td>
          <td>${esc(e.user_id ?? '-')}</td>
          <td class="truncate">${esc(e.details ?? '-')}</td>
          <td>${esc(e.created_at)}</td>
        </tr>`,
    )
    .join('');

  const eventsSection = `
    <h5 style="margin-top:32px">Security Events</h5>
    <table>
      <thead><tr><th>Severity</th><th>Type</th><th>User</th><th>Details</th><th>Time</th></tr></thead>
      <tbody>${eventRows || '<tr><td colspan="5">No security events</td></tr>'}</tbody>
    </table>
    ${paginationNav(securityPagination, '/api/security', token)}`;

  const credRows = credentials
    .map(
      (c) =>
        `<tr>
          <td>${esc(c.provider)}</td>
          <td>${esc(c.last_rotated_at ?? 'Never')}</td>
        </tr>`,
    )
    .join('');

  const credSection = `
    <h5 style="margin-top:32px">Credentials</h5>
    <table>
      <thead><tr><th>Provider</th><th>Last Rotated</th></tr></thead>
      <tbody>${credRows || '<tr><td colspan="2">No credentials stored</td></tr>'}</tbody>
    </table>`;

  return skillsSection + eventsSection + credSection;
}

// ---- Partial renders for htmx inline swap ----

export function renderScheduledTaskRow(s: ScheduledTaskView, token: string): string {
  return `<tr id="sched-${esc(s.id)}">
    <td style="font-family:monospace;font-size:0.8em">${esc(s.id.slice(0, 8))}</td>
    <td>${esc(s.user_id)}</td>
    <td><code>${esc(s.cron_expression)}</code></td>
    <td class="truncate">${esc(s.task_prompt)}</td>
    <td>${s.enabled ? '&#9989; Enabled' : '&#10060; Disabled'}</td>
    <td>${esc(s.next_run_at ?? '-')}</td>
    <td>
      <button
        hx-post="/api/schedules/${esc(s.id)}/toggle?token=${esc(token)}"
        hx-target="#sched-${esc(s.id)}"
        hx-swap="outerHTML"
        style="padding:4px 12px;font-size:0.8em"
      >${s.enabled ? 'Disable' : 'Enable'}</button>
      <button
        hx-delete="/api/schedules/${esc(s.id)}?token=${esc(token)}"
        hx-target="#sched-${esc(s.id)}"
        hx-swap="outerHTML"
        hx-confirm="Delete this scheduled task?"
        style="padding:4px 12px;font-size:0.8em;background:#dc3545;border-color:#dc3545"
      >Delete</button>
    </td>
  </tr>`;
}

export function renderSkillRow(s: SkillView, token: string): string {
  return `<tr id="skill-${esc(s.name)}">
    <td>${esc(s.name)}</td>
    <td>${esc(s.version)}</td>
    <td class="truncate">${esc(s.description ?? '-')}</td>
    <td>${s.enabled ? '&#9989; Enabled' : '&#10060; Disabled'}</td>
    <td>
      <button
        hx-post="/api/skills/${esc(s.name)}/toggle?token=${esc(token)}"
        hx-target="#skill-${esc(s.name)}"
        hx-swap="outerHTML"
        style="padding:4px 12px;font-size:0.8em"
      >${s.enabled ? 'Disable' : 'Enable'}</button>
    </td>
  </tr>`;
}
