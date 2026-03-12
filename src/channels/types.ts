/**
 * IChannel — 渠道抽象接口
 * 所有消息渠道（Telegram, WhatsApp, Web）必须实现此接口。
 */
export interface IChannel {
  readonly name: string;

  /** 启动渠道（开始接收消息） */
  start(): Promise<void>;

  /** 停止渠道（优雅关闭） */
  stop(): Promise<void>;

  /** 发送文本消息 */
  sendMessage(userId: string, groupId: string | undefined, text: string): Promise<void>;

  /** 发送图片 */
  sendImage(
    userId: string,
    groupId: string | undefined,
    image: Buffer,
    caption?: string,
  ): Promise<void>;
}
