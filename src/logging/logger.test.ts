/**
 * Tests for the TrafficControl logging module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger, LogLevel } from './logger.js';
import { redact, redactValue, getDefaultRedactFields } from './redaction.js';
import {
  generateCorrelationId,
  getCorrelationId,
  setCorrelationId,
  clearCorrelationId,
  withCorrelation,
  withCorrelationAsync,
} from './correlation.js';

describe('Logger', () => {
  beforeEach(() => {
    logger.reset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log levels', () => {
    it('should default to INFO level', () => {
      expect(logger.getLevel()).toBe(LogLevel.INFO);
    });

    it('should set level from enum', () => {
      logger.setLevel(LogLevel.DEBUG);
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });

    it('should set level from string', () => {
      logger.setLevelFromString('debug');
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);

      logger.setLevelFromString('WARNING');
      expect(logger.getLevel()).toBe(LogLevel.WARN);
    });

    it('should filter logs below current level', () => {
      logger.setLevel(LogLevel.WARN);

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(console.log).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('output format', () => {
    it('should default to pretty format', () => {
      expect(logger.getFormat()).toBe('pretty');
    });

    it('should output JSON when format is json', () => {
      logger.setFormat('json');
      logger.setLevel(LogLevel.DEBUG);
      logger.info('test message', { name: 'value' });

      expect(console.log).toHaveBeenCalledTimes(1);
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('INFO');
      expect(parsed.message).toBe('test message');
      expect(parsed.meta.name).toBe('value');
    });
  });

  describe('child loggers', () => {
    it('should create child logger with component', () => {
      logger.setFormat('json');
      const childLog = logger.child('TestComponent');
      childLog.info('child message');

      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.component).toBe('TestComponent');
    });

    it('should nest component names', () => {
      logger.setFormat('json');
      const parentLog = logger.child('Parent');
      const childLog = parentLog.child('Child');
      childLog.info('nested message');

      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.component).toBe('Parent.Child');
    });
  });

  describe('correlation IDs', () => {
    it('should include correlation ID when set', () => {
      logger.setFormat('json');
      const correlatedLog = logger.withCorrelationId('test-correlation-123');
      correlatedLog.info('correlated message');

      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.correlationId).toBe('test-correlation-123');
    });
  });

  describe('error logging', () => {
    it('should include error details', () => {
      logger.setFormat('json');
      const error = new Error('Test error');
      logger.error('Something failed', error);

      const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.error.message).toBe('Test error');
      expect(parsed.error.name).toBe('Error');
      expect(parsed.error.stack).toBeDefined();
    });

    it('should support error with additional meta', () => {
      logger.setFormat('json');
      const error = new Error('Test error');
      logger.error('Something failed', error, { context: 'test' });

      const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.error.message).toBe('Test error');
      expect(parsed.meta.context).toBe('test');
    });
  });

  describe('timing', () => {
    it('should track operation timing', async () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.setFormat('json');
      const log = logger.child('Timer');

      log.time('operation');
      await new Promise(resolve => setTimeout(resolve, 10));
      const duration = log.timeEnd('operation');

      expect(duration).toBeGreaterThanOrEqual(5);
      expect(console.log).toHaveBeenCalled();

      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.duration).toBeGreaterThanOrEqual(5);
    });

    it('should warn if timer does not exist', () => {
      const log = logger.child('Timer');
      log.timeEnd('nonexistent');

      expect(console.warn).toHaveBeenCalled();
    });
  });
});

describe('Redaction', () => {
  it('should redact sensitive fields by name', () => {
    const input = {
      username: 'john',
      password: 'secret123',
      api_key: 'abc123',
    };

    const result = redact(input);

    expect(result.username).toBe('john');
    expect(result.password).toBe('[REDACTED]');
    expect(result.api_key).toBe('[REDACTED]');
  });

  it('should redact nested objects', () => {
    const input = {
      user: {
        name: 'john',
        settings: {
          password: 'secret123',
        },
      },
    };

    const result = redact(input);
    const user = result.user as Record<string, unknown>;
    const settings = user.settings as Record<string, unknown>;

    expect(user.name).toBe('john');
    expect(settings.password).toBe('[REDACTED]');
  });

  it('should redact arrays with sensitive values', () => {
    const input = {
      items: ['xoxb-123-456-abc', 'normal-value'],
    };

    const result = redact(input);
    const items = result.items as string[];

    expect(items[0]).toBe('[REDACTED]');
    expect(items[1]).toBe('normal-value');
  });

  it('should detect sensitive patterns', () => {
    expect(redactValue('xoxb-123-456-abc')).toBe('[REDACTED]');
    expect(redactValue('sk-abc123def456')).toBe('[REDACTED]');
    expect(redactValue('ghp_abc123def456')).toBe('[REDACTED]');
    expect(redactValue('normal-value')).toBe('normal-value');
  });

  it('should return default redact fields', () => {
    const fields = getDefaultRedactFields();
    expect(fields).toContain('password');
    expect(fields).toContain('token');
    expect(fields).toContain('secret');
  });

  it('should support custom redact fields', () => {
    const input = {
      customSecret: 'should-be-redacted',
      normal: 'visible',
    };

    const result = redact(input, ['customSecret']);

    expect(result.customSecret).toBe('[REDACTED]');
    expect(result.normal).toBe('visible');
  });
});

describe('Correlation', () => {
  beforeEach(() => {
    clearCorrelationId();
  });

  it('should generate unique correlation IDs', () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();

    expect(id1).toMatch(/^tc-[a-z0-9]+-[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
  });

  it('should set and get correlation ID', () => {
    expect(getCorrelationId()).toBeUndefined();

    setCorrelationId('test-123');
    expect(getCorrelationId()).toBe('test-123');

    clearCorrelationId();
    expect(getCorrelationId()).toBeUndefined();
  });

  it('should scope correlation ID with withCorrelation', () => {
    setCorrelationId('outer');

    const result = withCorrelation('inner', () => {
      expect(getCorrelationId()).toBe('inner');
      return 'done';
    });

    expect(result).toBe('done');
    expect(getCorrelationId()).toBe('outer');
  });

  it('should scope correlation ID with withCorrelationAsync', async () => {
    setCorrelationId('outer');

    const result = await withCorrelationAsync('inner', async () => {
      expect(getCorrelationId()).toBe('inner');
      await new Promise(resolve => setTimeout(resolve, 1));
      return 'done';
    });

    expect(result).toBe('done');
    expect(getCorrelationId()).toBe('outer');
  });
});
