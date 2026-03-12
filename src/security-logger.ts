import pino from 'pino';
import type { VigilClawDB } from './db.js';
import type { SecurityEventType, Severity } from './types.js';

const logger = pino({ name: 'security' });

export class SecurityLogger {
  constructor(private db: VigilClawDB) {}

  log(event: {
    eventType: SecurityEventType;
    userId?: string;
    details: Record<string, unknown>;
    severity: Severity;
  }): void {
    this.db.insertSecurityEvent({
      eventType: event.eventType,
      userId: event.userId,
      severity: event.severity,
      details: event.details,
    });

    const logFn =
      event.severity === 'critical' || event.severity === 'high' ? logger.error : logger.warn;

    logFn.call(
      logger,
      {
        event: event.eventType,
        severity: event.severity,
        userId: event.userId,
        ...event.details,
      },
      `Security event: ${event.eventType}`,
    );
  }
}
