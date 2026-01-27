/**
 * Core structured logger for TrafficControl
 *
 * Features:
 * - Multiple log levels (DEBUG, INFO, WARN, ERROR)
 * - JSON and pretty-print output formats
 * - Component-scoped child loggers
 * - Correlation ID support for request tracing
 * - Performance timing utilities
 * - Automatic sensitive data redaction
 */

import { LogLevel, LogEntry, Logger, LoggerState } from './types.js';
import { redact } from './redaction.js';
import { getCorrelationId } from './correlation.js';

// Global logger state
const state: LoggerState = {
  level: LogLevel.INFO,
  format: 'pretty',
  redactFields: [],
  timers: new Map(),
};

/**
 * Convert LogLevel enum to string
 */
function levelToString(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG: return 'DEBUG';
    case LogLevel.INFO: return 'INFO';
    case LogLevel.WARN: return 'WARN';
    case LogLevel.ERROR: return 'ERROR';
    default: return 'INFO';
  }
}

/**
 * Parse log level from string
 */
function stringToLevel(levelStr: string): LogLevel {
  switch (levelStr.toUpperCase()) {
    case 'DEBUG': return LogLevel.DEBUG;
    case 'INFO': return LogLevel.INFO;
    case 'WARN':
    case 'WARNING': return LogLevel.WARN;
    case 'ERROR': return LogLevel.ERROR;
    default: return LogLevel.INFO;
  }
}

/**
 * Get ANSI color code for log level (for pretty output)
 */
function getLevelColor(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG: return '\x1b[36m'; // Cyan
    case LogLevel.INFO: return '\x1b[32m';  // Green
    case LogLevel.WARN: return '\x1b[33m';  // Yellow
    case LogLevel.ERROR: return '\x1b[31m'; // Red
    default: return '\x1b[0m'; // Reset/default
  }
}

const RESET_COLOR = '\x1b[0m';
const DIM_COLOR = '\x1b[2m';

/**
 * Format a log entry for output
 */
function formatEntry(entry: LogEntry): string {
  if (state.format === 'json') {
    return JSON.stringify(entry);
  }

  // Pretty format
  const levelColor = getLevelColor(stringToLevel(entry.level) as LogLevel);
  const levelPadded = entry.level.padEnd(5);

  let output = `${DIM_COLOR}${entry.timestamp}${RESET_COLOR} ${levelColor}${levelPadded}${RESET_COLOR}`;

  if (entry.component) {
    output += ` ${DIM_COLOR}[${entry.component}]${RESET_COLOR}`;
  }

  if (entry.correlationId) {
    output += ` ${DIM_COLOR}(${entry.correlationId})${RESET_COLOR}`;
  }

  output += ` ${entry.message}`;

  if (entry.duration !== undefined) {
    output += ` ${DIM_COLOR}(${entry.duration}ms)${RESET_COLOR}`;
  }

  if (entry.meta && Object.keys(entry.meta).length > 0) {
    output += ` ${DIM_COLOR}${JSON.stringify(entry.meta)}${RESET_COLOR}`;
  }

  if (entry.error) {
    output += `\n  ${levelColor}Error: ${entry.error.message}${RESET_COLOR}`;
    if (entry.error.stack) {
      output += `\n${DIM_COLOR}${entry.error.stack}${RESET_COLOR}`;
    }
  }

  return output;
}

/**
 * Write a log entry to the console
 */
function writeLog(level: LogLevel, entry: LogEntry): void {
  const formatted = formatEntry(entry);

  switch (level) {
    case LogLevel.DEBUG:
    case LogLevel.INFO:
      console.log(formatted);
      break;
    case LogLevel.WARN:
      console.warn(formatted);
      break;
    case LogLevel.ERROR:
      console.error(formatted);
      break;
  }
}

/**
 * Create a log entry
 */
function createEntry(
  level: LogLevel,
  message: string,
  component?: string,
  correlationId?: string,
  error?: Error,
  meta?: Record<string, unknown>,
  duration?: number
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: levelToString(level),
    component: component || 'app',
    message,
  };

  // Use provided correlation ID, or get from context, or omit
  const corrId = correlationId || getCorrelationId();
  if (corrId) {
    entry.correlationId = corrId;
  }

  if (error) {
    entry.error = {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (meta && Object.keys(meta).length > 0) {
    entry.meta = redact(meta, state.redactFields);
  }

  if (duration !== undefined) {
    entry.duration = duration;
  }

  return entry;
}

/**
 * Core log function
 */
function log(
  level: LogLevel,
  message: string,
  component?: string,
  correlationId?: string,
  errorOrMeta?: Error | Record<string, unknown>,
  meta?: Record<string, unknown>
): void {
  if (level < state.level) return;

  let error: Error | undefined;
  let metadata: Record<string, unknown> | undefined;

  if (errorOrMeta instanceof Error) {
    error = errorOrMeta;
    metadata = meta;
  } else {
    metadata = errorOrMeta;
  }

  const entry = createEntry(level, message, component, correlationId, error, metadata);
  writeLog(level, entry);
}

/**
 * Create a child logger with component context
 */
class ComponentLogger implements Logger {
  private component: string;
  private correlationId?: string;
  private timerPrefix: string;

  constructor(component: string, correlationId?: string) {
    this.component = component;
    this.correlationId = correlationId;
    this.timerPrefix = `${component}:`;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    log(LogLevel.DEBUG, message, this.component, this.correlationId, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    log(LogLevel.INFO, message, this.component, this.correlationId, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    log(LogLevel.WARN, message, this.component, this.correlationId, meta);
  }

  error(message: string, errorOrMeta?: Error | Record<string, unknown>, meta?: Record<string, unknown>): void {
    log(LogLevel.ERROR, message, this.component, this.correlationId, errorOrMeta, meta);
  }

  child(component: string): Logger {
    const childComponent = `${this.component}.${component}`;
    return new ComponentLogger(childComponent, this.correlationId);
  }

  withCorrelationId(id: string): Logger {
    return new ComponentLogger(this.component, id);
  }

  time(label: string): void {
    const key = `${this.timerPrefix}${label}`;
    state.timers.set(key, Date.now());
  }

  timeEnd(label: string, meta?: Record<string, unknown>): number | undefined {
    const key = `${this.timerPrefix}${label}`;
    const start = state.timers.get(key);

    if (start === undefined) {
      this.warn(`Timer "${label}" does not exist`);
      return undefined;
    }

    state.timers.delete(key);
    const duration = Date.now() - start;

    const entry = createEntry(
      LogLevel.DEBUG,
      `${label} completed`,
      this.component,
      this.correlationId,
      undefined,
      meta,
      duration
    );

    if (LogLevel.DEBUG >= state.level) {
      writeLog(LogLevel.DEBUG, entry);
    }

    return duration;
  }
}

/**
 * Root logger singleton
 */
const rootLogger = new ComponentLogger('app');

/**
 * Logger configuration and management
 */
export const logger = {
  /**
   * Initialize logger from environment variables
   * TC_LOG_LEVEL: DEBUG, INFO, WARN, ERROR
   * TC_LOG_FORMAT: json, pretty
   * TC_LOG_REDACT: comma-separated field names
   */
  init(): void {
    const level = process.env.TC_LOG_LEVEL;
    if (level) {
      state.level = stringToLevel(level);
    }

    const format = process.env.TC_LOG_FORMAT;
    if (format === 'json' || format === 'pretty') {
      state.format = format;
    }

    const redactFields = process.env.TC_LOG_REDACT;
    if (redactFields) {
      state.redactFields = redactFields.split(',').map(f => f.trim());
    }
  },

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    state.level = level;
  },

  /**
   * Set log level from string
   */
  setLevelFromString(levelStr: string): void {
    state.level = stringToLevel(levelStr);
  },

  /**
   * Set output format
   */
  setFormat(format: 'json' | 'pretty'): void {
    state.format = format;
  },

  /**
   * Add fields to redact
   */
  addRedactFields(fields: string[]): void {
    state.redactFields.push(...fields);
  },

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return state.level;
  },

  /**
   * Get current format
   */
  getFormat(): 'json' | 'pretty' {
    return state.format;
  },

  /**
   * Reset logger state (for testing)
   */
  reset(): void {
    state.level = LogLevel.INFO;
    state.format = 'pretty';
    state.redactFields = [];
    state.timers.clear();
  },

  // Root logger methods (delegate to rootLogger)
  debug: rootLogger.debug.bind(rootLogger),
  info: rootLogger.info.bind(rootLogger),
  warn: rootLogger.warn.bind(rootLogger),
  error: rootLogger.error.bind(rootLogger),
  time: rootLogger.time.bind(rootLogger),
  timeEnd: rootLogger.timeEnd.bind(rootLogger),

  /**
   * Create a component-scoped logger
   */
  child(component: string): Logger {
    return new ComponentLogger(component);
  },

  /**
   * Create a logger with correlation ID
   */
  withCorrelationId(id: string): Logger {
    return new ComponentLogger('app', id);
  },
};

// Export types for convenience
export { LogLevel } from './types.js';
export type { Logger, LogEntry } from './types.js';
