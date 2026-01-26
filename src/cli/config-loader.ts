/**
 * Configuration loader for TrafficControl
 * Supports loading from environment variables and JSON config files
 */

import * as fs from 'fs';

/**
 * Complete TrafficControl configuration
 */
export interface TrafficControlConfig {
  // Database
  supabaseUrl: string;
  supabaseKey: string;

  // Slack
  slackToken: string;
  slackChannelId: string;

  // Capacity
  maxConcurrentAgents: number;
  opusSessionLimit: number;
  sonnetSessionLimit: number;

  // Scheduling
  pollIntervalMs: number;
  reportIntervalMs: number;

  // Paths
  learningsPath: string;
  retrospectivesPath: string;
  agentsPath: string;

  // Notifications
  quietHoursStart: number;
  quietHoursEnd: number;
  batchIntervalMs: number;

  // Logging
  logLevel: string;
}

/**
 * JSON config file format
 */
interface ConfigFileFormat {
  supabase?: {
    url?: string;
    key?: string;
  };
  slack?: {
    token?: string;
    channelId?: string;
  };
  capacity?: {
    maxConcurrentAgents?: number;
    opusSessionLimit?: number;
    sonnetSessionLimit?: number;
  };
  scheduling?: {
    pollIntervalMs?: number;
    reportIntervalMs?: number;
  };
  paths?: {
    learnings?: string;
    retrospectives?: string;
    agents?: string;
  };
  notifications?: {
    quietHoursStart?: number;
    quietHoursEnd?: number;
    batchIntervalMs?: number;
  };
  logging?: {
    level?: string;
  };
}

/**
 * Custom error for configuration validation failures
 */
export class ConfigValidationError extends Error {
  public readonly errors: string[];

  constructor(errors: string[]) {
    super(`Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

/**
 * Default configuration values
 */
const DEFAULTS: Partial<TrafficControlConfig> = {
  maxConcurrentAgents: 3,
  opusSessionLimit: 50,
  sonnetSessionLimit: 100,
  pollIntervalMs: 5000,
  reportIntervalMs: 43200000, // 12 hours
  learningsPath: './learnings',
  retrospectivesPath: './retrospectives',
  agentsPath: './agents.md',
  quietHoursStart: 0,
  quietHoursEnd: 7,
  batchIntervalMs: 1800000, // 30 minutes
  logLevel: 'info',
};

/**
 * Parse an integer from string, returning undefined if invalid
 */
function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Check if a string is a valid URL
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mask sensitive values for display
 */
function maskSecret(value: string): string {
  if (value.length <= 4) return '***';
  return value.substring(0, 4) + '***';
}

export const ConfigLoader = {
  /**
   * Load configuration from environment variables
   */
  fromEnv(): Partial<TrafficControlConfig> {
    const config: Partial<TrafficControlConfig> = {};

    // Database
    if (process.env.SUPABASE_URL) {
      config.supabaseUrl = process.env.SUPABASE_URL;
    }
    if (process.env.SUPABASE_SERVICE_KEY) {
      config.supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    }

    // Slack
    if (process.env.SLACK_BOT_TOKEN) {
      config.slackToken = process.env.SLACK_BOT_TOKEN;
    }
    if (process.env.SLACK_CHANNEL_ID) {
      config.slackChannelId = process.env.SLACK_CHANNEL_ID;
    }

    // Capacity
    const maxAgents = parseIntOrUndefined(process.env.TC_MAX_CONCURRENT_AGENTS);
    if (maxAgents !== undefined) {
      config.maxConcurrentAgents = maxAgents;
    }

    // Scheduling
    const pollInterval = parseIntOrUndefined(process.env.TC_POLL_INTERVAL_MS);
    if (pollInterval !== undefined) {
      config.pollIntervalMs = pollInterval;
    }

    // Paths
    if (process.env.TC_LEARNINGS_PATH) {
      config.learningsPath = process.env.TC_LEARNINGS_PATH;
    }

    // Logging
    if (process.env.TC_LOG_LEVEL) {
      config.logLevel = process.env.TC_LOG_LEVEL;
    }

    return config;
  },

  /**
   * Load configuration from a JSON file
   */
  fromFile(configPath: string): Partial<TrafficControlConfig> {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    let fileContent: string;
    try {
      fileContent = fs.readFileSync(configPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read config file: ${configPath}`);
    }

    let parsed: ConfigFileFormat;
    try {
      parsed = JSON.parse(fileContent);
    } catch {
      throw new Error(`Invalid JSON in config file: ${configPath}`);
    }

    const config: Partial<TrafficControlConfig> = {};

    // Database
    if (parsed.supabase?.url) {
      config.supabaseUrl = parsed.supabase.url;
    }
    if (parsed.supabase?.key) {
      config.supabaseKey = parsed.supabase.key;
    }

    // Slack
    if (parsed.slack?.token) {
      config.slackToken = parsed.slack.token;
    }
    if (parsed.slack?.channelId) {
      config.slackChannelId = parsed.slack.channelId;
    }

    // Capacity
    if (parsed.capacity?.maxConcurrentAgents !== undefined) {
      config.maxConcurrentAgents = parsed.capacity.maxConcurrentAgents;
    }
    if (parsed.capacity?.opusSessionLimit !== undefined) {
      config.opusSessionLimit = parsed.capacity.opusSessionLimit;
    }
    if (parsed.capacity?.sonnetSessionLimit !== undefined) {
      config.sonnetSessionLimit = parsed.capacity.sonnetSessionLimit;
    }

    // Scheduling
    if (parsed.scheduling?.pollIntervalMs !== undefined) {
      config.pollIntervalMs = parsed.scheduling.pollIntervalMs;
    }
    if (parsed.scheduling?.reportIntervalMs !== undefined) {
      config.reportIntervalMs = parsed.scheduling.reportIntervalMs;
    }

    // Paths
    if (parsed.paths?.learnings) {
      config.learningsPath = parsed.paths.learnings;
    }
    if (parsed.paths?.retrospectives) {
      config.retrospectivesPath = parsed.paths.retrospectives;
    }
    if (parsed.paths?.agents) {
      config.agentsPath = parsed.paths.agents;
    }

    // Notifications
    if (parsed.notifications?.quietHoursStart !== undefined) {
      config.quietHoursStart = parsed.notifications.quietHoursStart;
    }
    if (parsed.notifications?.quietHoursEnd !== undefined) {
      config.quietHoursEnd = parsed.notifications.quietHoursEnd;
    }
    if (parsed.notifications?.batchIntervalMs !== undefined) {
      config.batchIntervalMs = parsed.notifications.batchIntervalMs;
    }

    // Logging
    if (parsed.logging?.level) {
      config.logLevel = parsed.logging.level;
    }

    return config;
  },

  /**
   * Load configuration merging file and environment variables
   * Environment variables take precedence over file config
   */
  load(configPath?: string): TrafficControlConfig {
    let fileConfig: Partial<TrafficControlConfig> = {};

    if (configPath) {
      fileConfig = ConfigLoader.fromFile(configPath);
    }

    const envConfig = ConfigLoader.fromEnv();

    // Merge: defaults < file < env
    const merged: Partial<TrafficControlConfig> = {
      ...DEFAULTS,
      ...fileConfig,
      ...envConfig,
    };

    return ConfigLoader.validate(merged);
  },

  /**
   * Validate configuration and apply defaults
   * Throws ConfigValidationError if required fields are missing or invalid
   */
  validate(config: Partial<TrafficControlConfig>): TrafficControlConfig {
    const errors: string[] = [];

    // Apply defaults
    const withDefaults: Partial<TrafficControlConfig> = {
      ...DEFAULTS,
      ...config,
    };

    // Required fields
    if (!withDefaults.supabaseUrl) {
      errors.push('supabaseUrl is required');
    } else if (!isValidUrl(withDefaults.supabaseUrl)) {
      errors.push('supabaseUrl must be a valid URL');
    }

    if (!withDefaults.supabaseKey) {
      errors.push('supabaseKey is required');
    }

    if (!withDefaults.slackToken) {
      errors.push('slackToken is required');
    }

    if (!withDefaults.slackChannelId) {
      errors.push('slackChannelId is required');
    }

    // Numeric validations
    if (withDefaults.maxConcurrentAgents !== undefined && withDefaults.maxConcurrentAgents < 1) {
      errors.push('maxConcurrentAgents must be at least 1');
    }

    if (withDefaults.pollIntervalMs !== undefined && withDefaults.pollIntervalMs < 100) {
      errors.push('pollIntervalMs must be at least 100');
    }

    if (withDefaults.quietHoursStart !== undefined && (withDefaults.quietHoursStart < 0 || withDefaults.quietHoursStart > 23)) {
      errors.push('quietHoursStart must be between 0 and 23');
    }

    if (withDefaults.quietHoursEnd !== undefined && (withDefaults.quietHoursEnd < 0 || withDefaults.quietHoursEnd > 23)) {
      errors.push('quietHoursEnd must be between 0 and 23');
    }

    if (errors.length > 0) {
      throw new ConfigValidationError(errors);
    }

    return withDefaults as TrafficControlConfig;
  },

  /**
   * Get default configuration values
   */
  getDefaults(): Partial<TrafficControlConfig> {
    return { ...DEFAULTS };
  },

  /**
   * Format configuration for display (masking sensitive values)
   */
  toDisplayString(config: TrafficControlConfig): string {
    const displayConfig = {
      supabase: {
        url: config.supabaseUrl,
        key: maskSecret(config.supabaseKey),
      },
      slack: {
        token: maskSecret(config.slackToken),
        channelId: config.slackChannelId,
      },
      capacity: {
        maxConcurrentAgents: config.maxConcurrentAgents,
        opusSessionLimit: config.opusSessionLimit,
        sonnetSessionLimit: config.sonnetSessionLimit,
      },
      scheduling: {
        pollIntervalMs: config.pollIntervalMs,
        reportIntervalMs: config.reportIntervalMs,
      },
      paths: {
        learnings: config.learningsPath,
        retrospectives: config.retrospectivesPath,
        agents: config.agentsPath,
      },
      notifications: {
        quietHoursStart: config.quietHoursStart,
        quietHoursEnd: config.quietHoursEnd,
        batchIntervalMs: config.batchIntervalMs,
      },
      logging: {
        level: config.logLevel,
      },
    };

    return JSON.stringify(displayConfig, null, 2);
  },
};
