export interface TaskInput {
  taskId: string;
  userId: string;
  groupId?: string;
  messages: Array<{ role: string; content: string }>;
  model: string;
  maxTokens: number;
  tools: string[];
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  response: {
    content: string;
    usage: { inputTokens: number; outputTokens: number };
    model: string;
  };
}

export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  execute(params: Record<string, unknown>): Promise<string>;
}
