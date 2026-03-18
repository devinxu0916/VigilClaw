import pino from 'pino';

export function createLogger(level: string = 'info'): pino.Logger {
  return pino({
    level,
    redact: {
      paths: [
        'apiKey',
        'key',
        'token',
        'authorization',
        'appSecret',
        'encryptKey',
        'verificationToken',
        'ANTHROPIC_API_KEY',
        'VIGILCLAW_MASTER_KEY',
        'VIGILCLAW_TELEGRAM_BOT_TOKEN',
        'VIGILCLAW_FEISHU_APP_SECRET',
        'VIGILCLAW_DINGTALK_APP_SECRET',
      ],
      censor: '***REDACTED***',
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
  });
}

export const logger = createLogger(process.env.VIGILCLAW_LOG_LEVEL);
