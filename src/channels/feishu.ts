import { Client, WSClient, EventDispatcher, LoggerLevel } from '@larksuiteoapi/node-sdk';
import type { IChannel } from './types.js';
import type { FeishuConfig } from '../config.js';
import { splitMessage } from './message-utils.js';
import { logger } from '../logger.js';

type MessageHandler = (msg: {
  userId: string;
  groupId?: string;
  text?: string;
  images?: Buffer[];
  timestamp: Date;
}) => Promise<void>;

/** 飞书 Post 富文本内容节点 */
interface PostNode {
  tag: string;
  text?: string;
  href?: string;
  style?: string[];
}

/** im.message.receive_v1 事件 data 类型（与 SDK IHandles 内联类型对齐） */
interface FeishuMessageEvent {
  sender: {
    sender_id?: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: { union_id?: string; user_id?: string; open_id?: string };
      name: string;
      tenant_key?: string;
    }>;
  };
}

/**
 * 飞书渠道 — 基于 @larksuiteoapi/node-sdk WSClient 长连接
 */
export class FeishuChannel implements IChannel {
  readonly name = 'feishu';
  private client: Client;
  private wsClient: WSClient | null = null;
  private messageHandler: MessageHandler | null = null;
  private processedMsgIds = new Set<string>();
  private config: FeishuConfig;

  constructor(config: FeishuConfig) {
    this.config = config;
    this.client = new Client({
      appId: config.appId,
      appSecret: config.appSecret,
    });
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    const eventDispatcher = new EventDispatcher({
      encryptKey: this.config.encryptKey ?? '',
      verificationToken: this.config.verificationToken ?? '',
    });

    eventDispatcher.register({
      'im.message.receive_v1': (data: FeishuMessageEvent) => {
        void this.handleEvent(data);
      },
    });

    this.wsClient = new WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      loggerLevel: LoggerLevel.warn,
    });

    await this.wsClient.start({ eventDispatcher });
    logger.info('Feishu channel started (WebSocket)');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async stop(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    this.processedMsgIds.clear();
    logger.info('Feishu channel stopped');
  }

  async sendMessage(userId: string, groupId: string | undefined, text: string): Promise<void> {
    const chunks = splitMessage(text, 4000);
    for (const chunk of chunks) {
      const chatId = this.resolveChatId(userId, groupId);

      // 尝试 post 富文本，降级纯文本
      try {
        const postContent = markdownToPost(chunk);
        await this.client.im.message.create({
          params: { receive_id_type: groupId ? 'chat_id' : 'open_id' },
          data: {
            receive_id: chatId,
            msg_type: 'post',
            content: JSON.stringify({ zh_cn: { title: '', content: postContent } }),
          },
        });
      } catch {
        await this.client.im.message.create({
          params: { receive_id_type: groupId ? 'chat_id' : 'open_id' },
          data: {
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({ text: chunk }),
          },
        });
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
    const receiveIdType = groupId ? 'chat_id' : 'open_id';

    try {
      // 上传图片获取 image_key
      const uploadResp = await this.client.im.image.create({
        data: {
          image_type: 'message',
          image: Buffer.from(image),
        },
      });

      const imageKey = uploadResp?.image_key;
      if (!imageKey) {
        throw new Error('Failed to upload image: no image_key returned');
      }

      await this.client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: chatId,
          msg_type: 'image',
          content: JSON.stringify({ image_key: imageKey }),
        },
      });

      // 如果有 caption，单独发一条文本
      if (caption) {
        await this.sendMessage(userId, groupId, caption);
      }
    } catch (err) {
      logger.error({ err }, 'Feishu: failed to send image');
      // 降级：如果有 caption 就发文本
      if (caption) {
        await this.sendMessage(userId, groupId, `[图片] ${caption}`);
      }
    }
  }

  private async handleEvent(data: FeishuMessageEvent): Promise<void> {
    if (!this.messageHandler) return;

    const message = data.message;
    const sender = data.sender;

    const messageId = message.message_id;

    // 消息去重
    if (this.processedMsgIds.has(messageId)) return;
    this.processedMsgIds.add(messageId);
    if (this.processedMsgIds.size > 10000) {
      // 保留后半部分
      const entries = [...this.processedMsgIds];
      this.processedMsgIds = new Set(entries.slice(entries.length / 2));
    }

    const openId = sender.sender_id?.open_id ?? '';
    if (!openId) return;

    const chatType = message.chat_type;
    const chatId = message.chat_id;

    // 白名单检查
    if (!this.isAllowed(openId, chatType === 'group' ? chatId : undefined)) return;

    const userId = `feishu:${openId}`;
    const groupId = chatType === 'group' ? `feishu:group:${chatId}` : undefined;

    const msgType = message.message_type;
    const contentStr = message.content;

    try {
      if (msgType === 'text') {
        const parsed = JSON.parse(contentStr) as { text?: string };
        let text = parsed.text ?? '';

        // 群聊 @机器人 mention 剥离
        if (chatType === 'group' && message.mentions) {
          for (const mention of message.mentions) {
            if (mention.key) {
              text = text.replace(mention.key, '').trim();
            }
          }
        }

        if (!text) return;

        await this.messageHandler({
          userId,
          groupId,
          text,
          timestamp: new Date(Number(message.create_time)),
        });
      } else if (msgType === 'image') {
        const parsed = JSON.parse(contentStr) as { image_key?: string };
        const imageKey = parsed.image_key;
        if (!imageKey) return;

        try {
          const resp = await this.client.im.messageResource.get({
            path: { message_id: messageId, file_key: imageKey },
            params: { type: 'image' },
          });

          // resp 可能是一个 ReadableStream 或 Buffer
          const buffer = await streamToBuffer(resp);

          await this.messageHandler({
            userId,
            groupId,
            images: [buffer],
            timestamp: new Date(Number(message.create_time)),
          });
        } catch (err) {
          logger.error({ err, messageId }, 'Feishu: failed to download image');
        }
      }
    } catch (err) {
      logger.error({ err, messageId }, 'Feishu: failed to process message');
    }
  }

  private isAllowed(openId: string, chatId: string | undefined): boolean {
    const { allowedUsers, allowedGroups } = this.config;

    // 如果两个白名单都为空，允许所有
    if (allowedUsers.length === 0 && allowedGroups.length === 0) return true;

    // 群组白名单
    if (chatId && allowedGroups.length > 0 && allowedGroups.includes(chatId)) return true;

    // 用户白名单
    if (allowedUsers.length > 0 && allowedUsers.includes(openId)) return true;

    // 如果只配了群组白名单、没配用户白名单，群聊外的单聊也放行
    if (allowedUsers.length === 0 && allowedGroups.length > 0 && !chatId) return true;

    return false;
  }

  private resolveChatId(userId: string, groupId: string | undefined): string {
    if (groupId) return groupId.replace('feishu:group:', '');
    return userId.replace('feishu:', '');
  }
}

/**
 * 将流/Buffer 响应转换为 Buffer
 */
async function streamToBuffer(resp: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(resp)) return resp;

  // ReadableStream（浏览器标准流）
  if (resp && typeof resp === 'object' && 'getReader' in resp) {
    const reader = (resp as ReadableStream<Uint8Array>).getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) parts.push(value); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
    }
    return Buffer.concat(parts);
  }

  // Node.js Readable stream
  if (resp && typeof resp === 'object' && Symbol.asyncIterator in resp) {
    const parts: Buffer[] = [];
    for await (const chunk of resp as AsyncIterable<Buffer>) {
      parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(parts);
  }

  throw new Error('Unexpected response type from Feishu API');
}

/**
 * 简易 Markdown → 飞书 Post 富文本转换
 *
 * 支持：**粗体**、`代码`、[链接](url)、换行分段
 */
export function markdownToPost(text: string): PostNode[][] {
  const lines = text.split('\n');
  const paragraphs: PostNode[][] = [];

  for (const line of lines) {
    const nodes: PostNode[] = [];

    // 使用正则解析 Markdown 行内标记
    const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))|([^*`[]+)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      if (match[2]) {
        // **粗体**
        nodes.push({ tag: 'text', text: match[2], style: ['bold'] });
      } else if (match[4]) {
        // `代码`
        nodes.push({ tag: 'text', text: match[4], style: ['italic'] });
      } else if (match[6] && match[7]) {
        // [链接](url)
        nodes.push({ tag: 'a', text: match[6], href: match[7] });
      } else if (match[8]) {
        // 普通文本
        nodes.push({ tag: 'text', text: match[8] });
      }
    }

    if (nodes.length === 0) {
      nodes.push({ tag: 'text', text: '' });
    }

    paragraphs.push(nodes);
  }

  return paragraphs;
}
