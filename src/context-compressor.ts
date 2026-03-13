import { logger } from './logger.js';
import { calculateCost } from './provider/claude.js';
import type { VigilClawDB } from './db.js';
import type { ClaudeProvider } from './provider/claude.js';
import type { Message } from './types.js';

const SUMMARIZATION_MODEL = 'claude-haiku-3-5-20250929';

const SUMMARY_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to create a concise but thorough summary of a conversation.

Rules:
- Preserve ALL code snippets, file paths, function names, and technical details exactly
- Preserve user preferences, decisions made, and action items
- Preserve error messages and their resolutions
- Use bullet points for clarity
- Keep the summary under 500 words
- Write in the same language the conversation uses`;

const INCREMENTAL_SUMMARY_PROMPT = `Below is the existing summary of earlier conversation, followed by new messages that need to be incorporated.

Create an updated summary that merges the existing summary with the new information. Do NOT simply append — integrate and deduplicate.

EXISTING SUMMARY:
{existing_summary}

NEW MESSAGES TO INCORPORATE:
{new_messages}

UPDATED SUMMARY:`;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content) + 4;
  }
  return total;
}

interface CompressorConfig {
  maxContextTokens: number;
  recentMessagesKeep: number;
}

export class ContextCompressor {
  constructor(
    private provider: ClaudeProvider,
    private db: VigilClawDB,
    private config: CompressorConfig,
  ) {}

  async compress(
    sessionKey: string,
    messages: Message[],
    userId: string,
    groupId?: string,
  ): Promise<Message[]> {
    const totalTokens = estimateMessagesTokens(messages);

    if (totalTokens <= this.config.maxContextTokens) {
      const existingSummary = this.db.getContextSummary(sessionKey);
      if (existingSummary) {
        return [
          { role: 'system', content: `[Conversation Summary]\n${existingSummary}` },
          ...messages,
        ];
      }
      return messages;
    }

    const recentCount = Math.min(this.config.recentMessagesKeep, messages.length);
    const recentMessages = messages.slice(-recentCount);
    const oldMessages = messages.slice(0, -recentCount);

    if (oldMessages.length === 0) {
      return messages;
    }

    try {
      const existingSummary = this.db.getContextSummary(sessionKey);
      const { summary, usage } = await this.generateSummary(existingSummary, oldMessages);

      this.db.upsertContextSummary(sessionKey, summary);

      const cost = calculateCost(SUMMARIZATION_MODEL, usage.inputTokens, usage.outputTokens);
      this.db.recordApiCall({
        taskId: `summary:${sessionKey}`,
        userId,
        groupId,
        provider: 'anthropic',
        model: SUMMARIZATION_MODEL,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: cost,
      });

      return [{ role: 'system', content: `[Conversation Summary]\n${summary}` }, ...recentMessages];
    } catch (err) {
      logger.warn({ err, sessionKey }, 'Summarization failed, falling back to truncation');
      return recentMessages;
    }
  }

  private async generateSummary(
    existingSummary: string | null,
    oldMessages: Message[],
  ): Promise<{ summary: string; usage: { inputTokens: number; outputTokens: number } }> {
    const formattedMessages = oldMessages.map((m) => `${m.role}: ${m.content}`).join('\n\n');

    let userPrompt: string;
    if (existingSummary) {
      userPrompt = INCREMENTAL_SUMMARY_PROMPT.replace(
        '{existing_summary}',
        existingSummary,
      ).replace('{new_messages}', formattedMessages);
    } else {
      userPrompt = `Summarize the following conversation:\n\n${formattedMessages}`;
    }

    const response = await this.provider.chat({
      model: SUMMARIZATION_MODEL,
      messages: [{ role: 'user', content: userPrompt }],
      system: SUMMARY_SYSTEM_PROMPT,
      maxTokens: 1024,
      temperature: 0.3,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const summary = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    return { summary, usage: response.usage };
  }
}
