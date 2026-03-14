import Anthropic from '@anthropic-ai/sdk';
import type { QueuedTask, TaskResult } from './types.js';
import type { VigilClawDB } from './db.js';
import { decrypt } from './crypto.js';
import { logger } from './logger.js';

const MAX_TURNS = 30;

const SYSTEM_PROMPT = `You are a helpful AI assistant. You can help users with various tasks.
Keep responses concise and focused.`;

export class LocalRunner {
  constructor(
    private db: VigilClawDB,
    private masterKey: Buffer,
  ) {}

  async runTask(task: QueuedTask): Promise<TaskResult> {
    const client = this.createClient();

    const systemMessages = task.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const systemPrompt =
      systemMessages.length > 0
        ? SYSTEM_PROMPT + '\n\n' + systemMessages.join('\n\n')
        : SYSTEM_PROMPT;

    const messages: Anthropic.MessageParam[] = task.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: task.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
        const textContent = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
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

  private createClient(): Anthropic {
    const baseUrl = this.decryptCredential('anthropic.base_url');
    const authToken = this.decryptCredential('anthropic.auth_token');
    const apiKey = this.decryptCredential('anthropic');

    const options: Record<string, unknown> = {};

    if (baseUrl) {
      options.baseURL = baseUrl;
    }

    if (authToken) {
      options.apiKey = authToken;
    } else if (apiKey) {
      options.apiKey = apiKey;
    }

    logger.debug(
      { baseUrl: baseUrl ? '***set***' : 'default', hasToken: !!(authToken ?? apiKey) },
      'Creating Anthropic client',
    );

    return new Anthropic(options as ConstructorParameters<typeof Anthropic>[0]);
  }

  private decryptCredential(key: string): string | null {
    const cred = this.db.getCredential(key);
    if (!cred) return null;
    return decrypt(cred.keyEncrypted, cred.iv, this.masterKey);
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
