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
        'ANTHROPIC_API_KEY',
        'VIGILCLAW_MASTER_KEY',
        'VIGILCLAW_TELEGRAM_BOT_TOKEN',
      ],
      censor: '***REDACTED***',
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
  });
}

export const logger = createLogger(process.env.VIGILCLAW_LOG_LEVEL);
