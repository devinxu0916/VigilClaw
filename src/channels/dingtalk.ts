import type { IChannel } from './types.js';
import type { DingTalkConfig } from '../config.js';
import { splitMessage } from './message-utils.js';
import { logger } from '../logger.js';

type MessageHandler = (msg: {
  userId: string;
  groupId?: string;
  text?: string;
  images?: Buffer[];
  timestamp: Date;
}) => Promise<void>;

/** 钉钉 Access Token 缓存 */
interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

/** 钉钉 Stream 注册响应 */
interface StreamEndpoint {
  endpoint: string;
  ticket: string;
}

/** 钉钉回调消息体 */
interface DingTalkCallbackPayload {
  specVersion: string;
  type: string;
  headers: Record<string, string>;
  data: string;
}

/** 钉钉消息事件体 */
interface DingTalkMessageEvent {
  msgtype?: string;
  text?: { content?: string };
  conversationId?: string;
  conversationType?: string;
  chatbotCorpId?: string;
  senderStaffId?: string;
  senderNick?: string;
  msgId?: string;
  createAt?: number;
  conversationTitle?: string;
  atUsers?: Array<{ dingtalkId?: string }>;
  isInAtList?: boolean;
}

/**
 * 钉钉渠道 — 基于 Stream 长连接（零第三方依赖）
 *
 * 使用 Node.js 22 内建 WebSocket + fetch，不引入额外 SDK。
 */
export class DingTalkChannel implements IChannel {
  readonly name = 'dingtalk';
  private config: DingTalkConfig;
  private messageHandler: MessageHandler | null = null;
  private tokenCache: TokenCache | null = null;
  private ws: WebSocket | null = null;
  private running = false;
  private processedMsgIds = new Set<string>();
  private lastSendTime = 0;

  constructor(config: DingTalkConfig) {
    this.config = config;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.connectStream();
    logger.info('DingTalk channel started (Stream)');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async stop(): Promise<void> {
    this.running = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.processedMsgIds.clear();
    logger.info('DingTalk channel stopped');
  }

  async sendMessage(userId: string, groupId: string | undefined, text: string): Promise<void> {
    const chunks = splitMessage(text, 2048);
    for (const chunk of chunks) {
      await this.throttle();

      if (groupId) {
        await this.sendGroupMessage(groupId, chunk);
      } else {
        await this.sendPrivateMessage(userId, chunk);
      }
    }
  }

  async sendImage(
    userId: string,
    groupId: string | undefined,
    _image: Buffer,
    caption?: string,
  ): Promise<void> {
    // 钉钉 OpenAPI 不支持直接发送图片 Buffer，降级为文本
    if (caption) {
      await this.sendMessage(userId, groupId, `[图片] ${caption}`);
    } else {
      await this.sendMessage(userId, groupId, '[图片]');
    }
  }

  // ── Access Token 管理 ──

  async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60_000) {
      return this.tokenCache.accessToken;
    }

    const resp = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appKey: this.config.appKey,
        appSecret: this.config.appSecret,
      }),
    });

    if (!resp.ok) {
      throw new Error(`DingTalk getAccessToken failed: ${String(resp.status)} ${resp.statusText}`);
    }

    const data = (await resp.json()) as { accessToken: string; expireIn: number };
    this.tokenCache = {
      accessToken: data.accessToken,
      expiresAt: Date.now() + data.expireIn * 1000,
    };

    logger.debug('DingTalk access token refreshed');
    return data.accessToken;
  }

  // ── Stream 长连接 ──

  private async connectStream(): Promise<void> {
    try {
      const token = await this.getAccessToken();
      const endpoint = await this.registerStream(token);
      this.setupWebSocket(endpoint);
    } catch (err) {
      logger.error({ err }, 'DingTalk: failed to connect stream');
      if (this.running) {
        setTimeout(() => {
          void this.connectStream();
        }, 5000);
      }
    }
  }

  private async registerStream(accessToken: string): Promise<StreamEndpoint> {
    const resp = await fetch(
      'https://api.dingtalk.com/v1.0/gateway/connections/open',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          clientId: this.config.appKey,
          clientSecret: this.config.appSecret,
          subscriptions: [{ type: 'EVENT', topic: '/v1.0/im/bot/messages/get' }],
          ua: 'vigilclaw',
        }),
      },
    );

    if (!resp.ok) {
      throw new Error(`DingTalk registerStream failed: ${String(resp.status)} ${resp.statusText}`);
    }

    const data = (await resp.json()) as { endpoint: string; ticket: string };
    return { endpoint: data.endpoint, ticket: data.ticket };
  }

  private setupWebSocket(endpoint: StreamEndpoint): void {
    const url = `${endpoint.endpoint}?ticket=${encodeURIComponent(endpoint.ticket)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      logger.debug('DingTalk WebSocket connected');
    });

    ws.addEventListener('message', (event) => {
      void this.handleWsMessage(event.data as string);
    });

    ws.addEventListener('close', () => {
      logger.warn('DingTalk WebSocket closed');
      if (this.running) {
        setTimeout(() => {
          void this.connectStream();
        }, 5000);
      }
    });

    ws.addEventListener('error', (event) => {
      logger.error({ err: event }, 'DingTalk WebSocket error');
    });
  }

  private async handleWsMessage(raw: string): Promise<void> {
    let payload: DingTalkCallbackPayload;
    try {
      payload = JSON.parse(raw) as DingTalkCallbackPayload;
    } catch {
      return;
    }

    const headers = payload.headers;
    const msgType = headers['type'] ?? payload.type;

    // 心跳
    if (msgType === 'SYSTEM') {
      this.sendAck(headers['messageId'] ?? '');
      return;
    }

    // 先 ACK 再处理
    this.sendAck(headers['messageId'] ?? '');

    if (msgType === 'EVENT' || msgType === 'CALLBACK') {
      await this.handleCallback(payload.data);
    }
  }

  private sendAck(messageId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        code: 200,
        headers: { contentType: 'application/json', messageId },
        message: 'OK',
        data: '',
      }),
    );
  }

  private async handleCallback(dataStr: string): Promise<void> {
    if (!this.messageHandler) return;

    let event: DingTalkMessageEvent;
    try {
      event = JSON.parse(dataStr) as DingTalkMessageEvent;
    } catch {
      return;
    }

    const msgId = event.msgId ?? '';

    // 消息去重
    if (this.processedMsgIds.has(msgId)) return;
    this.processedMsgIds.add(msgId);
    if (this.processedMsgIds.size > 10000) {
      const entries = [...this.processedMsgIds];
      this.processedMsgIds = new Set(entries.slice(entries.length / 2));
    }

    const staffId = event.senderStaffId ?? '';
    if (!staffId) return;

    const conversationType = event.conversationType;
    const conversationId = event.conversationId ?? '';
    const isGroup = conversationType === '2';

    // 白名单检查
    if (!this.isAllowed(staffId, isGroup ? conversationId : undefined)) return;

    const userId = `dingtalk:${staffId}`;
    const groupId = isGroup ? `dingtalk:group:${conversationId}` : undefined;

    if (event.msgtype === 'text') {
      const text = event.text?.content?.trim();
      if (!text) return;

      await this.messageHandler({
        userId,
        groupId,
        text,
        timestamp: new Date(event.createAt ?? Date.now()),
      });
    }
  }

  // ── 消息发送 ──

  private async sendGroupMessage(groupId: string, text: string): Promise<void> {
    const token = await this.getAccessToken();
    const conversationId = groupId.replace('dingtalk:group:', '');

    const resp = await fetch(
      'https://api.dingtalk.com/v1.0/robot/groupMessages/send',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': token,
        },
        body: JSON.stringify({
          robotCode: this.config.robotCode,
          openConversationId: conversationId,
          msgKey: 'sampleMarkdown',
          msgParam: JSON.stringify({ title: 'VigilClaw', text }),
        }),
      },
    );

    if (!resp.ok) {
      // 降级纯文本
      const fallbackResp = await fetch(
        'https://api.dingtalk.com/v1.0/robot/groupMessages/send',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': token,
          },
          body: JSON.stringify({
            robotCode: this.config.robotCode,
            openConversationId: conversationId,
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content: text }),
          }),
        },
      );

      if (!fallbackResp.ok) {
        logger.error(
          { status: fallbackResp.status },
          'DingTalk: failed to send group message',
        );
      }
    }
  }

  private async sendPrivateMessage(userId: string, text: string): Promise<void> {
    const token = await this.getAccessToken();
    const staffId = userId.replace('dingtalk:', '');

    const resp = await fetch(
      'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': token,
        },
        body: JSON.stringify({
          robotCode: this.config.robotCode,
          userIds: [staffId],
          msgKey: 'sampleMarkdown',
          msgParam: JSON.stringify({ title: 'VigilClaw', text }),
        }),
      },
    );

    if (!resp.ok) {
      // 降级纯文本
      const fallbackResp = await fetch(
        'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': token,
          },
          body: JSON.stringify({
            robotCode: this.config.robotCode,
            userIds: [staffId],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content: text }),
          }),
        },
      );

      if (!fallbackResp.ok) {
        logger.error(
          { status: fallbackResp.status },
          'DingTalk: failed to send private message',
        );
      }
    }
  }

  // ── 工具方法 ──

  private isAllowed(staffId: string, conversationId: string | undefined): boolean {
    const { allowedUsers, allowedGroups } = this.config;

    if (allowedUsers.length === 0 && allowedGroups.length === 0) return true;

    if (conversationId && allowedGroups.length > 0 && allowedGroups.includes(conversationId))
      return true;

    if (allowedUsers.length > 0 && allowedUsers.includes(staffId)) return true;

    if (allowedUsers.length === 0 && allowedGroups.length > 0 && !conversationId) return true;

    return false;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastSendTime;
    if (elapsed < this.config.cooldownMs) {
      await sleep(this.config.cooldownMs - elapsed);
    }
    this.lastSendTime = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
