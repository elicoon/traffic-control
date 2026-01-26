import { App } from '@slack/bolt';
import { createSlackBot } from './bot.js';

/**
 * Type for message handler callbacks.
 */
export type MessageHandler = (text: string, userId: string, threadTs?: string) => Promise<void>;

/**
 * Type for reaction handler callbacks.
 */
export type ReactionHandler = (reaction: string, userId: string, messageTs: string, channel: string) => Promise<void>;

/**
 * Type for command handler callbacks.
 */
export type CommandHandler = (command: string, args: string[], userId: string, respond: (text: string) => Promise<void>) => Promise<void>;

let messageCallback: MessageHandler | null = null;
let reactionCallback: ReactionHandler | null = null;
let commandCallback: CommandHandler | null = null;

/**
 * Sets the handler for incoming direct messages.
 */
export function setMessageHandler(handler: MessageHandler): void {
  messageCallback = handler;
}

/**
 * Sets the handler for reaction events.
 */
export function setReactionHandler(handler: ReactionHandler): void {
  reactionCallback = handler;
}

/**
 * Sets the handler for slash commands.
 */
export function setCommandHandler(handler: CommandHandler): void {
  commandCallback = handler;
}

/**
 * Sets up all Slack event handlers.
 * Must be called after the bot is created but before it starts.
 */
export function setupHandlers(): void {
  const app = createSlackBot();

  // Handle direct messages
  app.message(async ({ message, say }) => {
    if (message.subtype) return; // Ignore message updates, deletes, etc.

    const msg = message as { text?: string; user?: string; thread_ts?: string; ts?: string };

    if (msg.text && msg.user && messageCallback) {
      await messageCallback(msg.text, msg.user, msg.thread_ts ?? msg.ts);
    }
  });

  // Handle slash commands
  app.command('/tc', async ({ command, ack, respond }) => {
    await ack();

    const args = command.text.trim().split(' ');
    const subcommand = args[0]?.toLowerCase() || '';

    // If there's a custom command handler, use it
    if (commandCallback) {
      await commandCallback(subcommand, args.slice(1), command.user_id, async (text: string) => {
        await respond(text);
      });
      return;
    }

    // Default command handling
    switch (subcommand) {
      case 'status':
        await respond('Fetching status...');
        // Will be implemented in orchestrator
        break;

      case 'pause':
        await respond(`Pausing project: ${args[1] || '(none specified)'}`);
        break;

      case 'resume':
        await respond(`Resuming project: ${args[1] || '(none specified)'}`);
        break;

      case 'add':
        const taskDesc = args.slice(1).join(' ');
        await respond(`Adding task: ${taskDesc || '(no description)'}`);
        break;

      case 'help':
      default:
        await respond(
          'TrafficControl commands:\n' +
          '• `/tc status` - Current status\n' +
          '• `/tc pause [project]` - Pause a project\n' +
          '• `/tc resume [project]` - Resume a project\n' +
          '• `/tc add [description]` - Add a task\n' +
          '• `/tc help` - Show this help message'
        );
    }
  });

  // Handle reactions (for visual review approvals)
  app.event('reaction_added', async ({ event }) => {
    const { reaction, item, user } = event;

    // Check for approval/rejection reactions
    if (reaction === 'white_check_mark' || reaction === 'x') {
      console.log(`Reaction ${reaction} from ${user} on message ${item.ts}`);

      if (reactionCallback && item.type === 'message') {
        await reactionCallback(reaction, user, item.ts, item.channel);
      }
    }
  });

  // Handle app mentions
  app.event('app_mention', async ({ event, say }) => {
    const { text, thread_ts } = event;
    // User is always present for app_mention events
    const user = event.user as string;
    // Cast to access ts property which is always present for app_mention events
    const eventTs: string = (event as unknown as { ts: string }).ts;
    const threadContext: string = thread_ts ?? eventTs;

    if (messageCallback) {
      await messageCallback(text, user, threadContext);
    } else {
      await say({
        text: `Hello <@${user}>! Use \`/tc help\` to see available commands.`,
        thread_ts: threadContext
      });
    }
  });
}

/**
 * Resets all handler callbacks. Useful for testing.
 */
export function resetHandlers(): void {
  messageCallback = null;
  reactionCallback = null;
  commandCallback = null;
}
