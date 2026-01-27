/**
 * TrafficControl Logging Module
 *
 * Provides structured logging with:
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - JSON and pretty-print output formats
 * - Component-scoped child loggers
 * - Correlation IDs for request tracing
 * - Performance timing utilities
 * - Automatic sensitive data redaction
 *
 * Usage:
 * ```typescript
 * import { logger } from '../logging';
 *
 * // Initialize from environment
 * logger.init();
 *
 * // Create component logger
 * const log = logger.child('MyComponent');
 *
 * // Log messages
 * log.info('Operation started', { userId: '123' });
 * log.debug('Processing item', { itemId: 456 });
 * log.warn('Rate limit approaching', { current: 90, limit: 100 });
 * log.error('Operation failed', error, { context: 'retry' });
 *
 * // Performance timing
 * log.time('db-query');
 * await database.query(...);
 * log.timeEnd('db-query');
 *
 * // Correlation IDs
 * const correlatedLog = log.withCorrelationId('req-123');
 * correlatedLog.info('Request received');
 * ```
 *
 * Environment Variables:
 * - TC_LOG_LEVEL: DEBUG, INFO, WARN, ERROR (default: INFO)
 * - TC_LOG_FORMAT: json, pretty (default: pretty)
 * - TC_LOG_REDACT: Comma-separated fields to redact
 */

export { logger, LogLevel } from './logger.js';
export type { Logger, LogEntry, LoggerConfig } from './types.js';

export {
  generateCorrelationId,
  getCorrelationId,
  setCorrelationId,
  clearCorrelationId,
  withCorrelation,
  withCorrelationAsync,
  ensureCorrelationId,
} from './correlation.js';

export {
  redact,
  redactValue,
  getDefaultRedactFields,
} from './redaction.js';
