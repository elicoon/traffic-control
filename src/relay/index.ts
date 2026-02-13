/**
 * Slack Claude Relay - Entry Point
 *
 * A lightweight Slack bot that bridges messages from Slack to Claude CLI,
 * enabling remote coding assistance using Claude Max subscription.
 *
 * Features:
 * - Message from Slack (mobile) -> Claude CLI (desktop) -> response back to Slack
 * - Channel-based project routing with dynamic discovery
 * - Conversation continuity via --resume
 * - Progress updates during long-running tasks
 *
 * Usage:
 *   npm run relay        # Start the relay bot
 *   npm run relay:dev    # Start with hot reload
 *
 * Environment Variables:
 *   SLACK_BOT_TOKEN      - Slack bot token (xoxb-...)
 *   SLACK_APP_TOKEN      - Slack app token (xapp-...)
 *   SLACK_SIGNING_SECRET - Slack signing secret
 *   RELAY_TIMEOUT_MS     - Timeout in ms (default: 600000 = 10 min)
 *   RELAY_MODEL          - Model to use (default: sonnet)
 *   RELAY_CLI_PATH       - Path to claude CLI (default: claude)
 *   RELAY_PROJECTS_DIR   - Base dir for project discovery (e.g., /home/eli/projects)
 */

import 'dotenv/config';

import { loadConfig } from './config.js';
import { SessionStore } from './session-store.js';
import { ProjectStore } from './project-store.js';
import { RelayBot } from './bot.js';
import { logger } from '../logging/index.js';

const log = logger.child('Relay');

/**
 * Main entry point for the Slack Claude Relay.
 */
async function main(): Promise<void> {
  log.info('Initializing Slack Claude Relay');

  // Load configuration from environment
  const config = loadConfig();
  log.info('Configuration loaded', {
    model: config.model,
    timeoutMs: config.timeoutMs,
    cliPath: config.cliPath,
    projectsBaseDir: config.projectsBaseDir ?? '(not set)',
  });

  // Create session store (in-memory, ephemeral)
  const sessionStore = new SessionStore();
  log.debug('Session store initialized');

  // Create project store and load existing mappings
  const projectStore = new ProjectStore(undefined, config.projectsBaseDir);
  try {
    projectStore.load();
    log.info('Project store initialized', {
      projectCount: projectStore.size(),
      filePath: projectStore.getFilePath(),
      projectsBaseDir: config.projectsBaseDir ?? '(not set)',
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.warn('Failed to load project store, starting fresh', { error: err.message });
  }

  // Create the bot (handler is created internally by the bot)
  const bot = new RelayBot(config, sessionStore, projectStore);
  log.debug('Relay bot created');

  // Handle graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log.info(`Received ${signal}, shutting down...`);
    try {
      await bot.stop();
      // Save project store on shutdown
      projectStore.save();
      log.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Error during shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start the bot
  try {
    await bot.start();
    log.info('Slack Claude Relay is ready');
    log.info('Listening for messages...');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('Failed to start Relay bot', err);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  const err = error instanceof Error ? error : new Error(String(error));
  log.error('Unhandled error in main', err);
  process.exit(1);
});
