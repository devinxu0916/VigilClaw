import { Bot, InputFile } from 'grammy';
import type { IChannel } from './types.js';
import type { TelegramConfig } from '../config.js';
import { logger } from '../logger.js';

type MessageHandler = (msg: {
  userId: string;
  groupId?: string;
  text?: string;
  images?: Buffer[];
  timestamp: Date;
}) => Promise<void>;

export class TelegramChannel implements IChannel {
  readonly name = 'telegram';
  private bot: Bot;
  private messageHandler: MessageHandler | null = null;

  constructor(private config: TelegramConfig) {
    this.bot = new Bot(config.botToken);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  setup(): void {
    if (this.config.allowedUsers.length > 0) {
      this.bot.use(async (ctx, next) => {
        const userId = ctx.from?.id.toString();
        if (userId && this.config.allowedUsers.includes(userId)) {
          await next();
        }
      });
    }

    this.bot.on('message:text', async (ctx) => {
      if (!this.messageHandler) return;

      await this.messageHandler({
        userId: `telegram:${ctx.from.id}`,
        groupId: ctx.chat.type !== 'private' ? `telegram:group:${ctx.chat.id}` : undefined,
        text: ctx.message.text,
        timestamp: new Date(ctx.message.date * 1000),
      });
    });

    this.bot.on('message:photo', async (ctx) => {
      if (!this.messageHandler) return;

      const photo = ctx.message.photo.at(-1);
      if (!photo) return;

      try {
        const file = await ctx.api.getFile(photo.file_id);
        const url = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());

        await this.messageHandler({
          userId: `telegram:${ctx.from.id}`,
          groupId: ctx.chat.type !== 'private' ? `telegram:group:${ctx.chat.id}` : undefined,
          text: ctx.message.caption,
          images: [buffer],
          timestamp: new Date(ctx.message.date * 1000),
        });
      } catch (err) {
        logger.error({ err }, 'Failed to process photo message');
      }
    });

    this.bot.catch((err) => {
      logger.error({ err: err.error }, 'Telegram bot error');
    });
  }

  async start(): Promise<void> {
    this.setup();

    if (this.config.mode === 'webhook' && this.config.webhookUrl) {
      await this.bot.api.setWebhook(this.config.webhookUrl);
      logger.info({ url: this.config.webhookUrl }, 'Telegram bot started (webhook)');
    } else {
      this.bot.start({
        onStart: () => logger.info('Telegram bot started (polling)'),
      });
    }
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  async sendMessage(userId: string, groupId: string | undefined, text: string): Promise<void> {
    const chatId = this.resolveChatId(userId, groupId);
    const chunks = splitMessage(text, 4096);
    for (const chunk of chunks) {
      try {
        await this.bot.api.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
      } catch {
        await this.bot.api.sendMessage(chatId, chunk);
      }
    }
  }

  async sendImage(
    userId: string,
    groupId: string | undefined,
    image: Buffer,
    caption?: string,
  ): Promise<void> {
    const chatId = this.resolveChatId(userId, groupId);
    await this.bot.api.sendPhoto(chatId, new InputFile(image), { caption });
  }

  private resolveChatId(userId: string, groupId: string | undefined): string {
    if (groupId) return groupId.replace('telegram:group:', '');
    return userId.replace('telegram:', '');
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}
