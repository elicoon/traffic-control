/**
 * Slack Relay Bot
 *
 * Slack Bolt app with event handlers for relaying messages to Claude CLI.
 * Handles app_mention events in channels and direct messages to the bot.
 */

import { App, LogLevel } from '@slack/bolt';
import { logger } from '../logging/index.js';
import type { RelayConfig } from './config.js';
import type { SessionStore } from './session-store.js';
import type { ProjectStore } from './project-store.js';
import { RelayHandler, chunkResponse, type RelayContext, type ProgressCallback, type ProgressUpdate } from './handler.js';

const log = logger.child('Relay.Bot');

/**
 * Slack message context from Bolt events.
 */
interface SlackMessageContext {
  channel: string;
  user: string;
  text: string;
  thread_ts?: string;
  ts: string;
  event_ts: string;
}

/**
 * State for tracking pending project setup conversations.
 * Maps channel IDs to the original message context awaiting a project path.
 */
interface PendingProjectSetup {
  originalMessage: string;
  user: string;
  thread_ts: string;
  timestamp: number;
}

/**
 * Slack Relay Bot class.
 * Manages the Slack Bolt app and event handlers for the relay feature.
 */
export class RelayBot {
  private app: App;
  private config: RelayConfig;
  private sessionStore: SessionStore;
  private projectStore: ProjectStore;
  private handler: RelayHandler;
  private pendingSetups: Map<string, PendingProjectSetup> = new Map();

  /**
   * Create a new RelayBot instance.
   *
   * @param config - Relay configuration
   * @param sessionStore - Session store for thread -> session mapping
   * @param projectStore - Project store for channel -> project mapping
   */
  constructor(
    config: RelayConfig,
    sessionStore: SessionStore,
    projectStore: ProjectStore
  ) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.projectStore = projectStore;
    this.handler = new RelayHandler({
      cliPath: config.cliPath,
      timeoutMs: config.timeoutMs,
      model: config.model,
    });

    // Create Bolt app with Socket Mode
    this.app = new App({
      token: config.slackBotToken,
      signingSecret: config.slackSigningSecret,
      appToken: config.slackAppToken,
      socketMode: true,
      logLevel: LogLevel.INFO,
    });

    this.setupEventHandlers();
  }

  /**
   * Set up Slack event handlers.
   *
   * IMPORTANT: This bot uses ONLY the 'message' event handler, NOT 'app_mention'.
   *
   * Why no app_mention handler?
   * - When a user @mentions the bot in a channel where message.channels is subscribed,
   *   Slack sends BOTH an app_mention AND a message event
   * - Having handlers for both causes the bot to respond TWICE to every @mention
   * - The 'message' event handler alone handles ALL cases:
   *   - Direct messages (message.im)
   *   - Public channel messages (message.channels)
   *   - Private channel messages (message.groups)
   *   - @mentions (included in the message event)
   *
   * REQUIRED SLACK APP CONFIGURATION:
   * The bot will ONLY receive messages if the Slack App is properly configured.
   * In your Slack App settings (api.slack.com/apps), go to:
   *   Event Subscriptions > Subscribe to bot events
   * And ensure these events are subscribed:
   *   - message.channels (for public channels WITHOUT @mention)
   *   - message.im (for direct messages to the bot)
   *   - message.groups (optional, for private channels)
   *
   * If ONLY app_mention is subscribed, users MUST @mention the bot.
   * This is a Slack configuration issue, NOT a code issue.
   */
  private setupEventHandlers(): void {
    // Single unified message handler for ALL message types
    // This replaces the separate app_mention handler to prevent double-responses
    this.app.event('message', async ({ event, say }) => {
      const messageEvent = event as {
        channel_type?: string;
        bot_id?: string;
        subtype?: string;
        channel: string;
        user?: string;
        text?: string;
        thread_ts?: string;
        ts: string;
        event_ts?: string;
      };

      // Skip bot messages to prevent infinite loops
      if (messageEvent.bot_id) {
        log.debug('Skipping bot message', { bot_id: messageEvent.bot_id });
        return;
      }

      // Skip message subtypes (edits, deletes, joins, etc.) - we only want actual messages
      if (messageEvent.subtype) {
        log.debug('Skipping message subtype', { subtype: messageEvent.subtype });
        return;
      }

      // Log all received messages for debugging
      log.info('Received message event', {
        channel: messageEvent.channel,
        user: messageEvent.user,
        channel_type: messageEvent.channel_type,
        has_text: !!messageEvent.text,
        text_preview: messageEvent.text?.substring(0, 50),
        thread_ts: messageEvent.thread_ts,
        ts: messageEvent.ts,
      });

      const slackContext: SlackMessageContext = {
        channel: messageEvent.channel,
        user: messageEvent.user || 'unknown',
        text: messageEvent.text || '',
        thread_ts: messageEvent.thread_ts,
        ts: messageEvent.ts,
        event_ts: messageEvent.event_ts || messageEvent.ts,
      };

      await this.handleMessage(slackContext, say);
    });

    // NOTE: We intentionally do NOT register an app_mention handler.
    // If the Slack App has both message.channels AND app_mention subscribed,
    // having both handlers would cause double responses.
    // The message handler above captures @mentions as well.
    //
    // If you're seeing that the bot only responds to @mentions:
    // 1. Go to api.slack.com/apps > Your App > Event Subscriptions
    // 2. Under "Subscribe to bot events", add: message.channels, message.im
    // 3. Save changes and reinstall the app to your workspace
    // 4. Ensure the bot is invited to the channels where you want it to listen
  }

  /**
   * Handle an incoming message.
   *
   * @param context - Message context
   * @param say - Slack say function for responding
   */
  private async handleMessage(
    context: SlackMessageContext,
    say: (message: string | { text: string; thread_ts?: string }) => Promise<unknown>
  ): Promise<void> {
    const { channel, text, thread_ts, ts } = context;

    // Use the message ts as thread_ts if not in a thread
    const threadTs = thread_ts || ts;

    // Strip bot mention from text
    const cleanText = this.stripMention(text).trim();

    // Debug logging for command detection
    log.debug('Processing message', {
      channel,
      rawText: text,
      cleanText,
      cleanTextLower: cleanText.toLowerCase(),
      startsWithSwitchTo: cleanText.toLowerCase().startsWith('switch to '),
    });

    try {
      // Check for !reset command
      if (cleanText.toLowerCase() === '!reset') {
        await this.handleReset(channel, threadTs, say);
        return;
      }

      // Check for "switch to" command (robust matching)
      // Normalize whitespace and handle various formats like "switch to  project" or "switch to\nproject"
      const switchToMatch = cleanText.match(/^switch\s+to\s+(.+)$/i);
      if (switchToMatch) {
        const projectPath = switchToMatch[1].trim();
        log.info('Detected switch to command', { channel, projectPath, originalText: cleanText });
        await this.handleSwitchProject(channel, projectPath, threadTs, say);
        return;
      }

      // Check if this is a response to a pending project setup
      const pendingSetup = this.pendingSetups.get(channel);
      // Accept response if: no pending setup thread OR user is replying in that thread OR user sent a new message
      const isPendingSetupResponse = pendingSetup && (!thread_ts || thread_ts === pendingSetup.thread_ts);
      if (isPendingSetupResponse) {
        // This might be the project path response
        // Check if it looks like a path (contains / or \) OR can be resolved as a project name
        const looksLikePath = cleanText.includes('/') || cleanText.includes('\\');
        const resolvedPath = this.projectStore.resolveProjectPath(cleanText);

        log.debug('Checking pending setup response', {
          channel,
          cleanText,
          looksLikePath,
          resolvedPath,
          thread_ts,
          pendingThreadTs: pendingSetup.thread_ts,
        });

        if (looksLikePath || resolvedPath) {
          await this.handleProjectSetupResponse(channel, cleanText, resolvedPath, pendingSetup, say);
          return;
        }
      }

      // Check if project is set for this channel
      const projectPath = this.projectStore.get(channel);
      log.info('Project lookup', {
        channel,
        projectPath: projectPath ?? '(not found)',
        allProjects: this.projectStore.toObject(),
      });
      if (!projectPath) {
        await this.handleNoProject(channel, cleanText, context.user, threadTs, say);
        return;
      }

      // Relay message to Claude
      await this.relayMessage(channel, cleanText, projectPath, threadTs, say);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Error handling message', err, { channel, thread_ts: threadTs });

      await say({
        text: `Something went wrong: ${err.message}`,
        thread_ts: threadTs,
      });
    }
  }

  /**
   * Strip bot mention from message text.
   */
  private stripMention(text: string): string {
    // Remove <@BOTID> patterns
    return text.replace(/<@[A-Z0-9]+>/g, '').trim();
  }

  /**
   * Handle !reset command - clear session for this thread.
   */
  private async handleReset(
    channel: string,
    threadTs: string,
    say: (message: string | { text: string; thread_ts?: string }) => Promise<unknown>
  ): Promise<void> {
    log.info('Clearing session', { channel, thread_ts: threadTs });

    this.sessionStore.delete(threadTs);

    await say({
      text: 'Session cleared. Next message will start a fresh conversation.',
      thread_ts: threadTs,
    });
  }

  /**
   * Handle "switch to" command - update project mapping.
   */
  private async handleSwitchProject(
    channel: string,
    projectInput: string,
    threadTs: string,
    say: (message: string | { text: string; thread_ts?: string }) => Promise<unknown>
  ): Promise<void> {
    log.info('Switching project', { channel, projectInput });

    // Try to resolve the project path (handles both full paths and project names)
    const resolvedPath = this.projectStore.resolveProjectPath(projectInput);
    const finalPath = resolvedPath ?? projectInput;

    // Validate the path exists if it wasn't resolved
    if (!resolvedPath) {
      const { existsSync } = await import('node:fs');
      if (!existsSync(finalPath)) {
        await say({
          text: `I couldn't find that directory: \`${finalPath}\`\nPlease provide a valid path or project name.`,
          thread_ts: threadTs,
        });
        return;
      }
    }

    this.projectStore.set(channel, finalPath);

    const projectName = this.getProjectName(finalPath);
    const pathNote = resolvedPath && resolvedPath !== projectInput
      ? ` (resolved from "${projectInput}")`
      : '';

    await say({
      text: `Switched to project: ${projectName}${pathNote}\nPath: \`${finalPath}\``,
      thread_ts: threadTs,
    });
  }

  /**
   * Handle message when no project is set for the channel.
   */
  private async handleNoProject(
    channel: string,
    originalMessage: string,
    user: string,
    threadTs: string,
    say: (message: string | { text: string; thread_ts?: string }) => Promise<unknown>
  ): Promise<void> {
    log.info('No project set for channel', { channel });

    // Store pending setup info
    this.pendingSetups.set(channel, {
      originalMessage,
      user,
      thread_ts: threadTs,
      timestamp: Date.now(),
    });

    // Clean up old pending setups (older than 5 minutes)
    this.cleanupPendingSetups();

    await say({
      text: "I don't have a project set for this channel yet.\nWhich directory should I work in?",
      thread_ts: threadTs,
    });
  }

  /**
   * Handle project path response after asking for project.
   *
   * @param channel - Slack channel ID
   * @param userInput - What the user typed (may be partial name or full path)
   * @param resolvedPath - Already-resolved path, or null if userInput is a direct path
   * @param pendingSetup - The pending setup context
   * @param say - Slack say function
   */
  private async handleProjectSetupResponse(
    channel: string,
    userInput: string,
    resolvedPath: string | null,
    pendingSetup: PendingProjectSetup,
    say: (message: string | { text: string; thread_ts?: string }) => Promise<unknown>
  ): Promise<void> {
    // Use resolved path if available, otherwise try the user input directly
    const finalPath = resolvedPath ?? userInput;

    log.info('Received project path', {
      channel,
      userInput,
      resolvedPath,
      finalPath,
    });

    // Validate that the path exists (if it wasn't already resolved)
    if (!resolvedPath) {
      const { existsSync } = await import('node:fs');
      if (!existsSync(finalPath)) {
        await say({
          text: `I couldn't find that directory: \`${finalPath}\`\nPlease provide a valid path.`,
          thread_ts: pendingSetup.thread_ts,
        });
        return;
      }
    }

    // Save the project mapping
    this.projectStore.set(channel, finalPath);
    log.info('Project saved', {
      channel,
      finalPath,
      allProjects: this.projectStore.toObject(),
    });

    // Clear pending setup
    this.pendingSetups.delete(channel);

    const projectName = this.getProjectName(finalPath);

    // Acknowledge the project setup with project name
    // Show the resolved path if it was different from input
    const pathNote = resolvedPath && resolvedPath !== userInput
      ? `\n\`${finalPath}\``
      : '';
    await say({
      text: `📁 ${projectName}${pathNote}\nGot it! Working on your request...`,
      thread_ts: pendingSetup.thread_ts,
    });

    // Now relay the original message
    await this.relayMessage(
      channel,
      pendingSetup.originalMessage,
      finalPath,
      pendingSetup.thread_ts,
      say
    );
  }

  /**
   * Clean up pending setups older than 5 minutes.
   */
  private cleanupPendingSetups(): void {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    for (const [channel, setup] of this.pendingSetups) {
      if (setup.timestamp < fiveMinutesAgo) {
        this.pendingSetups.delete(channel);
      }
    }
  }

  /**
   * Extract project name from path.
   */
  private getProjectName(projectPath: string): string {
    // Get the last part of the path
    const parts = projectPath.split(/[/\\]/);
    return parts[parts.length - 1] || projectPath;
  }

  /**
   * Relay a message to Claude CLI.
   */
  private async relayMessage(
    channel: string,
    message: string,
    projectPath: string,
    threadTs: string,
    say: (message: string | { text: string; thread_ts?: string }) => Promise<unknown>
  ): Promise<void> {
    const projectName = this.getProjectName(projectPath);

    log.info('Relaying message to Claude', {
      channel,
      projectPath,
      thread_ts: threadTs,
      messageLength: message.length,
    });

    // Post initial acknowledgment with project context
    await say({
      text: `Working on it...`,
      thread_ts: threadTs,
    });

    // Get existing session ID for this thread (for --resume)
    const existingSessionId = this.sessionStore.get(threadTs);

    // Build relay context
    const relayContext: RelayContext = {
      channelId: channel,
      threadTs,
      projectPath,
      existingSessionId,
    };

    // Progress callback to post updates
    const onProgress: ProgressCallback = async (update: ProgressUpdate): Promise<void> => {
      await say({
        text: update.message,
        thread_ts: threadTs,
      });
    };

    // Call the handler to relay to Claude
    const result = await this.handler.relay(message, relayContext, onProgress);

    // Store session ID for future --resume
    if (result.sessionId) {
      this.sessionStore.set(threadTs, result.sessionId);
    }

    // Post final response
    if (result.success) {
      // Chunk response if needed (Slack's 4000 char limit)
      const chunks = chunkResponse(result.response);

      for (const chunk of chunks) {
        await say({
          text: chunk,
          thread_ts: threadTs,
        });
      }
    } else {
      await say({
        text: result.error || 'An unknown error occurred.',
        thread_ts: threadTs,
      });
    }
  }

  /**
   * Start the Slack bot in Socket Mode.
   */
  async start(): Promise<void> {
    log.info('Starting Relay bot in Socket Mode');
    await this.app.start();
    log.info('Relay bot is running');
  }

  /**
   * Stop the Slack bot.
   */
  async stop(): Promise<void> {
    log.info('Stopping Relay bot');
    await this.app.stop();
    log.info('Relay bot stopped');
  }
}
