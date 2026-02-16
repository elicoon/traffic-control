/**
 * Tests for correlation ID management module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateCorrelationId,
  getCorrelationId,
  setCorrelationId,
  clearCorrelationId,
  withCorrelation,
  withCorrelationAsync,
  ensureCorrelationId,
} from './correlation.js';

describe('Correlation', () => {
  beforeEach(() => {
    clearCorrelationId();
  });

  describe('generateCorrelationId()', () => {
    it('should return a string matching tc-{base36}-{uuid8} format', () => {
      const id = generateCorrelationId();
      // tc- prefix, base36 timestamp, 8-char uuid prefix
      expect(id).toMatch(/^tc-[a-z0-9]+-[a-f0-9]{8}$/);
    });

    it('should generate unique IDs on successive calls', () => {
      const ids = new Set(Array.from({ length: 20 }, () => generateCorrelationId()));
      expect(ids.size).toBe(20);
    });

    it('should contain a valid base36 timestamp segment', () => {
      const before = Date.now();
      const id = generateCorrelationId();
      const after = Date.now();

      const timestampStr = id.split('-')[1];
      const timestamp = parseInt(timestampStr, 36);

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('set/get/clearCorrelationId()', () => {
    it('should return undefined when no ID is set', () => {
      expect(getCorrelationId()).toBeUndefined();
    });

    it('should return the ID after setting it', () => {
      setCorrelationId('my-id-123');
      expect(getCorrelationId()).toBe('my-id-123');
    });

    it('should overwrite a previously set ID', () => {
      setCorrelationId('first');
      setCorrelationId('second');
      expect(getCorrelationId()).toBe('second');
    });

    it('should return undefined after clearing', () => {
      setCorrelationId('will-be-cleared');
      clearCorrelationId();
      expect(getCorrelationId()).toBeUndefined();
    });

    it('should not throw when clearing an already-empty ID', () => {
      expect(() => clearCorrelationId()).not.toThrow();
      expect(getCorrelationId()).toBeUndefined();
    });
  });

  describe('withCorrelation()', () => {
    it('should set the correlation ID during execution', () => {
      withCorrelation('scoped-id', () => {
        expect(getCorrelationId()).toBe('scoped-id');
      });
    });

    it('should return the value from the callback', () => {
      const result = withCorrelation('id', () => 42);
      expect(result).toBe(42);
    });

    it('should restore previous ID after execution', () => {
      setCorrelationId('outer');
      withCorrelation('inner', () => {});
      expect(getCorrelationId()).toBe('outer');
    });

    it('should restore previous ID even when callback throws', () => {
      setCorrelationId('before-error');
      expect(() =>
        withCorrelation('error-scope', () => {
          throw new Error('boom');
        })
      ).toThrow('boom');
      expect(getCorrelationId()).toBe('before-error');
    });

    it('should restore undefined when no previous ID was set', () => {
      withCorrelation('temporary', () => {});
      expect(getCorrelationId()).toBeUndefined();
    });

    it('should support nested calls restoring each level', () => {
      setCorrelationId('level-0');

      withCorrelation('level-1', () => {
        expect(getCorrelationId()).toBe('level-1');

        withCorrelation('level-2', () => {
          expect(getCorrelationId()).toBe('level-2');
        });

        expect(getCorrelationId()).toBe('level-1');
      });

      expect(getCorrelationId()).toBe('level-0');
    });
  });

  describe('withCorrelationAsync()', () => {
    it('should set the correlation ID during async execution', async () => {
      await withCorrelationAsync('async-id', async () => {
        expect(getCorrelationId()).toBe('async-id');
      });
    });

    it('should return the resolved value from the callback', async () => {
      const result = await withCorrelationAsync('id', async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return 'async-result';
      });
      expect(result).toBe('async-result');
    });

    it('should restore previous ID after async execution', async () => {
      setCorrelationId('outer-async');
      await withCorrelationAsync('inner-async', async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
      });
      expect(getCorrelationId()).toBe('outer-async');
    });

    it('should restore previous ID when async callback rejects', async () => {
      setCorrelationId('before-reject');
      await expect(
        withCorrelationAsync('reject-scope', async () => {
          throw new Error('async boom');
        })
      ).rejects.toThrow('async boom');
      expect(getCorrelationId()).toBe('before-reject');
    });

    it('should restore undefined when no previous ID was set', async () => {
      await withCorrelationAsync('temp-async', async () => {});
      expect(getCorrelationId()).toBeUndefined();
    });

    it('should support nested async calls restoring each level', async () => {
      setCorrelationId('async-0');

      await withCorrelationAsync('async-1', async () => {
        expect(getCorrelationId()).toBe('async-1');

        await withCorrelationAsync('async-2', async () => {
          expect(getCorrelationId()).toBe('async-2');
        });

        expect(getCorrelationId()).toBe('async-1');
      });

      expect(getCorrelationId()).toBe('async-0');
    });
  });

  describe('ensureCorrelationId()', () => {
    it('should generate and set an ID when none exists', () => {
      const id = ensureCorrelationId();
      expect(id).toMatch(/^tc-/);
      expect(getCorrelationId()).toBe(id);
    });

    it('should return the existing ID when one is already set', () => {
      setCorrelationId('existing-id');
      const id = ensureCorrelationId();
      expect(id).toBe('existing-id');
    });

    it('should return the same ID on repeated calls', () => {
      const first = ensureCorrelationId();
      const second = ensureCorrelationId();
      expect(first).toBe(second);
    });

    it('should generate a new ID after clearing', () => {
      const first = ensureCorrelationId();
      clearCorrelationId();
      const second = ensureCorrelationId();
      expect(second).not.toBe(first);
      expect(second).toMatch(/^tc-/);
    });
  });
});
