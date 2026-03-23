import type { QueuedTask, TaskResult } from './types.js';
import type { VigilClawDB } from './db.js';
import type { IProvider, ChatResponse } from './provider/types.js';
import { createProvider } from './provider/factory.js';
import type { ProviderType } from './provider/factory.js';
import type { IRunner } from './runner-types.js';
import { decrypt } from './crypto.js';
import { logger } from './logger.js';
import type { SearchBridge } from './search-bridge.js';

const MAX_TURNS = 30;

const SYSTEM_PROMPT = `You are a helpful AI assistant. You can help users with various tasks.
Keep responses concise and focused.`;

export class LocalRunner implements IRunner {
  private searchBridge?: SearchBridge;

  constructor(
    private db: VigilClawDB,
    private masterKey: Buffer,
  ) {}

  setSearchBridge(bridge: SearchBridge): void {
    this.searchBridge = bridge;
  }

  async runTask(task: QueuedTask): Promise<TaskResult> {
    const hasWebSearch = task.skills?.some((s) => s.name === 'web-search') ?? false;
    if (hasWebSearch && this.searchBridge) {
      // SearchBridge is available for direct function calls (search / fetchAndSummarize).
      // LocalRunner does not currently execute tool calls — tool results are not injected
      // into the conversation. This note exists so future tool-capable LocalRunner can use:
      //   await this.searchBridge.search(query, count)
      //   await this.searchBridge.fetchAndSummarize(url, prompt)
      logger.debug({ taskId: task.id }, 'web-search skill requested; SearchBridge available for direct calls');
    } else if (hasWebSearch) {
      logger.warn({ taskId: task.id }, 'web-search skill requested but SearchBridge not configured');
    }

    const providerType = (task.provider || 'claude') as ProviderType;
    const provider = await this.createProviderForTask(providerType);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const messages = [...task.messages];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response: ChatResponse = await provider.chat({
        model: task.model,
        messages,
        system: SYSTEM_PROMPT,
        maxTokens: 4096,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      if (response.stopReason === 'end_turn' || response.stopReason === 'stop_sequence') {
        const textContent = response.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('');

        return {
          taskId: task.id,
          success: true,
          response: {
            content: textContent,
            usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
            model: task.model,
          },
        };
      }

      const assistantContent = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');

      if (assistantContent) {
        messages.push({ role: 'assistant', content: assistantContent });
      }
    }

    return {
      taskId: task.id,
      success: false,
      response: {
        content: 'Agent reached maximum turns.',
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        model: task.model,
      },
    };
  }

  private async createProviderForTask(providerType: ProviderType): Promise<IProvider> {
    const config: Record<string, string | undefined> = {};

    if (providerType === 'claude') {
      const baseUrl = this.decryptCredential('anthropic.base_url');
      const authToken = this.decryptCredential('anthropic.auth_token');
      const apiKey = this.decryptCredential('anthropic');
      if (baseUrl) config.baseURL = baseUrl;
      config.apiKey = authToken ?? apiKey ?? undefined;
    } else if (providerType === 'openai') {
      const apiKey = this.decryptCredential('openai');
      if (apiKey) config.apiKey = apiKey;
    } else if (providerType === 'ollama') {
      const baseUrl = this.decryptCredential('ollama.base_url');
      if (baseUrl) config.baseUrl = baseUrl;
    }

    logger.debug(
      { providerType, hasCredentials: Object.keys(config).length > 0 },
      'Creating provider for local task',
    );

    return createProvider(providerType, config);
  }

  private decryptCredential(key: string): string | null {
    const cred = this.db.getCredential(key);
    if (!cred) return null;
    return decrypt(cred.keyEncrypted, cred.iv, this.masterKey);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async drainAll(_timeoutMs: number): Promise<void> {
    // LocalRunner has no containers to drain
  }
}
