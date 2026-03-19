import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

// ── Mock @larksuiteoapi/node-sdk ──
const mockMessageCreate = vi.fn().mockResolvedValue({});
const mockImageCreate = vi.fn().mockResolvedValue({ image_key: 'img_test_key' });
const mockMessageResourceGet = vi.fn().mockResolvedValue(Buffer.from('fake-image'));
const mockWsClientStart = vi.fn().mockResolvedValue(undefined);
const mockWsClientClose = vi.fn();
const mockRegister = vi.fn().mockReturnThis();

vi.mock('@larksuiteoapi/node-sdk', () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      im: {
        message: { create: mockMessageCreate },
        image: { create: mockImageCreate },
        messageResource: { get: mockMessageResourceGet },
      },
    })),
    WSClient: vi.fn().mockImplementation(() => ({
      start: mockWsClientStart,
      close: mockWsClientClose,
    })),
    EventDispatcher: vi.fn().mockImplementation(() => ({
      register: mockRegister,
    })),
    LoggerLevel: { warn: 2 },
  };
});

vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { FeishuChannel, markdownToPost } from '../../src/channels/feishu.js';
import type { FeishuConfig } from '../../src/config.js';

function makeConfig(overrides: Partial<FeishuConfig> = {}): FeishuConfig {
  return {
    enabled: true,
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
    allowedUsers: [],
    allowedGroups: [],
    ...overrides,
  };
}

/** 从 EventDispatcher.register 回调中取出 im.message.receive_v1 处理器 */
function getEventHandler(): (data: unknown) => void {
  const registerCall = mockRegister.mock.calls[0] as [Record<string, (data: unknown) => void>];
  const handlers = registerCall[0];
  return handlers['im.message.receive_v1']!;
}

/** 构建一个标准的飞书消息事件 */
function makeEvent(overrides: {
  messageId?: string;
  messageType?: string;
  content?: string;
  chatType?: string;
  chatId?: string;
  openId?: string;
  mentions?: Array<{ key: string; id: Record<string, string>; name: string }>;
}): unknown {
  return {
    sender: {
      sender_id: { open_id: overrides.openId ?? 'ou_user1' },
      sender_type: 'user',
    },
    message: {
      message_id: overrides.messageId ?? `msg_${String(Date.now())}`,
      message_type: overrides.messageType ?? 'text',
      content: overrides.content ?? JSON.stringify({ text: 'Hello bot' }),
      chat_type: overrides.chatType ?? 'p2p',
      chat_id: overrides.chatId ?? '',
      create_time: String(Date.now()),
      mentions: overrides.mentions,
    },
  };
}

describe('FeishuChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 基本构造 ──

  it('should have name "feishu"', () => {
    const ch = new FeishuChannel(makeConfig());
    expect(ch.name).toBe('feishu');
  });

  // ── start / stop ──

  it('should start WSClient on start()', async () => {
    const ch = new FeishuChannel(makeConfig());
    await ch.start();
    expect(mockWsClientStart).toHaveBeenCalledWith(
      expect.objectContaining({ eventDispatcher: expect.anything() }),
    );
    expect(mockRegister).toHaveBeenCalled();
  });

  it('should stop cleanly', async () => {
    const ch = new FeishuChannel(makeConfig());
    await ch.start();
    await ch.stop();
    expect(mockWsClientClose).toHaveBeenCalled();
  });

  // ── sendMessage ──

  it('should send text message to user (open_id)', async () => {
    const ch = new FeishuChannel(makeConfig());
    await ch.sendMessage('feishu:ou_abc123', undefined, 'Hello');

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { receive_id_type: 'open_id' },
        data: expect.objectContaining({
          receive_id: 'ou_abc123',
          msg_type: 'post',
        }),
      }),
    );
  });

  it('should send text message to group (chat_id)', async () => {
    const ch = new FeishuChannel(makeConfig());
    await ch.sendMessage('feishu:ou_abc', 'feishu:group:oc_chat1', 'Hello group');

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { receive_id_type: 'chat_id' },
        data: expect.objectContaining({
          receive_id: 'oc_chat1',
        }),
      }),
    );
  });

  it('should fallback to plain text on post failure', async () => {
    mockMessageCreate.mockRejectedValueOnce(new Error('post failed'));
    const ch = new FeishuChannel(makeConfig());
    await ch.sendMessage('feishu:ou_abc', undefined, 'fallback');

    expect(mockMessageCreate).toHaveBeenCalledTimes(2);
    // 第二次调用应为纯文本
    const secondCall = mockMessageCreate.mock.calls[1] as Array<{
      data: { msg_type: string };
    }>;
    expect(secondCall[0]!.data.msg_type).toBe('text');
  });

  it('should split long messages into chunks', async () => {
    const ch = new FeishuChannel(makeConfig());
    const longText = 'A'.repeat(5000);
    await ch.sendMessage('feishu:ou_abc', undefined, longText);

    expect(mockMessageCreate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // ── sendImage ──

  it('should upload and send image', async () => {
    const ch = new FeishuChannel(makeConfig());
    const buf = Buffer.from('png-data');
    await ch.sendImage('feishu:ou_abc', undefined, buf, 'caption');

    expect(mockImageCreate).toHaveBeenCalled();
    // 发图 + 发 caption 文本
    expect(mockMessageCreate).toHaveBeenCalledTimes(2);
  });

  it('should fallback to text on image upload failure', async () => {
    mockImageCreate.mockRejectedValueOnce(new Error('upload failed'));
    const ch = new FeishuChannel(makeConfig());
    await ch.sendImage('feishu:ou_abc', undefined, Buffer.from('x'), 'cap');

    // 降级发文本
    expect(mockMessageCreate).toHaveBeenCalled();
  });

  // ── 消息事件处理（通过模拟 EventDispatcher 回调） ──

  it('should process text message from event', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new FeishuChannel(makeConfig());
    ch.onMessage(handler);
    await ch.start();

    const onReceive = getEventHandler();
    onReceive(makeEvent({}));

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'feishu:ou_user1',
          groupId: undefined,
          text: 'Hello bot',
        }),
      );
    });
  });

  it('should deduplicate messages', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new FeishuChannel(makeConfig());
    ch.onMessage(handler);
    await ch.start();

    const onReceive = getEventHandler();
    const eventData = makeEvent({ messageId: 'msg_dup' });

    onReceive(eventData);
    onReceive(eventData);

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  it('should strip @mention in group chat', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new FeishuChannel(makeConfig());
    ch.onMessage(handler);
    await ch.start();

    const onReceive = getEventHandler();
    onReceive(
      makeEvent({
        messageId: 'msg_mention',
        content: JSON.stringify({ text: '@_user_1 请帮我查一下' }),
        chatType: 'group',
        chatId: 'oc_grp1',
        mentions: [{ key: '@_user_1', id: {}, name: 'Bot' }],
      }),
    );

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'feishu:ou_user1',
          groupId: 'feishu:group:oc_grp1',
          text: '请帮我查一下',
        }),
      );
    });
  });

  it('should filter users not in allowedUsers', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new FeishuChannel(makeConfig({ allowedUsers: ['ou_allowed'] }));
    ch.onMessage(handler);
    await ch.start();

    const onReceive = getEventHandler();
    onReceive(makeEvent({ messageId: 'msg_blocked', openId: 'ou_other' }));

    // 等待一会确保没有被调用
    await new Promise((r) => setTimeout(r, 50));
    expect(handler).not.toHaveBeenCalled();
  });

  it('should allow user in allowedUsers', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new FeishuChannel(makeConfig({ allowedUsers: ['ou_allowed'] }));
    ch.onMessage(handler);
    await ch.start();

    const onReceive = getEventHandler();
    onReceive(makeEvent({ messageId: 'msg_allowed', openId: 'ou_allowed' }));

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'feishu:ou_allowed' }),
      );
    });
  });

  it('should allow group in allowedGroups', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new FeishuChannel(makeConfig({ allowedGroups: ['oc_grp_ok'] }));
    ch.onMessage(handler);
    await ch.start();

    const onReceive = getEventHandler();
    onReceive(
      makeEvent({
        messageId: 'msg_grp_ok',
        chatType: 'group',
        chatId: 'oc_grp_ok',
      }),
    );

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalled();
    });
  });
});

// ── markdownToPost ──

describe('markdownToPost', () => {
  it('should convert plain text', () => {
    const result = markdownToPost('Hello world');
    expect(result).toEqual([[{ tag: 'text', text: 'Hello world' }]]);
  });

  it('should convert bold text', () => {
    const result = markdownToPost('**bold**');
    expect(result).toEqual([[{ tag: 'text', text: 'bold', style: ['bold'] }]]);
  });

  it('should convert links', () => {
    const result = markdownToPost('[link](https://example.com)');
    expect(result).toEqual([[{ tag: 'a', text: 'link', href: 'https://example.com' }]]);
  });

  it('should convert inline code', () => {
    const result = markdownToPost('`code`');
    expect(result).toEqual([[{ tag: 'text', text: 'code', style: ['italic'] }]]);
  });

  it('should handle multiline', () => {
    const result = markdownToPost('line1\nline2');
    expect(result.length).toBe(2);
  });
});
