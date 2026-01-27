/**
 * Adapter Factory for Agent Execution
 *
 * Provides a unified way to get the appropriate adapter (SDK or CLI)
 * based on configuration and environment.
 *
 * Configuration precedence:
 * 1. Explicit AGENT_MODE environment variable (sdk|cli)
 * 2. Presence of ANTHROPIC_API_KEY (if set, use SDK)
 * 3. Default to CLI (assumes Max subscription)
 */

import { IAgentAdapter, ISDKAdapter, SDKAdapter, getSDKAdapter } from './sdk-adapter.js';
import { CLIAdapter, getCLIAdapter } from './cli-adapter.js';
import { logger } from '../logging/index.js';

const log = logger.child('AdapterFactory');

/**
 * Agent execution mode
 */
export type AgentMode = 'sdk' | 'cli';

/**
 * Configuration for adapter selection
 */
export interface AdapterConfig {
  /** Explicit mode selection (overrides auto-detection) */
  mode?: AgentMode;
  /** Path to claude CLI executable (for CLI mode) */
  cliPath?: string;
  /** Timeout for CLI operations in ms */
  cliTimeout?: number;
}

/**
 * Determine the agent mode from environment and config
 */
export function detectAgentMode(config?: AdapterConfig): AgentMode {
  // 1. Explicit config takes precedence
  if (config?.mode) {
    log.debug('Using explicit agent mode from config', { mode: config.mode });
    return config.mode;
  }

  // 2. Check AGENT_MODE environment variable
  const envMode = process.env.AGENT_MODE?.toLowerCase();
  if (envMode === 'sdk' || envMode === 'cli') {
    log.debug('Using agent mode from AGENT_MODE env var', { mode: envMode });
    return envMode;
  }

  // 3. Check for API key - if present, prefer SDK
  if (process.env.ANTHROPIC_API_KEY) {
    log.debug('ANTHROPIC_API_KEY found, defaulting to SDK mode');
    return 'sdk';
  }

  // 4. Default to CLI (subscription-based)
  log.debug('No API key found, defaulting to CLI mode (subscription)');
  return 'cli';
}

/**
 * Get the appropriate adapter based on mode
 */
export function getAdapter(config?: AdapterConfig): IAgentAdapter {
  const mode = detectAgentMode(config);

  if (mode === 'sdk') {
    log.info('Creating SDK adapter for API-based execution');
    return getSDKAdapter();
  } else {
    log.info('Creating CLI adapter for subscription-based execution');
    return getCLIAdapter();
  }
}

/**
 * Create a new adapter instance (not using singletons)
 * Useful for testing or when you need isolated instances
 */
export function createAdapter(config?: AdapterConfig): IAgentAdapter {
  const mode = detectAgentMode(config);

  if (mode === 'sdk') {
    log.info('Creating new SDK adapter instance');
    return new SDKAdapter();
  } else {
    log.info('Creating new CLI adapter instance', {
      cliPath: config?.cliPath,
      timeout: config?.cliTimeout,
    });
    return new CLIAdapter({
      cliPath: config?.cliPath,
      timeout: config?.cliTimeout,
    });
  }
}

/**
 * Check if CLI mode is available (claude CLI is installed)
 */
export async function isCLIAvailable(): Promise<boolean> {
  const { spawn } = await import('node:child_process');

  return new Promise((resolve) => {
    const process = spawn('claude', ['--version'], {
      shell: true,
      windowsHide: true,
    });

    let hasOutput = false;

    process.stdout?.on('data', () => {
      hasOutput = true;
    });

    process.on('close', (code) => {
      resolve(code === 0 && hasOutput);
    });

    process.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      process.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Check if SDK mode is available (API key is set)
 */
export function isSDKAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Get information about available modes
 */
export async function getAvailableModes(): Promise<{
  sdk: boolean;
  cli: boolean;
  recommended: AgentMode;
  reason: string;
}> {
  const sdkAvailable = isSDKAvailable();
  const cliAvailable = await isCLIAvailable();

  let recommended: AgentMode;
  let reason: string;

  if (sdkAvailable && cliAvailable) {
    // Both available - prefer SDK for better token tracking
    recommended = 'sdk';
    reason = 'Both modes available. SDK recommended for better usage tracking.';
  } else if (sdkAvailable) {
    recommended = 'sdk';
    reason = 'Only SDK mode available (CLI not installed).';
  } else if (cliAvailable) {
    recommended = 'cli';
    reason = 'Only CLI mode available (no API key set).';
  } else {
    // Neither available - default to cli and let it fail with helpful error
    recommended = 'cli';
    reason = 'Neither mode available. Please install Claude CLI or set ANTHROPIC_API_KEY.';
  }

  return {
    sdk: sdkAvailable,
    cli: cliAvailable,
    recommended,
    reason,
  };
}
