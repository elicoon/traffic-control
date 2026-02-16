/**
 * Tests for sensitive data redaction module
 */

import { describe, it, expect } from 'vitest';
import { redact, redactValue, getDefaultRedactFields } from './redaction.js';

const REDACTED = '[REDACTED]';

describe('Redaction', () => {
  describe('getDefaultRedactFields()', () => {
    it('should return an array of field names', () => {
      const fields = getDefaultRedactFields();
      expect(Array.isArray(fields)).toBe(true);
      expect(fields.length).toBeGreaterThan(0);
    });

    it('should include common sensitive field names', () => {
      const fields = getDefaultRedactFields();
      expect(fields).toContain('token');
      expect(fields).toContain('password');
      expect(fields).toContain('secret');
      expect(fields).toContain('key');
      expect(fields).toContain('apikey');
      expect(fields).toContain('api_key');
      expect(fields).toContain('authorization');
      expect(fields).toContain('credential');
      expect(fields).toContain('jwt');
      expect(fields).toContain('bearer');
      expect(fields).toContain('access_token');
      expect(fields).toContain('refresh_token');
      expect(fields).toContain('bot_token');
      expect(fields).toContain('signing_secret');
    });

    it('should return a copy (not the original array)', () => {
      const a = getDefaultRedactFields();
      const b = getDefaultRedactFields();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('redactValue()', () => {
    it('should mask Slack tokens (xoxb-...)', () => {
      expect(redactValue('xoxb-123-456-abc')).toBe(REDACTED);
    });

    it('should mask Slack tokens with other prefixes', () => {
      expect(redactValue('xoxp-user-token-here')).toBe(REDACTED);
      expect(redactValue('xoxa-app-token-here')).toBe(REDACTED);
    });

    it('should mask OpenAI/Anthropic keys (sk-...)', () => {
      expect(redactValue('sk-abc123def456')).toBe(REDACTED);
    });

    it('should mask GitHub tokens (ghp_...)', () => {
      expect(redactValue('ghp_abc123def456')).toBe(REDACTED);
    });

    it('should mask JWTs (eyJ...)', () => {
      expect(redactValue('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0')).toBe(REDACTED);
    });

    it('should pass through normal strings', () => {
      expect(redactValue('hello world')).toBe('hello world');
      expect(redactValue('some-normal-value')).toBe('some-normal-value');
      expect(redactValue('')).toBe('');
    });

    it('should pass through strings that look similar but do not match patterns', () => {
      expect(redactValue('xox-not-a-real-token')).toBe('xox-not-a-real-token');
      expect(redactValue('sk')).toBe('sk');
      expect(redactValue('ghp')).toBe('ghp');
    });
  });

  describe('redact()', () => {
    describe('default sensitive fields', () => {
      it('should redact password field', () => {
        const result = redact({ password: 'secret123' });
        expect(result.password).toBe(REDACTED);
      });

      it('should redact token field', () => {
        const result = redact({ token: 'abc' });
        expect(result.token).toBe(REDACTED);
      });

      it('should redact api_key field', () => {
        const result = redact({ api_key: 'key123' });
        expect(result.api_key).toBe(REDACTED);
      });

      it('should redact authorization field', () => {
        const result = redact({ authorization: 'Bearer xyz' });
        expect(result.authorization).toBe(REDACTED);
      });

      it('should preserve non-sensitive fields', () => {
        const result = redact({ username: 'john', password: 'x' });
        expect(result.username).toBe('john');
        expect(result.password).toBe(REDACTED);
      });

      it('should match field names case-insensitively (substring match)', () => {
        const result = redact({
          myPassword: 'x',
          AUTH_TOKEN: 'y',
          slackBotToken: 'z',
        });
        expect(result.myPassword).toBe(REDACTED);
        expect(result.AUTH_TOKEN).toBe(REDACTED);
        expect(result.slackBotToken).toBe(REDACTED);
      });
    });

    describe('custom fields', () => {
      it('should redact custom field names', () => {
        const result = redact({ ssn: '123-45-6789', name: 'John' }, ['ssn']);
        expect(result.ssn).toBe(REDACTED);
        expect(result.name).toBe('John');
      });

      it('should redact both default and custom fields', () => {
        const result = redact(
          { password: 'x', customField: 'y', normal: 'z' },
          ['customField']
        );
        expect(result.password).toBe(REDACTED);
        expect(result.customField).toBe(REDACTED);
        expect(result.normal).toBe('z');
      });

      it('should match custom fields case-insensitively', () => {
        const result = redact({ MyCustom: 'secret' }, ['mycustom']);
        expect(result.MyCustom).toBe(REDACTED);
      });
    });

    describe('sensitive pattern detection in values', () => {
      it('should redact Slack tokens in any field', () => {
        const result = redact({ webhook: 'xoxb-123-456-abc' });
        expect(result.webhook).toBe(REDACTED);
      });

      it('should redact GitHub tokens in any field', () => {
        const result = redact({ repo_access: 'ghp_abc123def456' });
        expect(result.repo_access).toBe(REDACTED);
      });

      it('should redact JWTs in any field', () => {
        const result = redact({
          data: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
        });
        expect(result.data).toBe(REDACTED);
      });

      it('should not redact normal string values', () => {
        const result = redact({ message: 'hello world' });
        expect(result.message).toBe('hello world');
      });
    });

    describe('nested objects', () => {
      it('should redact sensitive fields in nested objects', () => {
        const result = redact({
          user: { name: 'john', password: 'secret' },
        });
        const user = result.user as Record<string, unknown>;
        expect(user.name).toBe('john');
        expect(user.password).toBe(REDACTED);
      });

      it('should redact deeply nested fields', () => {
        const result = redact({
          level1: {
            level2: {
              level3: {
                secret: 'deep-secret',
                safe: 'visible',
              },
            },
          },
        });
        const l3 = (
          (result.level1 as Record<string, unknown>).level2 as Record<string, unknown>
        ).level3 as Record<string, unknown>;
        expect(l3.secret).toBe(REDACTED);
        expect(l3.safe).toBe('visible');
      });

      it('should detect sensitive patterns in nested object values', () => {
        const result = redact({
          config: { endpoint: 'ghp_realtoken123' },
        });
        const config = result.config as Record<string, unknown>;
        expect(config.endpoint).toBe(REDACTED);
      });
    });

    describe('arrays', () => {
      it('should redact sensitive strings in arrays', () => {
        const result = redact({
          items: ['xoxb-123-456-abc', 'normal-string'],
        });
        const items = result.items as string[];
        expect(items[0]).toBe(REDACTED);
        expect(items[1]).toBe('normal-string');
      });

      it('should redact sensitive fields in objects within arrays', () => {
        const result = redact({
          users: [
            { name: 'alice', password: 'pw1' },
            { name: 'bob', password: 'pw2' },
          ],
        });
        const users = result.users as Record<string, unknown>[];
        expect(users[0].name).toBe('alice');
        expect(users[0].password).toBe(REDACTED);
        expect(users[1].name).toBe('bob');
        expect(users[1].password).toBe(REDACTED);
      });

      it('should preserve non-sensitive items in arrays', () => {
        const result = redact({
          tags: ['public', 'open-source', 42],
        });
        const tags = result.tags as unknown[];
        expect(tags).toEqual(['public', 'open-source', 42]);
      });

      it('should handle arrays of mixed types', () => {
        const result = redact({
          mixed: [1, 'safe', { key: 'abc' }, null, true],
        });
        const mixed = result.mixed as unknown[];
        expect(mixed[0]).toBe(1);
        expect(mixed[1]).toBe('safe');
        expect((mixed[2] as Record<string, unknown>).key).toBe(REDACTED);
        expect(mixed[3]).toBeNull();
        expect(mixed[4]).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should return null/undefined input as-is', () => {
        expect(redact(null as unknown as Record<string, unknown>)).toBeNull();
        expect(redact(undefined as unknown as Record<string, unknown>)).toBeUndefined();
      });

      it('should handle empty object', () => {
        const result = redact({});
        expect(result).toEqual({});
      });

      it('should handle non-string values in sensitive fields', () => {
        const result = redact({
          token: 12345,
          secret: true,
          key: null,
        });
        // Field name match causes redaction regardless of value type
        expect(result.token).toBe(REDACTED);
        expect(result.secret).toBe(REDACTED);
        expect(result.key).toBe(REDACTED);
      });

      it('should not mutate the original object', () => {
        const original = { password: 'secret', name: 'john' };
        const result = redact(original);
        expect(original.password).toBe('secret');
        expect(result.password).toBe(REDACTED);
      });

      it('should handle numeric and boolean values in non-sensitive fields', () => {
        const result = redact({ count: 42, active: true, label: 'ok' });
        expect(result.count).toBe(42);
        expect(result.active).toBe(true);
        expect(result.label).toBe('ok');
      });
    });
  });
});
