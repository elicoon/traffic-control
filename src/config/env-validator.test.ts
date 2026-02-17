import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateEnv, assertEnv } from './env-validator.js';

const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'ANTHROPIC_API_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
];

const OPTIONAL_VARS = ['TC_LOG_LEVEL', 'TC_LOG_FORMAT'];

describe('validateEnv', () => {
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and set all required vars
    [...REQUIRED_VARS, ...OPTIONAL_VARS].forEach(name => {
      savedEnv[name] = process.env[name];
    });
    REQUIRED_VARS.forEach(name => {
      process.env[name] = `test-${name}`;
    });
    OPTIONAL_VARS.forEach(name => {
      delete process.env[name];
    });
    // Suppress logger output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    [...REQUIRED_VARS, ...OPTIONAL_VARS].forEach(name => {
      if (savedEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = savedEnv[name];
      }
    });
    savedEnv = {};
    vi.restoreAllMocks();
  });

  it('passes when all required vars are present', () => {
    const result = validateEnv();
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('fails when one required var is missing', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('ANTHROPIC_API_KEY');
    expect(result.missing).toHaveLength(1);
  });

  it('fails with all missing names when multiple required vars are absent', () => {
    delete process.env['SUPABASE_URL'];
    delete process.env['SLACK_BOT_TOKEN'];
    delete process.env['SLACK_APP_TOKEN'];
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('SUPABASE_URL');
    expect(result.missing).toContain('SLACK_BOT_TOKEN');
    expect(result.missing).toContain('SLACK_APP_TOKEN');
    expect(result.missing).toHaveLength(3);
  });

  it('passes even when optional vars are missing', () => {
    // Optional vars already deleted in beforeEach
    const result = validateEnv();
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });
});

describe('assertEnv', () => {
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    REQUIRED_VARS.forEach(name => {
      savedEnv[name] = process.env[name];
      process.env[name] = `test-${name}`;
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    REQUIRED_VARS.forEach(name => {
      if (savedEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = savedEnv[name];
      }
    });
    savedEnv = {};
    vi.restoreAllMocks();
  });

  it('does not throw when all required vars are present', () => {
    expect(() => assertEnv()).not.toThrow();
  });

  it('throws an error listing the missing var when one is absent', () => {
    delete process.env['SUPABASE_SERVICE_KEY'];
    expect(() => assertEnv()).toThrow('SUPABASE_SERVICE_KEY');
  });

  it('throws an error listing all missing vars when multiple are absent', () => {
    delete process.env['SUPABASE_URL'];
    delete process.env['ANTHROPIC_API_KEY'];
    expect(() => assertEnv()).toThrow(/SUPABASE_URL/);
    expect(() => assertEnv()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('error message includes startup guidance', () => {
    delete process.env['SLACK_SIGNING_SECRET'];
    expect(() => assertEnv()).toThrow(/Missing required environment variables/);
  });
});
