/**
 * Type definitions for the TrafficControl logging system
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  correlationId?: string;
  meta?: Record<string, unknown>;
  error?: {
    message: string;
    name: string;
    stack?: string;
  };
  duration?: number;
}

export interface LoggerConfig {
  level: LogLevel;
  format: 'json' | 'pretty';
  redactFields: string[];
  component?: string;
  correlationId?: string;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, errorOrMeta?: Error | Record<string, unknown>, meta?: Record<string, unknown>): void;

  /** Create a child logger with component context */
  child(component: string): Logger;

  /** Create a logger with correlation ID for request tracing */
  withCorrelationId(id: string): Logger;

  /** Start a timer for performance measurement */
  time(label: string): void;

  /** End a timer and log the duration */
  timeEnd(label: string, meta?: Record<string, unknown>): number | undefined;
}

export interface LoggerState {
  level: LogLevel;
  format: 'json' | 'pretty';
  redactFields: string[];
  timers: Map<string, number>;
}
