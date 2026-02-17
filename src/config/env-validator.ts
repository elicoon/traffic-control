import { logger } from '../logging/index.js';

const log = logger.child('EnvValidator');

/**
 * Required environment variables that must be present for the orchestrator to start.
 */
const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'ANTHROPIC_API_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
] as const;

/**
 * Optional environment variables that have defaults or degrade gracefully when absent.
 */
const OPTIONAL_VARS = [
  { name: 'TC_LOG_LEVEL', default: 'INFO' },
  { name: 'TC_LOG_FORMAT', default: 'pretty' },
] as const;

export interface ValidationResult {
  valid: boolean;
  missing: string[];
}

/**
 * Validates that all required environment variables are set.
 * Logs warnings for optional variables that are not set.
 *
 * @returns ValidationResult with valid flag and list of missing required vars
 */
export function validateEnv(): ValidationResult {
  const missing: string[] = [];

  for (const name of REQUIRED_VARS) {
    if (!process.env[name]) {
      missing.push(name);
    }
  }

  for (const { name, default: defaultValue } of OPTIONAL_VARS) {
    if (!process.env[name]) {
      log.warn(`Optional env var not set, using default`, { name, default: defaultValue });
    }
  }

  return { valid: missing.length === 0, missing };
}

/**
 * Validates environment variables and throws if any required vars are missing.
 * Call this before initializing any services.
 *
 * @throws Error listing all missing required environment variables
 */
export function assertEnv(): void {
  const result = validateEnv();
  if (!result.valid) {
    const message = [
      'Missing required environment variables:',
      ...result.missing.map(name => `  - ${name}`),
      '',
      'Set these variables in your .env file or environment before starting.',
    ].join('\n');
    log.error('Startup aborted: missing required environment variables', { missing: result.missing });
    throw new Error(message);
  }
  log.info('Environment validation passed', { checked: REQUIRED_VARS.length });
}
