import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { CostReport } from './types.js';
import { logger } from './logger.js';

const SCHEMA_V1 = `
CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  name             TEXT,
  role             TEXT NOT NULL DEFAULT 'user',
  current_model    TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
  max_cost_per_day   REAL NOT NULL DEFAULT 10.0,
  max_cost_per_month REAL NOT NULL DEFAULT 100.0,
  settings         TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key      TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  group_id         TEXT,
  role             TEXT NOT NULL,
  content          TEXT NOT NULL,
  tokens           INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_messages_session   ON messages(session_key, created_at DESC);
CREATE INDEX idx_messages_user_time ON messages(user_id, created_at DESC);

CREATE TABLE api_calls (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  group_id         TEXT,
  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  input_tokens     INTEGER NOT NULL,
  output_tokens    INTEGER NOT NULL,
  cost_usd         REAL NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_api_calls_user_time ON api_calls(user_id, created_at);
CREATE INDEX idx_api_calls_task      ON api_calls(task_id);
CREATE INDEX idx_api_calls_user_date ON api_calls(user_id, date(created_at));

CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  group_id         TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  container_id     TEXT,
  input_summary    TEXT,
  output_summary   TEXT,
  total_cost_usd   REAL DEFAULT 0,
  error_message    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  started_at       TEXT,
  completed_at     TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_tasks_status ON tasks(status, created_at);
CREATE INDEX idx_tasks_user   ON tasks(user_id, created_at DESC);

CREATE TABLE credentials (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  provider         TEXT NOT NULL UNIQUE,
  key_encrypted    BLOB NOT NULL,
  iv               BLOB NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_rotated_at  TEXT
);

CREATE TABLE security_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type       TEXT NOT NULL,
  user_id          TEXT,
  severity         TEXT NOT NULL,
  details          TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_security_severity ON security_events(severity, created_at DESC);
CREATE INDEX idx_security_type     ON security_events(event_type, created_at DESC);

CREATE TABLE scheduled_tasks (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  group_id         TEXT,
  cron_expression  TEXT NOT NULL,
  task_prompt      TEXT NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1,
  last_run_at      TEXT,
  next_run_at      TEXT,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  max_retries      INTEGER NOT NULL DEFAULT 3,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_scheduled_next ON scheduled_tasks(enabled, next_run_at);

CREATE TABLE settings (
  key              TEXT PRIMARY KEY,
  value            TEXT NOT NULL,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO settings (key, value) VALUES
  ('version', '1'),
  ('budget_reset_hour_utc', '0'),
  ('max_concurrent_containers', '5');
`;

interface Migration {
  version: number;
  description: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, description: 'Initial schema', up: SCHEMA_V1 },
  {
    version: 2,
    description: 'Context compression and persistent memory',
    up: `
CREATE TABLE context_summaries (
  session_key      TEXT PRIMARY KEY,
  summary          TEXT NOT NULL,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE memories (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL,
  group_id         TEXT,
  scope_key        TEXT NOT NULL,
  content          TEXT NOT NULL,
  metadata         TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_memories_scope ON memories(scope_key, created_at DESC);
CREATE INDEX idx_memories_user  ON memories(user_id, created_at DESC);
`,
  },
];

function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);
  if (pending.length === 0) return;

  const migrate = db.transaction(() => {
    for (const migration of pending) {
      db.exec(migration.up);
      db.pragma(`user_version = ${migration.version}`);
    }
  });

  migrate();
}

function initRawDatabase(dbPath: string): { db: Database.Database; vecAvailable: boolean } {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON');

  // Load sqlite-vec extension (graceful degradation)
  let vecAvailable = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
    vecAvailable = true;
  } catch {
    logger.warn('sqlite-vec extension not available — memory features disabled');
  }

  runMigrations(db);

  // Create vec_memories virtual table after sqlite-vec is loaded and migration v2 has run
  if (vecAvailable) {
    const currentVersion = db.pragma('user_version', { simple: true }) as number;
    if (currentVersion >= 2) {
      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
            embedding float[384]
          )
        `);
      } catch (err) {
        logger.warn({ err }, 'Failed to create vec_memories virtual table');
        vecAvailable = false;
      }
    }
  }

  return { db, vecAvailable };
}

export class VigilClawDB {
  private db: Database.Database;
  private stmts: ReturnType<VigilClawDB['prepareStatements']>;
  readonly vecAvailable: boolean;

  constructor(dbPath: string) {
    const { db, vecAvailable } = initRawDatabase(dbPath);
    this.db = db;
    this.vecAvailable = vecAvailable;
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insertMessage: this.db.prepare(`
        INSERT INTO messages (session_key, user_id, group_id, role, content, tokens)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getRecentMessages: this.db.prepare(`
        SELECT role, content FROM messages
        WHERE session_key = ?
        ORDER BY id DESC
        LIMIT ?
      `),
      deleteMessages: this.db.prepare(`DELETE FROM messages WHERE session_key = ?`),
      insertApiCall: this.db.prepare(`
        INSERT INTO api_calls (task_id, user_id, group_id, provider, model, input_tokens, output_tokens, cost_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getUserDayCost: this.db.prepare(`
        SELECT COALESCE(SUM(cost_usd), 0) as total
        FROM api_calls
        WHERE user_id = ? AND date(created_at) = date('now')
      `),
      getUserMonthCost: this.db.prepare(`
        SELECT COALESCE(SUM(cost_usd), 0) as total
        FROM api_calls
        WHERE user_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      `),
      insertTask: this.db.prepare(`
        INSERT INTO tasks (id, user_id, group_id, status, input_summary)
        VALUES (?, ?, ?, 'pending', ?)
      `),
      updateTaskRunning: this.db.prepare(`
        UPDATE tasks SET status = 'running', started_at = datetime('now'), container_id = ?
        WHERE id = ?
      `),
      updateTaskCompleted: this.db.prepare(`
        UPDATE tasks SET status = ?, output_summary = ?, total_cost_usd = ?,
          error_message = ?, completed_at = datetime('now')
        WHERE id = ?
      `),
      getOrCreateUser: this.db.prepare(`
        INSERT INTO users (id, name) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')
        RETURNING *
      `),
      getUser: this.db.prepare(`SELECT * FROM users WHERE id = ?`),
      updateUserBudget: this.db.prepare(`
        UPDATE users SET max_cost_per_day = ?, max_cost_per_month = ?, updated_at = datetime('now')
        WHERE id = ?
      `),
      upsertCredential: this.db.prepare(`
        INSERT INTO credentials (provider, key_encrypted, iv)
        VALUES (?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
          key_encrypted = excluded.key_encrypted,
          iv = excluded.iv,
          last_rotated_at = datetime('now')
      `),
      getCredential: this.db.prepare(
        `SELECT key_encrypted, iv FROM credentials WHERE provider = ?`,
      ),
      insertSecurityEvent: this.db.prepare(`
        INSERT INTO security_events (event_type, user_id, severity, details)
        VALUES (?, ?, ?, ?)
      `),
      getDueScheduledTasks: this.db.prepare(`
        SELECT * FROM scheduled_tasks
        WHERE enabled = 1 AND next_run_at <= datetime('now')
        ORDER BY next_run_at ASC
      `),
      updateScheduledTaskLastRun: this.db.prepare(`
        UPDATE scheduled_tasks SET last_run_at = datetime('now'), retry_count = 0
        WHERE id = ?
      `),
      upsertContextSummary: this.db.prepare(`
        INSERT INTO context_summaries (session_key, summary, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(session_key) DO UPDATE SET
          summary = excluded.summary,
          updated_at = datetime('now')
      `),
      getContextSummary: this.db.prepare(
        `SELECT summary FROM context_summaries WHERE session_key = ?`,
      ),
      deleteContextSummary: this.db.prepare(`DELETE FROM context_summaries WHERE session_key = ?`),
      insertMemory: this.db.prepare(`
        INSERT INTO memories (user_id, group_id, scope_key, content, metadata)
        VALUES (?, ?, ?, ?, ?)
      `),
      getMemoriesByScope: this.db.prepare(`
        SELECT id, content FROM memories WHERE scope_key = ? ORDER BY created_at DESC
      `),
    };
  }

  insertMessage(msg: {
    sessionKey: string;
    userId: string;
    groupId?: string;
    role: string;
    content: string;
    tokens?: number;
  }): void {
    this.stmts.insertMessage.run(
      msg.sessionKey,
      msg.userId,
      msg.groupId ?? null,
      msg.role,
      msg.content,
      msg.tokens ?? null,
    );
  }

  getRecentMessages(sessionKey: string, limit: number): Array<{ role: string; content: string }> {
    const rows = this.stmts.getRecentMessages.all(sessionKey, limit) as Array<{
      role: string;
      content: string;
    }>;
    return rows.reverse();
  }

  deleteMessages(sessionKey: string): void {
    this.stmts.deleteMessages.run(sessionKey);
  }

  recordApiCall(call: {
    taskId: string;
    userId: string;
    groupId?: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): void {
    this.stmts.insertApiCall.run(
      call.taskId,
      call.userId,
      call.groupId ?? null,
      call.provider,
      call.model,
      call.inputTokens,
      call.outputTokens,
      call.costUsd,
    );
  }

  getUserDayCost(userId: string): number {
    const row = this.stmts.getUserDayCost.get(userId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  getUserMonthCost(userId: string): number {
    const row = this.stmts.getUserMonthCost.get(userId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  getOrCreateUser(id: string, name: string): Record<string, unknown> {
    return this.stmts.getOrCreateUser.get(id, name) as Record<string, unknown>;
  }

  getUser(
    id: string,
  ): { maxCostPerDay: number; maxCostPerMonth: number; currentModel: string } | null {
    const row = this.stmts.getUser.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      maxCostPerDay: row.max_cost_per_day as number,
      maxCostPerMonth: row.max_cost_per_month as number,
      currentModel: row.current_model as string,
    };
  }

  updateUserBudget(userId: string, dayLimit: number, monthLimit: number): void {
    this.stmts.updateUserBudget.run(dayLimit, monthLimit, userId);
  }

  insertTask(task: { id: string; userId: string; groupId?: string; inputSummary?: string }): void {
    this.stmts.insertTask.run(
      task.id,
      task.userId,
      task.groupId ?? null,
      task.inputSummary ?? null,
    );
  }

  updateTaskRunning(taskId: string, containerId: string): void {
    this.stmts.updateTaskRunning.run(containerId, taskId);
  }

  updateTaskCompleted(
    taskId: string,
    status: 'completed' | 'failed' | 'timeout',
    opts?: { outputSummary?: string; totalCost?: number; error?: string },
  ): void {
    this.stmts.updateTaskCompleted.run(
      status,
      opts?.outputSummary ?? null,
      opts?.totalCost ?? 0,
      opts?.error ?? null,
      taskId,
    );
  }

  upsertCredential(provider: string, keyEncrypted: Buffer, iv: Buffer): void {
    this.stmts.upsertCredential.run(provider, keyEncrypted, iv);
  }

  getCredential(provider: string): { keyEncrypted: Buffer; iv: Buffer } | null {
    const row = this.stmts.getCredential.get(provider) as
      | { key_encrypted: Buffer; iv: Buffer }
      | undefined;
    if (!row) return null;
    return { keyEncrypted: row.key_encrypted, iv: row.iv };
  }

  insertSecurityEvent(event: {
    eventType: string;
    userId?: string;
    severity: string;
    details: Record<string, unknown>;
  }): void {
    this.stmts.insertSecurityEvent.run(
      event.eventType,
      event.userId ?? null,
      event.severity,
      JSON.stringify(event.details),
    );
  }

  getDueScheduledTasks(): Array<Record<string, unknown>> {
    return this.stmts.getDueScheduledTasks.all() as Array<Record<string, unknown>>;
  }

  updateScheduledTaskLastRun(taskId: string): void {
    this.stmts.updateScheduledTaskLastRun.run(taskId);
  }

  upsertContextSummary(sessionKey: string, summary: string): void {
    this.stmts.upsertContextSummary.run(sessionKey, summary);
  }

  getContextSummary(sessionKey: string): string | null {
    const row = this.stmts.getContextSummary.get(sessionKey) as { summary: string } | undefined;
    return row?.summary ?? null;
  }

  deleteContextSummary(sessionKey: string): void {
    this.stmts.deleteContextSummary.run(sessionKey);
  }

  insertMemory(memory: {
    userId: string;
    groupId?: string;
    scopeKey: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): number {
    const result = this.stmts.insertMemory.run(
      memory.userId,
      memory.groupId ?? null,
      memory.scopeKey,
      memory.content,
      memory.metadata ? JSON.stringify(memory.metadata) : null,
    );
    return Number(result.lastInsertRowid);
  }

  insertMemoryVector(rowid: number, embedding: Float32Array): void {
    this.db
      .prepare('INSERT INTO vec_memories(rowid, embedding) VALUES (?, ?)')
      .run(BigInt(rowid), embedding);
  }

  searchMemoryVectors(
    queryEmbedding: Float32Array,
    limit: number,
  ): Array<{ rowid: number; distance: number }> {
    return this.db
      .prepare(
        `SELECT rowid, distance FROM vec_memories
         WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      )
      .all(queryEmbedding, limit) as Array<{ rowid: number; distance: number }>;
  }

  getMemoryById(id: number): { content: string; scope_key: string } | null {
    const row = this.db.prepare('SELECT content, scope_key FROM memories WHERE id = ?').get(id) as
      | { content: string; scope_key: string }
      | undefined;
    return row ?? null;
  }

  getMemoriesByScope(scopeKey: string): Array<{ id: number; content: string }> {
    return this.stmts.getMemoriesByScope.all(scopeKey) as Array<{
      id: number;
      content: string;
    }>;
  }

  getCostReport(userId: string): CostReport {
    const dayCost = this.getUserDayCost(userId);
    const monthCost = this.getUserMonthCost(userId);
    const user = this.getUser(userId);

    const modelBreakdown = this.db
      .prepare(
        `SELECT model, COUNT(*) as call_count, SUM(cost_usd) as total_cost
       FROM api_calls WHERE user_id = ? AND date(created_at) = date('now')
       GROUP BY model ORDER BY total_cost DESC`,
      )
      .all(userId) as Array<{ model: string; call_count: number; total_cost: number }>;

    const topTasks = this.db
      .prepare(
        `SELECT input_summary, total_cost_usd FROM tasks
       WHERE user_id = ? AND date(created_at) = date('now') AND total_cost_usd > 0
       ORDER BY total_cost_usd DESC LIMIT 5`,
      )
      .all(userId) as Array<{ input_summary: string; total_cost_usd: number }>;

    return {
      dayCost,
      monthCost,
      dayBudget: user?.maxCostPerDay ?? 10.0,
      monthBudget: user?.maxCostPerMonth ?? 100.0,
      modelBreakdown,
      topTasks,
    };
  }

  cleanupOldData(): void {
    const cleanup = this.db.transaction(() => {
      this.db.prepare("DELETE FROM messages WHERE created_at < datetime('now', '-90 days')").run();
      this.db
        .prepare("DELETE FROM api_calls WHERE created_at < datetime('now', '-365 days')")
        .run();
      this.db.prepare("DELETE FROM tasks WHERE created_at < datetime('now', '-365 days')").run();
      this.db
        .prepare("DELETE FROM security_events WHERE created_at < datetime('now', '-365 days')")
        .run();

      if (this.vecAvailable) {
        const oldMemories = this.db
          .prepare("SELECT id FROM memories WHERE created_at < datetime('now', '-365 days')")
          .all() as Array<{ id: number }>;

        if (oldMemories.length > 0) {
          const ids = oldMemories.map((m) => m.id);
          for (const id of ids) {
            this.db.prepare('DELETE FROM vec_memories WHERE rowid = ?').run(BigInt(id));
          }
          this.db
            .prepare("DELETE FROM memories WHERE created_at < datetime('now', '-365 days')")
            .run();
        }
      } else {
        this.db
          .prepare("DELETE FROM memories WHERE created_at < datetime('now', '-365 days')")
          .run();
      }
    });
    cleanup();
  }

  close(): void {
    this.db.close();
  }
}
