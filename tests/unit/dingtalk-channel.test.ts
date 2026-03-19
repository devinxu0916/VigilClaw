import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { DingTalkChannel } from '../../src/channels/dingtalk.js';
import type { DingTalkConfig } from '../../src/config.js';

function makeConfig(overrides: Partial<DingTalkConfig> = {}): DingTalkConfig {
  return {
    enabled: true,
    appKey: 'test-app-key',
    appSecret: 'test-app-secret',
    robotCode: 'test-robot-code',
    allowedUsers: [],
    allowedGroups: [],
    cooldownMs: 0, // 测试中不节流
    ...overrides,
  };
}

// ── Mock WebSocket ──
class MockWebSocket {
  static readonly OPEN = 1;
  readyState = 1;
  sentMessages: string[] = [];
  private eventHandlers: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(_url: string) { // eslint-disable-line @typescript-eslint/no-unused-vars
    // 模拟连接成功
    setTimeout(() => {
      this.trigger('open', {});
    }, 0);
  }

  addEventListener(event: string, handler: (ev: unknown) => void): void {
    if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
    this.eventHandlers[event]?.push(handler);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  trigger(event: string, data: unknown): void {
    for (const h of this.eventHandlers[event] ?? []) {
      h(data);
    }
  }
}

// ── fetch mock ──
let fetchMock: ReturnType<typeof vi.fn>;

describe('DingTalkChannel', () => {
  let wsInstances: MockWebSocket[];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wsInstances = [];

    // Mock WebSocket constructor
    const MockWSConstructor = vi.fn().mockImplementation((_url: string) => {
      const ws = new MockWebSocket(_url);
      wsInstances.push(ws);
      return ws;
    }) as unknown as typeof WebSocket;
    // 挂载 OPEN 常量
    Object.defineProperty(MockWSConstructor, 'OPEN', { value: 1, writable: false });
    vi.stubGlobal('WebSocket', MockWSConstructor);

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── 辅助：模拟 Token 和 Stream 注册 ──
  function setupTokenAndStream(): void {
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

      if (urlStr.includes('oauth2/accessToken')) {
        return new Response(
          JSON.stringify({ accessToken: 'test-token-123', expireIn: 7200 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('gateway/connections/open')) {
        return new Response(
          JSON.stringify({ endpoint: 'wss://fake.dingtalk.com/stream', ticket: 'ticket_abc' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // 其他（发消息等）默认成功
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  }

  // ── 基本构造 ──

  it('should have name "dingtalk"', () => {
    const ch = new DingTalkChannel(makeConfig());
    expect(ch.name).toBe('dingtalk');
  });

  // ── Access Token ──

  it('should fetch and cache access token', async () => {
    setupTokenAndStream();
    const ch = new DingTalkChannel(makeConfig());
    const token = await ch.getAccessToken();
    expect(token).toBe('test-token-123');

    // 第二次应该命中缓存
    const token2 = await ch.getAccessToken();
    expect(token2).toBe('test-token-123');

    // fetch 只被调用一次（token 请求）
    const tokenCalls = (fetchMock.mock.calls as Array<[string, ...unknown[]]>).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('accessToken'),
    );
    expect(tokenCalls.length).toBe(1);
  });

  it('should throw on token fetch failure', async () => {
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    const ch = new DingTalkChannel(makeConfig());
    await expect(ch.getAccessToken()).rejects.toThrow('DingTalk getAccessToken failed');
  });

  // ── sendMessage ──

  it('should send private message via oToMessages/batchSend', async () => {
    setupTokenAndStream();
    const ch = new DingTalkChannel(makeConfig());
    await ch.sendMessage('dingtalk:staff_001', undefined, 'Hello DM');

    const sendCalls = (fetchMock.mock.calls as Array<[string, { body: string }]>).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('oToMessages'),
    );
    expect(sendCalls.length).toBe(1);

    const body = JSON.parse(sendCalls[0]![1].body) as {
      robotCode: string;
      userIds: string[];
      msgKey: string;
    };
    expect(body.robotCode).toBe('test-robot-code');
    expect(body.userIds).toEqual(['staff_001']);
    expect(body.msgKey).toBe('sampleMarkdown');
  });

  it('should send group message via groupMessages/send', async () => {
    setupTokenAndStream();
    const ch = new DingTalkChannel(makeConfig());
    await ch.sendMessage('dingtalk:staff_001', 'dingtalk:group:conv_123', 'Hello Group');

    const sendCalls = (fetchMock.mock.calls as Array<[string, { body: string }]>).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('groupMessages'),
    );
    expect(sendCalls.length).toBe(1);

    const body = JSON.parse(sendCalls[0]![1].body) as {
      openConversationId: string;
    };
    expect(body.openConversationId).toBe('conv_123');
  });

  it('should split long messages', async () => {
    setupTokenAndStream();
    const ch = new DingTalkChannel(makeConfig());
    const longText = 'B'.repeat(3000);
    await ch.sendMessage('dingtalk:staff_001', undefined, longText);

    const sendCalls = (fetchMock.mock.calls as Array<[string, ...unknown[]]>).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('oToMessages'),
    );
    expect(sendCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('should fallback to plain text on markdown failure', async () => {
    let callCount = 0;
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

      if (urlStr.includes('oauth2/accessToken')) {
        return new Response(
          JSON.stringify({ accessToken: 'tok', expireIn: 7200 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('oToMessages')) {
        callCount++;
        if (callCount === 1) {
          return new Response('fail', { status: 500 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const ch = new DingTalkChannel(makeConfig());
    await ch.sendMessage('dingtalk:staff_001', undefined, 'test fallback');

    const sendCalls = (fetchMock.mock.calls as Array<[string, { body: string }]>).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('oToMessages'),
    );
    expect(sendCalls.length).toBe(2);

    const body = JSON.parse(sendCalls[1]![1].body) as { msgKey: string };
    expect(body.msgKey).toBe('sampleText');
  });

  // ── sendImage ──

  it('should fallback to text when sending image', async () => {
    setupTokenAndStream();
    const ch = new DingTalkChannel(makeConfig());
    await ch.sendImage('dingtalk:staff_001', undefined, Buffer.from('img'), 'caption');

    const sendCalls = (fetchMock.mock.calls as Array<[string, ...unknown[]]>).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('oToMessages'),
    );
    expect(sendCalls.length).toBe(1);
  });

  // ── 白名单 ──

  it('should allow all when allowedUsers and allowedGroups are empty', async () => {
    setupTokenAndStream();
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new DingTalkChannel(makeConfig());
    ch.onMessage(handler);
    await ch.start();
    await vi.advanceTimersByTimeAsync(10);

    const ws = wsInstances[0];
    expect(ws).toBeDefined();
    ws!.trigger('message', {
      data: JSON.stringify({
        type: 'CALLBACK',
        headers: { type: 'CALLBACK', messageId: 'ws_msg_1' },
        data: JSON.stringify({
          msgtype: 'text',
          text: { content: 'hello' },
          senderStaffId: 'anyone',
          conversationType: '1',
          conversationId: '',
          msgId: 'dm_1',
        }),
      }),
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(handler).toHaveBeenCalled();
  });

  it('should block user not in allowedUsers', async () => {
    setupTokenAndStream();
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new DingTalkChannel(makeConfig({ allowedUsers: ['staff_ok'] }));
    ch.onMessage(handler);
    await ch.start();
    await vi.advanceTimersByTimeAsync(10);

    const ws = wsInstances[0];
    expect(ws).toBeDefined();
    ws!.trigger('message', {
      data: JSON.stringify({
        type: 'CALLBACK',
        headers: { type: 'CALLBACK', messageId: 'ws_msg_2' },
        data: JSON.stringify({
          msgtype: 'text',
          text: { content: 'blocked' },
          senderStaffId: 'staff_bad',
          conversationType: '1',
          conversationId: '',
          msgId: 'dm_2',
        }),
      }),
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(handler).not.toHaveBeenCalled();
  });

  // ── 消息去重 ──

  it('should deduplicate messages by msgId', async () => {
    setupTokenAndStream();
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new DingTalkChannel(makeConfig());
    ch.onMessage(handler);
    await ch.start();
    await vi.advanceTimersByTimeAsync(10);

    const ws = wsInstances[0];
    expect(ws).toBeDefined();
    const msgPayload = JSON.stringify({
      type: 'CALLBACK',
      headers: { type: 'CALLBACK', messageId: 'ws_dup' },
      data: JSON.stringify({
        msgtype: 'text',
        text: { content: 'dup msg' },
        senderStaffId: 'staff_1',
        conversationType: '1',
        conversationId: '',
        msgId: 'dup_id',
      }),
    });

    ws!.trigger('message', { data: msgPayload });
    ws!.trigger('message', { data: msgPayload });

    await vi.advanceTimersByTimeAsync(50);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ── 心跳处理 ──

  it('should respond to SYSTEM heartbeat with ACK', async () => {
    setupTokenAndStream();
    const ch = new DingTalkChannel(makeConfig());
    await ch.start();
    await vi.advanceTimersByTimeAsync(10);

    const ws = wsInstances[0];
    expect(ws).toBeDefined();
    ws!.trigger('message', {
      data: JSON.stringify({
        type: 'SYSTEM',
        headers: { type: 'SYSTEM', messageId: 'hb_1' },
        data: '',
      }),
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(ws!.sentMessages.length).toBeGreaterThanOrEqual(1);
    const ack = JSON.parse(ws!.sentMessages[0]!) as { code: number };
    expect(ack.code).toBe(200);
  });

  // ── userId / groupId 格式 ──

  it('should format userId as dingtalk:{staffId}', async () => {
    setupTokenAndStream();
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new DingTalkChannel(makeConfig());
    ch.onMessage(handler);
    await ch.start();
    await vi.advanceTimersByTimeAsync(10);

    const ws = wsInstances[0];
    expect(ws).toBeDefined();
    ws!.trigger('message', {
      data: JSON.stringify({
        type: 'CALLBACK',
        headers: { type: 'CALLBACK', messageId: 'ws_uid' },
        data: JSON.stringify({
          msgtype: 'text',
          text: { content: 'test' },
          senderStaffId: 'staff_abc',
          conversationType: '1',
          conversationId: '',
          msgId: 'uid_test',
        }),
      }),
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'dingtalk:staff_abc', groupId: undefined }),
    );
  });

  it('should format groupId as dingtalk:group:{conversationId}', async () => {
    setupTokenAndStream();
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch = new DingTalkChannel(makeConfig());
    ch.onMessage(handler);
    await ch.start();
    await vi.advanceTimersByTimeAsync(10);

    const ws = wsInstances[0];
    expect(ws).toBeDefined();
    ws!.trigger('message', {
      data: JSON.stringify({
        type: 'CALLBACK',
        headers: { type: 'CALLBACK', messageId: 'ws_gid' },
        data: JSON.stringify({
          msgtype: 'text',
          text: { content: 'group test' },
          senderStaffId: 'staff_x',
          conversationType: '2',
          conversationId: 'conv_xyz',
          msgId: 'gid_test',
        }),
      }),
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'dingtalk:group:conv_xyz' }),
    );
  });

  // ── cooldownMs 节流 ──

  it('should respect cooldownMs between sends', async () => {
    vi.useRealTimers(); // 需要真实计时器来测量延迟
    setupTokenAndStream();
    const ch = new DingTalkChannel(makeConfig({ cooldownMs: 50 }));

    const start = Date.now();
    await ch.sendMessage('dingtalk:staff_1', undefined, 'msg1');
    await ch.sendMessage('dingtalk:staff_1', undefined, 'msg2');
    const elapsed = Date.now() - start;

    // 第二次发送应至少延迟 cooldownMs
    expect(elapsed).toBeGreaterThanOrEqual(40); // 允许 10ms 误差
  });
});
