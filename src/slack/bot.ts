import { App, LogLevel } from '@slack/bolt';

let app: App | null = null;

/**
 * Creates or returns the singleton Slack bot instance.
 * Requires SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and SLACK_APP_TOKEN environment variables.
 */
export function createSlackBot(): App {
  if (app) return app;

  const token = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!token || !signingSecret || !appToken) {
    throw new Error('Missing Slack credentials');
  }

  app = new App({
    token,
    signingSecret,
    appToken,
    socketMode: true,
    logLevel: LogLevel.INFO
  });

  return app;
}

/**
 * Resets the Slack bot singleton. Useful for testing.
 */
export function resetSlackBot(): void {
  app = null;
}

/**
 * Formats a question message from an agent that needs human input.
 */
export function formatQuestion(project: string, question: string): string {
  return `❓ *[${project}]* Agent asks:\n\n${question}`;
}

/**
 * Formats a blocker message when an agent is stuck.
 */
export function formatBlocker(project: string, blocker: string): string {
  return `🚫 *[${project}]* Blocked:\n\n${blocker}`;
}

/**
 * Formats a visual review request message.
 */
export function formatVisualReview(project: string, taskTitle: string): string {
  return `👁️ *[${project}]* Visual review needed for: ${taskTitle}\n\nReact with ✅ to approve or ❌ to request changes.`;
}

/**
 * Formats a status report for multiple projects.
 */
export function formatStatus(projects: Array<{ name: string; activeTasks: number; blockedTasks: number }>): string {
  const lines = projects.map(p =>
    `• *${p.name}*: ${p.activeTasks} active, ${p.blockedTasks} blocked`
  );
  return `📊 *Status Report*\n\n${lines.join('\n')}`;
}

/**
 * Interface for sending Slack messages.
 */
export interface SlackMessage {
  channel: string;
  text: string;
  thread_ts?: string;
}

/**
 * Sends a message to a Slack channel.
 * Returns the message timestamp if successful.
 */
export async function sendMessage(message: SlackMessage): Promise<string | undefined> {
  try {
    const bot = createSlackBot();

    const result = await bot.client.chat.postMessage({
      channel: message.channel,
      text: message.text,
      thread_ts: message.thread_ts
    });

    return result.ts;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Failed to send Slack message: ${errorMessage}`);
    throw new Error(`Failed to send Slack message: ${errorMessage}`);
  }
}

/**
 * Starts the Slack bot in socket mode.
 */
export async function startBot(): Promise<void> {
  const bot = createSlackBot();
  await bot.start();
  console.log('Slack bot is running');
}
