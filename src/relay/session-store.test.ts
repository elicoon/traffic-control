/**
 * Tests for SessionStore — in-memory mapping of Slack thread timestamps to Claude session IDs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore } from './session-store.js';

// ---------- Tests ----------

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
  });

  describe('set and get', () => {
    it('should store and retrieve a session ID by thread timestamp', () => {
      store.set('1234567890.000001', 'sess-abc123');
      expect(store.get('1234567890.000001')).toBe('sess-abc123');
    });

    it('should overwrite an existing session ID for the same thread', () => {
      store.set('1234567890.000001', 'sess-old');
      store.set('1234567890.000001', 'sess-new');
      expect(store.get('1234567890.000001')).toBe('sess-new');
    });

    it('should store multiple sessions for different threads', () => {
      store.set('1111.001', 'sess-a');
      store.set('2222.002', 'sess-b');
      store.set('3333.003', 'sess-c');
      expect(store.get('1111.001')).toBe('sess-a');
      expect(store.get('2222.002')).toBe('sess-b');
      expect(store.get('3333.003')).toBe('sess-c');
    });
  });

  describe('get (not found)', () => {
    it('should return undefined for a thread that was never stored', () => {
      expect(store.get('nonexistent.thread')).toBeUndefined();
    });

    it('should return undefined after the session is deleted', () => {
      store.set('1234567890.000001', 'sess-abc123');
      store.delete('1234567890.000001');
      expect(store.get('1234567890.000001')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should return true when deleting an existing session', () => {
      store.set('1234567890.000001', 'sess-abc123');
      expect(store.delete('1234567890.000001')).toBe(true);
    });

    it('should return false when deleting a non-existent session', () => {
      expect(store.delete('nonexistent.thread')).toBe(false);
    });

    it('should not affect other sessions when deleting one', () => {
      store.set('1111.001', 'sess-a');
      store.set('2222.002', 'sess-b');
      store.delete('1111.001');
      expect(store.get('2222.002')).toBe('sess-b');
    });
  });

  describe('has', () => {
    it('should return true for an existing session', () => {
      store.set('1234567890.000001', 'sess-abc123');
      expect(store.has('1234567890.000001')).toBe(true);
    });

    it('should return false for a non-existent session', () => {
      expect(store.has('nonexistent.thread')).toBe(false);
    });

    it('should return false after session is deleted', () => {
      store.set('1234567890.000001', 'sess-abc123');
      store.delete('1234567890.000001');
      expect(store.has('1234567890.000001')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all sessions', () => {
      store.set('1111.001', 'sess-a');
      store.set('2222.002', 'sess-b');
      store.set('3333.003', 'sess-c');
      store.clear();
      expect(store.size()).toBe(0);
    });

    it('should make all previous gets return undefined', () => {
      store.set('1111.001', 'sess-a');
      store.set('2222.002', 'sess-b');
      store.clear();
      expect(store.get('1111.001')).toBeUndefined();
      expect(store.get('2222.002')).toBeUndefined();
    });

    it('should be safe to call on empty store', () => {
      expect(() => store.clear()).not.toThrow();
      expect(store.size()).toBe(0);
    });
  });

  describe('size', () => {
    it('should return 0 for a new store', () => {
      expect(store.size()).toBe(0);
    });

    it('should return the number of stored sessions', () => {
      store.set('1111.001', 'sess-a');
      store.set('2222.002', 'sess-b');
      expect(store.size()).toBe(2);
    });

    it('should not increase when overwriting an existing key', () => {
      store.set('1111.001', 'sess-a');
      store.set('1111.001', 'sess-b');
      expect(store.size()).toBe(1);
    });

    it('should decrease after delete', () => {
      store.set('1111.001', 'sess-a');
      store.set('2222.002', 'sess-b');
      store.delete('1111.001');
      expect(store.size()).toBe(1);
    });
  });

  describe('threads', () => {
    it('should return an empty array for a new store', () => {
      expect(store.threads()).toEqual([]);
    });

    it('should return all thread timestamps', () => {
      store.set('1111.001', 'sess-a');
      store.set('2222.002', 'sess-b');
      store.set('3333.003', 'sess-c');
      const threads = store.threads();
      expect(threads).toHaveLength(3);
      expect(threads).toContain('1111.001');
      expect(threads).toContain('2222.002');
      expect(threads).toContain('3333.003');
    });

    it('should not include deleted threads', () => {
      store.set('1111.001', 'sess-a');
      store.set('2222.002', 'sess-b');
      store.delete('1111.001');
      const threads = store.threads();
      expect(threads).toEqual(['2222.002']);
    });

    it('should return a new array each call (not internal reference)', () => {
      store.set('1111.001', 'sess-a');
      const a = store.threads();
      const b = store.threads();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('concurrent session handling', () => {
    it('should handle rapid sequential set/get operations', () => {
      for (let i = 0; i < 100; i++) {
        store.set(`thread.${i}`, `sess-${i}`);
      }
      expect(store.size()).toBe(100);
      for (let i = 0; i < 100; i++) {
        expect(store.get(`thread.${i}`)).toBe(`sess-${i}`);
      }
    });

    it('should handle interleaved set and delete operations', () => {
      store.set('1111.001', 'sess-a');
      store.set('2222.002', 'sess-b');
      store.delete('1111.001');
      store.set('3333.003', 'sess-c');
      store.delete('2222.002');
      store.set('4444.004', 'sess-d');

      expect(store.size()).toBe(2);
      expect(store.has('1111.001')).toBe(false);
      expect(store.has('2222.002')).toBe(false);
      expect(store.get('3333.003')).toBe('sess-c');
      expect(store.get('4444.004')).toBe('sess-d');
    });
  });

  describe('instance isolation', () => {
    it('should not share state between separate instances', () => {
      const store2 = new SessionStore();
      store.set('1111.001', 'sess-a');
      store2.set('2222.002', 'sess-b');

      expect(store.get('2222.002')).toBeUndefined();
      expect(store2.get('1111.001')).toBeUndefined();
      expect(store.size()).toBe(1);
      expect(store2.size()).toBe(1);
    });
  });
});
