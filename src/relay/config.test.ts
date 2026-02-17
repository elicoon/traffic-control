/**
 * Tests for relay config loader — env var parsing, defaults, validation, and display utilities.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, getDefaults, maskSecret, toDisplayString, RelayConfigError } from './config.js';
import type { RelayConfig } from './config.js';

// ---------- Helpers ----------

/** Required env vars that must be set for loadConfig to succeed */
const REQUIRED_ENV = {
  SLACK_BOT_TOKEN: 'xoxb-test-bot-token',
  SLACK_APP_TOKEN: 'xapp-test-app-token',
  SLACK_SIGNING_SECRET: 'test-signing-secret',
} as const;

/** Optional env vars */
const OPTIONAL_ENV_KEYS = [
  'RELAY_TIMEOUT_MS',
  'RELAY_MODEL',
  'RELAY_CLI_PATH',
  'RELAY_PROJECTS_DIR',
] as const;

/** Save and restore env vars around each test */
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  // Save all relevant env vars
  for (const key of [...Object.keys(REQUIRED_ENV), ...OPTIONAL_ENV_KEYS]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  // Restore all env vars
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

/** Set all required env vars so loadConfig succeeds */
function setRequiredEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    process.env[key] = value;
  }
}

// ---------- Tests ----------

describe('loadConfig', () => {
  describe('required field validation', () => {
    it('should throw RelayConfigError when no env vars are set', () => {
      expect(() => loadConfig()).toThrow(RelayConfigError);
    });

    it('should list all missing required fields', () => {
      try {
        loadConfig();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RelayConfigError);
        const configErr = err as RelayConfigError;
        expect(configErr.missingFields).toContain('SLACK_BOT_TOKEN');
        expect(configErr.missingFields).toContain('SLACK_APP_TOKEN');
        expect(configErr.missingFields).toContain('SLACK_SIGNING_SECRET');
        expect(configErr.missingFields).toHaveLength(3);
      }
    });

    it('should throw when only SLACK_BOT_TOKEN is missing', () => {
      process.env.SLACK_APP_TOKEN = 'xapp-test';
      process.env.SLACK_SIGNING_SECRET = 'secret';

      try {
        loadConfig();
        expect.unreachable('Should have thrown');
      } catch (err) {
        const configErr = err as RelayConfigError;
        expect(configErr.missingFields).toEqual(['SLACK_BOT_TOKEN']);
      }
    });

    it('should throw when only SLACK_APP_TOKEN is missing', () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_SIGNING_SECRET = 'secret';

      try {
        loadConfig();
        expect.unreachable('Should have thrown');
      } catch (err) {
        const configErr = err as RelayConfigError;
        expect(configErr.missingFields).toEqual(['SLACK_APP_TOKEN']);
      }
    });

    it('should throw when only SLACK_SIGNING_SECRET is missing', () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_APP_TOKEN = 'xapp-test';

      try {
        loadConfig();
        expect.unreachable('Should have thrown');
      } catch (err) {
        const configErr = err as RelayConfigError;
        expect(configErr.missingFields).toEqual(['SLACK_SIGNING_SECRET']);
      }
    });

    it('should include descriptive error message', () => {
      try {
        loadConfig();
        expect.unreachable('Should have thrown');
      } catch (err) {
        const configErr = err as RelayConfigError;
        expect(configErr.message).toContain('missing required fields');
        expect(configErr.name).toBe('RelayConfigError');
      }
    });

    it('should treat empty string as missing', () => {
      process.env.SLACK_BOT_TOKEN = '';
      process.env.SLACK_APP_TOKEN = 'xapp-test';
      process.env.SLACK_SIGNING_SECRET = 'secret';

      try {
        loadConfig();
        expect.unreachable('Should have thrown');
      } catch (err) {
        const configErr = err as RelayConfigError;
        expect(configErr.missingFields).toContain('SLACK_BOT_TOKEN');
      }
    });
  });

  describe('default values', () => {
    beforeEach(setRequiredEnv);

    it('should return default timeoutMs of 600000', () => {
      const config = loadConfig();
      expect(config.timeoutMs).toBe(600000);
    });

    it('should return default model of sonnet', () => {
      const config = loadConfig();
      expect(config.model).toBe('sonnet');
    });

    it('should return default cliPath of claude', () => {
      const config = loadConfig();
      expect(config.cliPath).toBe('claude');
    });

    it('should return undefined projectsBaseDir by default', () => {
      const config = loadConfig();
      expect(config.projectsBaseDir).toBeUndefined();
    });

    it('should populate required fields from env vars', () => {
      const config = loadConfig();
      expect(config.slackBotToken).toBe(REQUIRED_ENV.SLACK_BOT_TOKEN);
      expect(config.slackAppToken).toBe(REQUIRED_ENV.SLACK_APP_TOKEN);
      expect(config.slackSigningSecret).toBe(REQUIRED_ENV.SLACK_SIGNING_SECRET);
    });
  });

  describe('custom values from env vars', () => {
    beforeEach(setRequiredEnv);

    it('should parse RELAY_TIMEOUT_MS as integer', () => {
      process.env.RELAY_TIMEOUT_MS = '30000';
      const config = loadConfig();
      expect(config.timeoutMs).toBe(30000);
    });

    it('should fall back to default for non-numeric RELAY_TIMEOUT_MS', () => {
      process.env.RELAY_TIMEOUT_MS = 'not-a-number';
      const config = loadConfig();
      expect(config.timeoutMs).toBe(600000);
    });

    it('should parse RELAY_TIMEOUT_MS with leading digits but trailing text', () => {
      // parseInt('123abc') returns 123
      process.env.RELAY_TIMEOUT_MS = '123abc';
      const config = loadConfig();
      expect(config.timeoutMs).toBe(123);
    });

    it('should accept opus as RELAY_MODEL', () => {
      process.env.RELAY_MODEL = 'opus';
      const config = loadConfig();
      expect(config.model).toBe('opus');
    });

    it('should accept sonnet as RELAY_MODEL', () => {
      process.env.RELAY_MODEL = 'sonnet';
      const config = loadConfig();
      expect(config.model).toBe('sonnet');
    });

    it('should accept RELAY_MODEL case-insensitively', () => {
      process.env.RELAY_MODEL = 'OPUS';
      const config = loadConfig();
      expect(config.model).toBe('opus');
    });

    it('should fall back to default for invalid RELAY_MODEL', () => {
      process.env.RELAY_MODEL = 'gpt4';
      const config = loadConfig();
      expect(config.model).toBe('sonnet');
    });

    it('should use custom RELAY_CLI_PATH', () => {
      process.env.RELAY_CLI_PATH = '/usr/local/bin/claude';
      const config = loadConfig();
      expect(config.cliPath).toBe('/usr/local/bin/claude');
    });

    it('should use RELAY_PROJECTS_DIR for projectsBaseDir', () => {
      process.env.RELAY_PROJECTS_DIR = '/home/user/projects';
      const config = loadConfig();
      expect(config.projectsBaseDir).toBe('/home/user/projects');
    });
  });
});

describe('getDefaults', () => {
  it('should return an object with default values', () => {
    const defaults = getDefaults();
    expect(defaults.timeoutMs).toBe(600000);
    expect(defaults.model).toBe('sonnet');
    expect(defaults.cliPath).toBe('claude');
    expect(defaults.projectsBaseDir).toBeUndefined();
  });

  it('should return a new copy each time', () => {
    const a = getDefaults();
    const b = getDefaults();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('maskSecret', () => {
  it('should show first 4 characters and mask the rest', () => {
    expect(maskSecret('xoxb-12345-secret')).toBe('xoxb***');
  });

  it('should return *** for strings of 4 or fewer characters', () => {
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('abcd')).toBe('***');
  });

  it('should mask 5-character strings showing first 4', () => {
    expect(maskSecret('abcde')).toBe('abcd***');
  });

  it('should handle single character', () => {
    expect(maskSecret('x')).toBe('***');
  });

  it('should handle empty string', () => {
    expect(maskSecret('')).toBe('***');
  });
});

describe('toDisplayString', () => {
  const testConfig: RelayConfig = {
    slackBotToken: 'xoxb-test-token-12345',
    slackAppToken: 'xapp-test-token-67890',
    slackSigningSecret: 'signing-secret-abc',
    timeoutMs: 300000,
    model: 'opus',
    cliPath: '/usr/bin/claude',
    projectsBaseDir: '/home/user/projects',
  };

  it('should return valid JSON string', () => {
    const display = toDisplayString(testConfig);
    expect(() => JSON.parse(display)).not.toThrow();
  });

  it('should mask sensitive token values', () => {
    const display = toDisplayString(testConfig);
    const parsed = JSON.parse(display);
    expect(parsed.slackBotToken).toBe('xoxb***');
    expect(parsed.slackAppToken).toBe('xapp***');
    expect(parsed.slackSigningSecret).toBe('sign***');
  });

  it('should include non-sensitive values in plain text', () => {
    const display = toDisplayString(testConfig);
    const parsed = JSON.parse(display);
    expect(parsed.timeoutMs).toBe(300000);
    expect(parsed.model).toBe('opus');
    expect(parsed.cliPath).toBe('/usr/bin/claude');
    expect(parsed.projectsBaseDir).toBe('/home/user/projects');
  });

  it('should show "(not set)" when projectsBaseDir is undefined', () => {
    const configWithoutProjectsDir: RelayConfig = {
      ...testConfig,
      projectsBaseDir: undefined,
    };
    const display = toDisplayString(configWithoutProjectsDir);
    const parsed = JSON.parse(display);
    expect(parsed.projectsBaseDir).toBe('(not set)');
  });
});
