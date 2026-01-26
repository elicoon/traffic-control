import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel, LogEntry } from './logger.js';

describe('Logger', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };
  let originalEnv: string | undefined;

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
    originalEnv = process.env.TC_LOG_LEVEL;
    Logger.reset();
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
    if (originalEnv !== undefined) {
      process.env.TC_LOG_LEVEL = originalEnv;
    } else {
      delete process.env.TC_LOG_LEVEL;
    }
  });

  describe('log levels', () => {
    it('should have correct log level ordering', () => {
      expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
      expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
      expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
    });
  });

  describe('setLevel', () => {
    it('should change the minimum log level', () => {
      Logger.setLevel(LogLevel.ERROR);

      Logger.info('This should not be logged');
      Logger.warn('This should not be logged');
      Logger.error('This should be logged');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });

    it('should allow all levels when set to DEBUG', () => {
      Logger.setLevel(LogLevel.DEBUG);

      Logger.debug('debug message');
      Logger.info('info message');
      Logger.warn('warn message');
      Logger.error('error message');

      expect(consoleSpy.log).toHaveBeenCalledTimes(2); // debug and info
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('setLevelFromString', () => {
    it('should set level from string "debug"', () => {
      Logger.setLevelFromString('debug');
      Logger.debug('test');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should set level from string "info"', () => {
      Logger.setLevelFromString('info');
      Logger.debug('test');
      Logger.info('test');
      expect(consoleSpy.log).toHaveBeenCalledTimes(1); // only info, not debug
    });

    it('should set level from string "warn"', () => {
      Logger.setLevelFromString('warn');
      Logger.info('test');
      Logger.warn('test');
      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    });

    it('should set level from string "error"', () => {
      Logger.setLevelFromString('error');
      Logger.warn('test');
      Logger.error('test');
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });

    it('should handle uppercase level strings', () => {
      Logger.setLevelFromString('DEBUG');
      Logger.debug('test');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should default to INFO for unknown level strings', () => {
      Logger.setLevelFromString('unknown');
      Logger.debug('test');
      Logger.info('test');
      expect(consoleSpy.log).toHaveBeenCalledTimes(1); // only info
    });
  });

  describe('info', () => {
    it('should log info messages to console.log', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.info('Test message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const logArg = consoleSpy.log.mock.calls[0][0];
      expect(logArg).toContain('INFO');
      expect(logArg).toContain('Test message');
    });

    it('should include metadata in the log output', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.info('Test message', { userId: 123, action: 'test' });

      const logArg = consoleSpy.log.mock.calls[0][0];
      expect(logArg).toContain('userId');
      expect(logArg).toContain('123');
    });

    it('should not log when level is higher than INFO', () => {
      Logger.setLevel(LogLevel.WARN);
      Logger.info('Test message');

      expect(consoleSpy.log).not.toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('should log warn messages to console.warn', () => {
      Logger.warn('Warning message');

      expect(consoleSpy.warn).toHaveBeenCalled();
      const logArg = consoleSpy.warn.mock.calls[0][0];
      expect(logArg).toContain('WARN');
      expect(logArg).toContain('Warning message');
    });

    it('should include metadata', () => {
      Logger.warn('Warning', { code: 'W001' });

      const logArg = consoleSpy.warn.mock.calls[0][0];
      expect(logArg).toContain('code');
      expect(logArg).toContain('W001');
    });
  });

  describe('error', () => {
    it('should log error messages to console.error', () => {
      Logger.error('Error message');

      expect(consoleSpy.error).toHaveBeenCalled();
      const logArg = consoleSpy.error.mock.calls[0][0];
      expect(logArg).toContain('ERROR');
      expect(logArg).toContain('Error message');
    });

    it('should include error stack when Error object provided', () => {
      const testError = new Error('Test error');
      Logger.error('Something went wrong', testError);

      const logArg = consoleSpy.error.mock.calls[0][0];
      expect(logArg).toContain('Test error');
    });

    it('should include both error and metadata', () => {
      const testError = new Error('Test error');
      Logger.error('Something went wrong', testError, { requestId: 'req-123' });

      const logArg = consoleSpy.error.mock.calls[0][0];
      expect(logArg).toContain('requestId');
      expect(logArg).toContain('req-123');
    });
  });

  describe('debug', () => {
    it('should log debug messages when level is DEBUG', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.debug('Debug message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const logArg = consoleSpy.log.mock.calls[0][0];
      expect(logArg).toContain('DEBUG');
      expect(logArg).toContain('Debug message');
    });

    it('should not log debug messages when level is INFO or higher', () => {
      Logger.setLevel(LogLevel.INFO);
      Logger.debug('Debug message');

      expect(consoleSpy.log).not.toHaveBeenCalled();
    });
  });

  describe('log output format', () => {
    it('should include timestamp in ISO format', () => {
      Logger.info('Test');

      const logArg = consoleSpy.log.mock.calls[0][0];
      // Check for ISO timestamp pattern
      expect(logArg).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should format as structured JSON when JSON mode is enabled', () => {
      Logger.setJsonMode(true);
      Logger.info('Test message', { key: 'value' });

      const logArg = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(logArg);
      expect(parsed.level).toBe('INFO');
      expect(parsed.message).toBe('Test message');
      expect(parsed.meta.key).toBe('value');
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('getHistory', () => {
    it('should store log entries in history', () => {
      Logger.setLevel(LogLevel.DEBUG);
      Logger.enableHistory(true);

      Logger.info('First message');
      Logger.warn('Second message');

      const history = Logger.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].message).toBe('First message');
      expect(history[1].message).toBe('Second message');
    });

    it('should limit history size', () => {
      Logger.enableHistory(true, 3);
      Logger.setLevel(LogLevel.DEBUG);

      Logger.info('Message 1');
      Logger.info('Message 2');
      Logger.info('Message 3');
      Logger.info('Message 4');

      const history = Logger.getHistory();
      expect(history.length).toBe(3);
      expect(history[0].message).toBe('Message 2');
      expect(history[2].message).toBe('Message 4');
    });

    it('should clear history', () => {
      Logger.enableHistory(true);
      Logger.info('Test');
      expect(Logger.getHistory().length).toBe(1);

      Logger.clearHistory();
      expect(Logger.getHistory().length).toBe(0);
    });
  });

  describe('environment variable', () => {
    it('should read TC_LOG_LEVEL from environment', () => {
      process.env.TC_LOG_LEVEL = 'debug';
      Logger.initFromEnv();

      Logger.debug('test');
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('child logger', () => {
    it('should create child logger with context', () => {
      const child = Logger.child({ component: 'scheduler' });
      child.info('Test message');

      const logArg = consoleSpy.log.mock.calls[0][0];
      expect(logArg).toContain('component');
      expect(logArg).toContain('scheduler');
    });

    it('should merge context with additional metadata', () => {
      const child = Logger.child({ component: 'scheduler' });
      child.info('Test message', { taskId: 'task-1' });

      const logArg = consoleSpy.log.mock.calls[0][0];
      expect(logArg).toContain('scheduler');
      expect(logArg).toContain('task-1');
    });
  });
});
