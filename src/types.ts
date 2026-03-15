/**
 * VigilClaw 共享类型定义
 */

// ---- 消息类型 ----

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface IncomingMessage {
  userId: string;
  groupId?: string;
  text?: string;
  images?: Buffer[];
  timestamp: Date;
  raw?: unknown;
}

// ---- 任务类型 ----

export interface QueuedTask {
  id: string;
  userId: string;
  groupId?: string;
  messages: Message[];
  provider: string;
  model: string;
  tools: string[];
  workspaceDir?: string;
  createdAt: Date;
  replyFn: (text: string) => Promise<void>;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

// ---- IPC 类型 ----

export interface TaskInput {
  taskId: string;
  userId: string;
  groupId?: string;
  messages: Message[];
  provider: string;
  model: string;
  maxTokens: number;
  tools: string[];
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  response: {
    content: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
    model: string;
  };
  error?: string;
}

// ---- 成本类型 ----

export interface CostReport {
  dayCost: number;
  monthCost: number;
  dayBudget: number;
  monthBudget: number;
  modelBreakdown: Array<{ model: string; call_count: number; total_cost: number }>;
  topTasks: Array<{ input_summary: string; total_cost_usd: number }>;
}

export interface BudgetStatus {
  exceeded: boolean;
  reason?: 'day_limit' | 'month_limit' | 'task_limit';
  currentCost: number;
  budgetLimit: number;
  remaining: number;
}

// ---- 安全类型 ----

export type SecurityEventType =
  | 'container_escape_attempt'
  | 'network_violation'
  | 'credential_access'
  | 'rate_limit_exceeded'
  | 'mount_violation'
  | 'budget_exceeded'
  | 'task_timeout'
  | 'container_oom_killed';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
