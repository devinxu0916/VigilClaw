import type { Message } from '../types.js';

/**
 * IProvider — LLM Provider 抽象接口
 * MVP: Claude 实现
 * Phase 2: OpenAI, Gemini 实现
 */
export interface IProvider {
  readonly name: string;

  /** 同步调用（等待完整响应） */
  chat(params: ChatParams): Promise<ChatResponse>;

  /** 流式调用（逐 chunk 返回） */
  stream(params: ChatParams): AsyncGenerator<ChatChunk>;

  /** 将 ITool[] 转换为 Provider 特定的工具定义 */
  toolDefinitions(tools: ITool[]): unknown[];

  /** 估算费用（$） */
  estimateCost(inputTokens: number, outputTokens: number, model: string): number;
}

export interface ChatParams {
  model: string;
  messages: Message[];
  tools?: unknown[];
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export interface ChatResponse {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface ChatChunk {
  type: 'text_delta' | 'tool_use_start' | 'tool_input_delta' | 'block_stop' | 'message_stop';
  text?: string;
  toolName?: string;
  toolId?: string;
  partialJson?: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

/**
 * ITool — 工具抽象接口
 */
export interface ITool {
  readonly name: string;
  readonly description: string;
  readonly schema: ToolSchema;

  execute(params: Record<string, unknown>): Promise<string>;
}

export interface ToolSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: string;
      description: string;
      enum?: string[];
    }
  >;
  required?: string[];
}
