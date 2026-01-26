import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigLoader, TrafficControlConfig, ConfigValidationError } from './config-loader.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe('ConfigLoader', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    // Clear all TC_ environment variables
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('TC_') || key.startsWith('SUPABASE_') || key.startsWith('SLACK_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('fromEnv', () => {
    it('should load config from environment variables', () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'test-key';
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_CHANNEL_ID = 'C12345';
      process.env.TC_MAX_CONCURRENT_AGENTS = '5';
      process.env.TC_POLL_INTERVAL_MS = '3000';
      process.env.TC_LEARNINGS_PATH = './custom/learnings';
      process.env.TC_LOG_LEVEL = 'debug';

      const config = ConfigLoader.fromEnv();

      expect(config.supabaseUrl).toBe('https://test.supabase.co');
      expect(config.supabaseKey).toBe('test-key');
      expect(config.slackToken).toBe('xoxb-test');
      expect(config.slackChannelId).toBe('C12345');
      expect(config.maxConcurrentAgents).toBe(5);
      expect(config.pollIntervalMs).toBe(3000);
      expect(config.learningsPath).toBe('./custom/learnings');
      expect(config.logLevel).toBe('debug');
    });

    it('should return partial config with missing env vars', () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';

      const config = ConfigLoader.fromEnv();

      expect(config.supabaseUrl).toBe('https://test.supabase.co');
      expect(config.supabaseKey).toBeUndefined();
      expect(config.maxConcurrentAgents).toBeUndefined();
    });

    it('should parse numeric values correctly', () => {
      process.env.TC_MAX_CONCURRENT_AGENTS = '10';
      process.env.TC_POLL_INTERVAL_MS = '5000';

      const config = ConfigLoader.fromEnv();

      expect(config.maxConcurrentAgents).toBe(10);
      expect(config.pollIntervalMs).toBe(5000);
    });

    it('should handle invalid numeric values', () => {
      process.env.TC_MAX_CONCURRENT_AGENTS = 'not-a-number';

      const config = ConfigLoader.fromEnv();

      expect(config.maxConcurrentAgents).toBeUndefined();
    });
  });

  describe('fromFile', () => {
    it('should load config from JSON file', () => {
      const mockConfig = {
        supabase: {
          url: 'https://file.supabase.co',
          key: 'file-key',
        },
        slack: {
          token: 'xoxb-file',
          channelId: 'C67890',
        },
        capacity: {
          maxConcurrentAgents: 8,
          opusSessionLimit: 50,
          sonnetSessionLimit: 100,
        },
        scheduling: {
          pollIntervalMs: 4000,
          reportIntervalMs: 43200000,
        },
        paths: {
          learnings: './learnings',
          retrospectives: './retrospectives',
          agents: './agents.md',
        },
        notifications: {
          quietHoursStart: 22,
          quietHoursEnd: 7,
          batchIntervalMs: 1800000,
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const config = ConfigLoader.fromFile('./config.json');

      expect(config.supabaseUrl).toBe('https://file.supabase.co');
      expect(config.supabaseKey).toBe('file-key');
      expect(config.slackToken).toBe('xoxb-file');
      expect(config.maxConcurrentAgents).toBe(8);
      expect(config.pollIntervalMs).toBe(4000);
      expect(config.quietHoursStart).toBe(22);
    });

    it('should throw error if file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => ConfigLoader.fromFile('./missing.json')).toThrow('Config file not found');
    });

    it('should throw error for invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('not valid json');

      expect(() => ConfigLoader.fromFile('./invalid.json')).toThrow('Invalid JSON');
    });
  });

  describe('load', () => {
    it('should merge env vars with file config (env takes precedence)', () => {
      process.env.SUPABASE_URL = 'https://env.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'env-key';
      process.env.SLACK_BOT_TOKEN = 'xoxb-env';
      process.env.SLACK_CHANNEL_ID = 'C-env';

      const fileConfig = {
        supabase: {
          url: 'https://file.supabase.co',
          key: 'file-key',
        },
        slack: {
          token: 'xoxb-file',
          channelId: 'C-file',
        },
        capacity: {
          maxConcurrentAgents: 5,
        },
        scheduling: {
          pollIntervalMs: 5000,
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(fileConfig));

      const config = ConfigLoader.load('./config.json');

      // Env should take precedence
      expect(config.supabaseUrl).toBe('https://env.supabase.co');
      expect(config.supabaseKey).toBe('env-key');
      // File values where env not set
      expect(config.maxConcurrentAgents).toBe(5);
    });

    it('should load from env only when no config file specified', () => {
      process.env.SUPABASE_URL = 'https://env.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'env-key';
      process.env.SLACK_BOT_TOKEN = 'xoxb-env';
      process.env.SLACK_CHANNEL_ID = 'C-env';

      const config = ConfigLoader.load();

      expect(config.supabaseUrl).toBe('https://env.supabase.co');
    });

    it('should apply defaults for missing optional values', () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'test-key';
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_CHANNEL_ID = 'C12345';

      const config = ConfigLoader.load();

      expect(config.maxConcurrentAgents).toBe(3); // default
      expect(config.pollIntervalMs).toBe(5000); // default
      expect(config.opusSessionLimit).toBe(50); // default
      expect(config.sonnetSessionLimit).toBe(100); // default
      expect(config.reportIntervalMs).toBe(43200000); // default (12 hours)
      expect(config.quietHoursStart).toBe(0); // default
      expect(config.quietHoursEnd).toBe(7); // default
      expect(config.batchIntervalMs).toBe(1800000); // default (30 min)
    });
  });

  describe('validate', () => {
    it('should pass with valid complete config', () => {
      const config: Partial<TrafficControlConfig> = {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-key',
        slackToken: 'xoxb-test',
        slackChannelId: 'C12345',
        maxConcurrentAgents: 5,
        pollIntervalMs: 5000,
      };

      const validated = ConfigLoader.validate(config);

      expect(validated.supabaseUrl).toBe('https://test.supabase.co');
    });

    it('should throw ConfigValidationError for missing supabaseUrl', () => {
      const config: Partial<TrafficControlConfig> = {
        supabaseKey: 'test-key',
        slackToken: 'xoxb-test',
        slackChannelId: 'C12345',
      };

      expect(() => ConfigLoader.validate(config)).toThrow(ConfigValidationError);
      expect(() => ConfigLoader.validate(config)).toThrow('supabaseUrl');
    });

    it('should throw ConfigValidationError for missing supabaseKey', () => {
      const config: Partial<TrafficControlConfig> = {
        supabaseUrl: 'https://test.supabase.co',
        slackToken: 'xoxb-test',
        slackChannelId: 'C12345',
      };

      expect(() => ConfigLoader.validate(config)).toThrow(ConfigValidationError);
      expect(() => ConfigLoader.validate(config)).toThrow('supabaseKey');
    });

    it('should throw ConfigValidationError for missing slackToken', () => {
      const config: Partial<TrafficControlConfig> = {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-key',
        slackChannelId: 'C12345',
      };

      expect(() => ConfigLoader.validate(config)).toThrow(ConfigValidationError);
      expect(() => ConfigLoader.validate(config)).toThrow('slackToken');
    });

    it('should throw ConfigValidationError for missing slackChannelId', () => {
      const config: Partial<TrafficControlConfig> = {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-key',
        slackToken: 'xoxb-test',
      };

      expect(() => ConfigLoader.validate(config)).toThrow(ConfigValidationError);
      expect(() => ConfigLoader.validate(config)).toThrow('slackChannelId');
    });

    it('should throw ConfigValidationError for invalid supabaseUrl format', () => {
      const config: Partial<TrafficControlConfig> = {
        supabaseUrl: 'not-a-url',
        supabaseKey: 'test-key',
        slackToken: 'xoxb-test',
        slackChannelId: 'C12345',
      };

      expect(() => ConfigLoader.validate(config)).toThrow(ConfigValidationError);
      expect(() => ConfigLoader.validate(config)).toThrow('valid URL');
    });

    it('should throw ConfigValidationError for invalid maxConcurrentAgents', () => {
      const config: Partial<TrafficControlConfig> = {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-key',
        slackToken: 'xoxb-test',
        slackChannelId: 'C12345',
        maxConcurrentAgents: 0,
      };

      expect(() => ConfigLoader.validate(config)).toThrow(ConfigValidationError);
      expect(() => ConfigLoader.validate(config)).toThrow('maxConcurrentAgents');
    });

    it('should throw ConfigValidationError for invalid pollIntervalMs', () => {
      const config: Partial<TrafficControlConfig> = {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-key',
        slackToken: 'xoxb-test',
        slackChannelId: 'C12345',
        pollIntervalMs: 50, // too low
      };

      expect(() => ConfigLoader.validate(config)).toThrow(ConfigValidationError);
      expect(() => ConfigLoader.validate(config)).toThrow('pollIntervalMs');
    });

    it('should throw ConfigValidationError for invalid quietHoursStart', () => {
      const config: Partial<TrafficControlConfig> = {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-key',
        slackToken: 'xoxb-test',
        slackChannelId: 'C12345',
        quietHoursStart: 25,
      };

      expect(() => ConfigLoader.validate(config)).toThrow(ConfigValidationError);
      expect(() => ConfigLoader.validate(config)).toThrow('quietHoursStart');
    });

    it('should apply defaults during validation', () => {
      const config: Partial<TrafficControlConfig> = {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'test-key',
        slackToken: 'xoxb-test',
        slackChannelId: 'C12345',
      };

      const validated = ConfigLoader.validate(config);

      expect(validated.maxConcurrentAgents).toBe(3);
      expect(validated.pollIntervalMs).toBe(5000);
      expect(validated.learningsPath).toBe('./trafficControl/learnings');
    });

    it('should collect all validation errors', () => {
      const config: Partial<TrafficControlConfig> = {};

      try {
        ConfigLoader.validate(config);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        const validationError = error as ConfigValidationError;
        expect(validationError.errors.length).toBeGreaterThanOrEqual(4);
      }
    });
  });

  describe('getDefaults', () => {
    it('should return default configuration values', () => {
      const defaults = ConfigLoader.getDefaults();

      expect(defaults.maxConcurrentAgents).toBe(3);
      expect(defaults.opusSessionLimit).toBe(50);
      expect(defaults.sonnetSessionLimit).toBe(100);
      expect(defaults.pollIntervalMs).toBe(5000);
      expect(defaults.reportIntervalMs).toBe(43200000);
      expect(defaults.learningsPath).toBe('./trafficControl/learnings');
      expect(defaults.retrospectivesPath).toBe('./trafficControl/retrospectives');
      expect(defaults.agentsPath).toBe('./trafficControl/agents.md');
      expect(defaults.quietHoursStart).toBe(0);
      expect(defaults.quietHoursEnd).toBe(7);
      expect(defaults.batchIntervalMs).toBe(1800000);
      expect(defaults.logLevel).toBe('info');
    });
  });

  describe('toDisplayString', () => {
    it('should format config for display (masking secrets)', () => {
      const config: TrafficControlConfig = {
        supabaseUrl: 'https://test.supabase.co',
        supabaseKey: 'secret-key-12345',
        slackToken: 'xoxb-secret-token',
        slackChannelId: 'C12345',
        maxConcurrentAgents: 5,
        opusSessionLimit: 50,
        sonnetSessionLimit: 100,
        pollIntervalMs: 5000,
        reportIntervalMs: 43200000,
        learningsPath: './learnings',
        retrospectivesPath: './retrospectives',
        agentsPath: './agents.md',
        quietHoursStart: 22,
        quietHoursEnd: 7,
        batchIntervalMs: 1800000,
        logLevel: 'info',
      };

      const display = ConfigLoader.toDisplayString(config);

      expect(display).toContain('https://test.supabase.co');
      expect(display).not.toContain('secret-key-12345');
      expect(display).not.toContain('xoxb-secret-token');
      expect(display).toContain('***');
      expect(display).toContain('C12345');
      expect(display).toContain('5');
    });
  });
});
