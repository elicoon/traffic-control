/**
 * Configuration loader for the Slack Claude Relay
 * Loads settings from environment variables with sensible defaults
 */

/**
 * Relay configuration interface
 */
export interface RelayConfig {
  /** Slack Bot Token (xoxb-...) - required */
  slackBotToken: string;
  /** Slack App Token (xapp-...) for Socket Mode - required */
  slackAppToken: string;
  /** Slack Signing Secret - required */
  slackSigningSecret: string;
  /** Timeout for Claude CLI operations in milliseconds (default: 600000 = 10 minutes) */
  timeoutMs: number;
  /** Model to use: 'sonnet' or 'opus' (default: 'sonnet') */
  model: 'sonnet' | 'opus';
  /** Path to the Claude CLI executable (default: 'claude') */
  cliPath: string;
  /** Base directory for projects - enables partial name matching (e.g., "/home/eli/projects") */
  projectsBaseDir?: string;
}

/**
 * Default configuration values
 */
const DEFAULTS = {
  timeoutMs: 600000, // 10 minutes
  model: 'sonnet' as const,
  cliPath: 'claude',
  projectsBaseDir: undefined as string | undefined,
};

/**
 * Custom error for configuration validation failures
 */
export class RelayConfigError extends Error {
  public readonly missingFields: string[];

  constructor(missingFields: string[]) {
    super(`Relay configuration error: missing required fields:\n${missingFields.map(f => `  - ${f}`).join('\n')}`);
    this.name = 'RelayConfigError';
    this.missingFields = missingFields;
  }
}

/**
 * Parses an integer from string, returning undefined if invalid
 */
function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Validates that the model value is valid
 */
function parseModel(value: string | undefined): 'sonnet' | 'opus' | undefined {
  if (value === undefined) return undefined;
  const lower = value.toLowerCase();
  if (lower === 'sonnet' || lower === 'opus') {
    return lower;
  }
  return undefined;
}

/**
 * Loads relay configuration from environment variables.
 *
 * Required environment variables:
 * - SLACK_BOT_TOKEN: Slack bot token (xoxb-...)
 * - SLACK_APP_TOKEN: Slack app token for Socket Mode (xapp-...)
 * - SLACK_SIGNING_SECRET: Slack signing secret
 *
 * Optional environment variables:
 * - RELAY_TIMEOUT_MS: CLI timeout in milliseconds (default: 600000)
 * - RELAY_MODEL: Model to use - 'sonnet' or 'opus' (default: 'sonnet')
 * - RELAY_CLI_PATH: Path to Claude CLI (default: 'claude')
 *
 * @returns Validated relay configuration
 * @throws RelayConfigError if required fields are missing
 */
export function loadConfig(): RelayConfig {
  const missingFields: string[] = [];

  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackAppToken = process.env.SLACK_APP_TOKEN;
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

  if (!slackBotToken) {
    missingFields.push('SLACK_BOT_TOKEN');
  }
  if (!slackAppToken) {
    missingFields.push('SLACK_APP_TOKEN');
  }
  if (!slackSigningSecret) {
    missingFields.push('SLACK_SIGNING_SECRET');
  }

  if (missingFields.length > 0) {
    throw new RelayConfigError(missingFields);
  }

  const timeoutMs = parseIntOrUndefined(process.env.RELAY_TIMEOUT_MS) ?? DEFAULTS.timeoutMs;
  const model = parseModel(process.env.RELAY_MODEL) ?? DEFAULTS.model;
  const cliPath = process.env.RELAY_CLI_PATH ?? DEFAULTS.cliPath;
  const projectsBaseDir = process.env.RELAY_PROJECTS_DIR ?? DEFAULTS.projectsBaseDir;

  return {
    slackBotToken: slackBotToken!,
    slackAppToken: slackAppToken!,
    slackSigningSecret: slackSigningSecret!,
    timeoutMs,
    model,
    cliPath,
    projectsBaseDir,
  };
}

/**
 * Gets the default configuration values (for documentation/testing)
 * @returns Default configuration values (without required fields)
 */
export function getDefaults(): typeof DEFAULTS {
  return { ...DEFAULTS };
}

/**
 * Masks a secret value for display (shows first 4 characters)
 * @param value - The secret value to mask
 * @returns Masked string
 */
export function maskSecret(value: string): string {
  if (value.length <= 4) return '***';
  return value.substring(0, 4) + '***';
}

/**
 * Formats configuration for display (masking sensitive values)
 * @param config - The configuration to format
 * @returns Formatted configuration string
 */
export function toDisplayString(config: RelayConfig): string {
  return JSON.stringify({
    slackBotToken: maskSecret(config.slackBotToken),
    slackAppToken: maskSecret(config.slackAppToken),
    slackSigningSecret: maskSecret(config.slackSigningSecret),
    timeoutMs: config.timeoutMs,
    model: config.model,
    cliPath: config.cliPath,
    projectsBaseDir: config.projectsBaseDir ?? '(not set)',
  }, null, 2);
}
