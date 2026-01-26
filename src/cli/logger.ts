/**
 * Structured logger for TrafficControl CLI
 * Supports multiple log levels, JSON output, and history tracking
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: Date;
  level: string;
  message: string;
  meta?: Record<string, unknown>;
  error?: Error;
}

interface LoggerState {
  level: LogLevel;
  jsonMode: boolean;
  historyEnabled: boolean;
  maxHistorySize: number;
  history: LogEntry[];
}

const state: LoggerState = {
  level: LogLevel.INFO,
  jsonMode: false,
  historyEnabled: false,
  maxHistorySize: 100,
  history: [],
};

function levelToString(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG:
      return 'DEBUG';
    case LogLevel.INFO:
      return 'INFO';
    case LogLevel.WARN:
      return 'WARN';
    case LogLevel.ERROR:
      return 'ERROR';
  }
}

function stringToLevel(levelStr: string): LogLevel {
  switch (levelStr.toLowerCase()) {
    case 'debug':
      return LogLevel.DEBUG;
    case 'info':
      return LogLevel.INFO;
    case 'warn':
    case 'warning':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

function formatMessage(
  level: LogLevel,
  message: string,
  error?: Error,
  meta?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();
  const levelStr = levelToString(level);

  if (state.jsonMode) {
    const output: Record<string, unknown> = {
      timestamp,
      level: levelStr,
      message,
    };

    if (error) {
      output.error = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    }

    if (meta && Object.keys(meta).length > 0) {
      output.meta = meta;
    }

    return JSON.stringify(output);
  }

  // Plain text format
  let output = `[${timestamp}] [${levelStr}] ${message}`;

  if (error) {
    output += ` | Error: ${error.message}`;
    if (error.stack) {
      output += `\n${error.stack}`;
    }
  }

  if (meta && Object.keys(meta).length > 0) {
    output += ` | ${JSON.stringify(meta)}`;
  }

  return output;
}

function addToHistory(entry: LogEntry): void {
  if (!state.historyEnabled) return;

  state.history.push(entry);

  // Trim history if it exceeds max size
  while (state.history.length > state.maxHistorySize) {
    state.history.shift();
  }
}

function log(
  level: LogLevel,
  message: string,
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

  const formattedMessage = formatMessage(level, message, error, metadata);
  const entry: LogEntry = {
    timestamp: new Date(),
    level: levelToString(level),
    message,
    meta: metadata,
    error,
  };

  addToHistory(entry);

  switch (level) {
    case LogLevel.DEBUG:
    case LogLevel.INFO:
      console.log(formattedMessage);
      break;
    case LogLevel.WARN:
      console.warn(formattedMessage);
      break;
    case LogLevel.ERROR:
      console.error(formattedMessage);
      break;
  }
}

/**
 * Child logger that maintains context across log calls
 */
class ChildLogger {
  private context: Record<string, unknown>;

  constructor(context: Record<string, unknown>) {
    this.context = context;
  }

  info(message: string, meta?: Record<string, unknown>): void {
    Logger.info(message, { ...this.context, ...meta });
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    Logger.warn(message, { ...this.context, ...meta });
  }

  error(message: string, errorOrMeta?: Error | Record<string, unknown>, meta?: Record<string, unknown>): void {
    if (errorOrMeta instanceof Error) {
      Logger.error(message, errorOrMeta, { ...this.context, ...meta });
    } else {
      Logger.error(message, { ...this.context, ...errorOrMeta });
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    Logger.debug(message, { ...this.context, ...meta });
  }
}

/**
 * Main Logger class with static methods
 */
export const Logger = {
  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    state.level = level;
  },

  /**
   * Set log level from string (case-insensitive)
   */
  setLevelFromString(levelStr: string): void {
    state.level = stringToLevel(levelStr);
  },

  /**
   * Enable/disable JSON output mode
   */
  setJsonMode(enabled: boolean): void {
    state.jsonMode = enabled;
  },

  /**
   * Enable/disable history tracking
   */
  enableHistory(enabled: boolean, maxSize?: number): void {
    state.historyEnabled = enabled;
    if (maxSize !== undefined) {
      state.maxHistorySize = maxSize;
    }
  },

  /**
   * Get stored log history
   */
  getHistory(): LogEntry[] {
    return [...state.history];
  },

  /**
   * Clear log history
   */
  clearHistory(): void {
    state.history = [];
  },

  /**
   * Initialize logger from environment variables
   */
  initFromEnv(): void {
    const level = process.env.TC_LOG_LEVEL;
    if (level) {
      state.level = stringToLevel(level);
    }
  },

  /**
   * Reset logger to default state (for testing)
   */
  reset(): void {
    state.level = LogLevel.INFO;
    state.jsonMode = false;
    state.historyEnabled = false;
    state.maxHistorySize = 100;
    state.history = [];
  },

  /**
   * Create a child logger with persistent context
   */
  child(context: Record<string, unknown>): ChildLogger {
    return new ChildLogger(context);
  },

  /**
   * Log info level message
   */
  info(message: string, meta?: Record<string, unknown>): void {
    log(LogLevel.INFO, message, meta);
  },

  /**
   * Log warning level message
   */
  warn(message: string, meta?: Record<string, unknown>): void {
    log(LogLevel.WARN, message, meta);
  },

  /**
   * Log error level message
   */
  error(message: string, errorOrMeta?: Error | Record<string, unknown>, meta?: Record<string, unknown>): void {
    log(LogLevel.ERROR, message, errorOrMeta, meta);
  },

  /**
   * Log debug level message
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    log(LogLevel.DEBUG, message, meta);
  },

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return state.level;
  },
};
