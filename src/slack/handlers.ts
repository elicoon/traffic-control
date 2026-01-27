import { App } from '@slack/bolt';
import { createSlackBot, ProposalData, formatProposalBatch, formatProposalApproved, formatProposalRejected, formatStatusReport } from './bot.js';
import { Proposal } from '../db/repositories/proposals.js';
import { logger } from '../logging/index.js';

const log = logger.child('Slack.Handlers');

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

/**
 * Type for proposal action handler callbacks.
 */
export type ProposalActionHandler = (
  action: 'approve' | 'reject',
  proposalIds: string[],
  reason?: string
) => Promise<Proposal[]>;

/**
 * Type for proposal list handler callback.
 */
export type ProposalListHandler = () => Promise<Proposal[]>;

/**
 * Type for report handler callback.
 */
export type ReportHandler = () => Promise<{
  metrics: {
    projectMetrics: Array<{
      projectId: string;
      projectName: string;
      tasksQueued: number;
      tasksInProgress: number;
      tasksBlocked: number;
      tasksCompletedToday: number;
      tasksCompletedThisWeek: number;
      tokensOpus: number;
      tokensSonnet: number;
      sessionsCount: number;
      completionRate: number;
    }>;
    systemMetrics: {
      totalProjects: number;
      totalTasksQueued: number;
      totalTasksInProgress: number;
      totalTasksBlocked: number;
      totalTasksCompletedToday: number;
      totalTasksCompletedThisWeek: number;
      totalTokensOpus: number;
      totalTokensSonnet: number;
      totalSessions: number;
      opusUtilization: number;
      sonnetUtilization: number;
    };
  };
  recommendations: {
    projectRecommendations: Map<string, Array<{
      type: string;
      message: string;
      priority: 'critical' | 'warning' | 'info' | 'positive';
      projectId?: string;
      projectName?: string;
    }>>;
    systemRecommendations: Array<{
      type: string;
      message: string;
      priority: 'critical' | 'warning' | 'info' | 'positive';
    }>;
    actionItems: string[];
  };
  timestamp: Date;
}>;

let messageCallback: MessageHandler | null = null;
let reactionCallback: ReactionHandler | null = null;
let commandCallback: CommandHandler | null = null;
let proposalActionCallback: ProposalActionHandler | null = null;
let proposalListCallback: ProposalListHandler | null = null;
let reportCallback: ReportHandler | null = null;

// Store pending proposals for reference by index
let pendingProposalsCache: Proposal[] = [];

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
 * Sets the handler for proposal actions (approve/reject).
 */
export function setProposalActionHandler(handler: ProposalActionHandler): void {
  proposalActionCallback = handler;
}

/**
 * Sets the handler for listing proposals.
 */
export function setProposalListHandler(handler: ProposalListHandler): void {
  proposalListCallback = handler;
}

/**
 * Sets the handler for generating reports.
 */
export function setReportHandler(handler: ReportHandler): void {
  reportCallback = handler;
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
      log.debug('Processing incoming message', {
        userId: msg.user,
        threadTs: msg.thread_ts ?? msg.ts,
        hasText: !!msg.text
      });
      try {
        await messageCallback(msg.text, msg.user, msg.thread_ts ?? msg.ts);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error('Error in message handler', error, {
          userId: msg.user,
          threadTs: msg.thread_ts ?? msg.ts
        });
      }
    }
  });

  // Handle slash commands
  app.command('/tc', async ({ command, ack, respond }) => {
    await ack();

    const text = command.text?.trim() || '';
    const args = text.split(' ').filter(Boolean);
    const subcommand = args[0]?.toLowerCase() || '';

    try {
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

        case 'proposals':
          await handleProposalsCommand(args.slice(1), respond);
          break;

        case 'approve':
          await handleApproveCommand(args.slice(1), respond);
          break;

        case 'reject':
          await handleRejectCommand(args.slice(1), respond);
          break;

        case 'report':
          await handleReportCommand(respond);
          break;

        case 'help':
        default:
          await respond(
            'TrafficControl commands:\n' +
            '• `/tc status` - Current status\n' +
            '• `/tc report` - Generate a full status report\n' +
            '• `/tc pause [project]` - Pause a project\n' +
            '• `/tc resume [project]` - Resume a project\n' +
            '• `/tc add [description]` - Add a task\n' +
            '• `/tc proposals` - View pending proposals\n' +
            '• `/tc approve all` or `/tc approve 1,2,3` - Approve proposals\n' +
            '• `/tc reject 2: reason` - Reject a proposal\n' +
            '• `/tc help` - Show this help message'
          );
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('Error in command handler', error, {
        subcommand,
        userId: command.user_id
      });
      await respond(`An error occurred while processing your command: ${error.message}`);
    }
  });

  // Handle reactions (for visual review approvals)
  app.event('reaction_added', async ({ event }) => {
    const { reaction, item, user } = event;

    // Check for approval/rejection reactions
    if (reaction === 'white_check_mark' || reaction === 'x') {
      log.debug('Reaction received', {
        reaction,
        userId: user,
        messageTs: item.ts,
        itemType: item.type
      });

      if (reactionCallback && item.type === 'message') {
        try {
          await reactionCallback(reaction, user, item.ts, item.channel);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error('Error in reaction handler', error, {
            reaction,
            userId: user,
            messageTs: item.ts,
            channel: item.channel
          });
        }
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

    try {
      if (messageCallback) {
        await messageCallback(text, user, threadContext);
      } else {
        await say({
          text: `Hello <@${user}>! Use \`/tc help\` to see available commands.`,
          thread_ts: threadContext
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('Error in app_mention handler', error, {
        userId: user,
        threadTs: threadContext
      });
      try {
        await say({
          text: `An error occurred processing your mention: ${error.message}`,
          thread_ts: threadContext
        });
      } catch (sayErr) {
        const sayError = sayErr instanceof Error ? sayErr : new Error(String(sayErr));
        log.error('Failed to send error message', sayError, {
          userId: user,
          threadTs: threadContext
        });
      }
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
  proposalActionCallback = null;
  proposalListCallback = null;
  reportCallback = null;
  pendingProposalsCache = [];
}

/**
 * Handle the report command to generate an immediate status report.
 */
async function handleReportCommand(
  respond: (text: string) => Promise<void>
): Promise<void> {
  if (!reportCallback) {
    await respond('Report generation not configured. Please ensure the reporter is initialized.');
    return;
  }

  try {
    await respond('Generating status report...');

    const report = await reportCallback();
    const formattedReport = formatStatusReport(report.metrics, report.recommendations);

    await respond(formattedReport);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await respond(`Failed to generate report: ${errorMessage}`);
  }
}

/**
 * Handle the proposals command to list pending proposals.
 */
async function handleProposalsCommand(
  args: string[],
  respond: (text: string) => Promise<void>
): Promise<void> {
  if (!proposalListCallback) {
    await respond('Proposal listing not configured.');
    return;
  }

  try {
    const proposals = await proposalListCallback();
    pendingProposalsCache = proposals;

    if (proposals.length === 0) {
      await respond('No pending proposals. The backlog is healthy!');
      return;
    }

    const proposalData: ProposalData[] = proposals.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      impact_score: p.impact_score,
      estimated_sessions_opus: p.estimated_sessions_opus,
      estimated_sessions_sonnet: p.estimated_sessions_sonnet,
      reasoning: p.reasoning
    }));

    await respond(formatProposalBatch(proposalData));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await respond(`Failed to list proposals: ${errorMessage}`);
  }
}

/**
 * Handle the approve command.
 */
async function handleApproveCommand(
  args: string[],
  respond: (text: string) => Promise<void>
): Promise<void> {
  if (!proposalActionCallback) {
    await respond('Proposal actions not configured.');
    return;
  }

  const arg = args.join(' ').toLowerCase().trim();

  if (!arg) {
    await respond('Usage: `/tc approve all` or `/tc approve 1,2,3`');
    return;
  }

  try {
    let idsToApprove: string[] = [];

    if (arg === 'all') {
      // Approve all pending proposals
      if (pendingProposalsCache.length === 0) {
        // Fetch fresh list if cache is empty
        if (proposalListCallback) {
          pendingProposalsCache = await proposalListCallback();
        }
      }
      idsToApprove = pendingProposalsCache.map(p => p.id);
    } else {
      // Parse comma-separated indices (1-based)
      const indices = arg.split(',').map(s => parseInt(s.trim(), 10) - 1);

      if (pendingProposalsCache.length === 0 && proposalListCallback) {
        pendingProposalsCache = await proposalListCallback();
      }

      for (const idx of indices) {
        if (idx >= 0 && idx < pendingProposalsCache.length) {
          idsToApprove.push(pendingProposalsCache[idx].id);
        }
      }
    }

    if (idsToApprove.length === 0) {
      await respond('No valid proposals to approve. Use `/tc proposals` to see the list.');
      return;
    }

    const approved = await proposalActionCallback('approve', idsToApprove);

    const approvedData: ProposalData[] = approved.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      impact_score: p.impact_score,
      estimated_sessions_opus: p.estimated_sessions_opus,
      estimated_sessions_sonnet: p.estimated_sessions_sonnet,
      reasoning: p.reasoning
    }));

    await respond(formatProposalApproved(approvedData));

    // Clear cache since proposals have changed
    pendingProposalsCache = [];
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await respond(`Failed to approve proposals: ${errorMessage}`);
  }
}

/**
 * Handle the reject command.
 */
async function handleRejectCommand(
  args: string[],
  respond: (text: string) => Promise<void>
): Promise<void> {
  if (!proposalActionCallback) {
    await respond('Proposal actions not configured.');
    return;
  }

  const fullArg = args.join(' ').trim();

  if (!fullArg) {
    await respond('Usage: `/tc reject 2: reason for rejection`');
    return;
  }

  // Parse format: "2: reason" or "2 reason"
  const colonIndex = fullArg.indexOf(':');
  let indexStr: string;
  let reason: string;

  if (colonIndex > 0) {
    indexStr = fullArg.substring(0, colonIndex).trim();
    reason = fullArg.substring(colonIndex + 1).trim();
  } else {
    const spaceIndex = fullArg.indexOf(' ');
    if (spaceIndex > 0) {
      indexStr = fullArg.substring(0, spaceIndex).trim();
      reason = fullArg.substring(spaceIndex + 1).trim();
    } else {
      await respond('Please provide a reason: `/tc reject 2: reason`');
      return;
    }
  }

  const index = parseInt(indexStr, 10) - 1;

  if (isNaN(index)) {
    await respond('Invalid proposal number. Use `/tc proposals` to see the list.');
    return;
  }

  try {
    if (pendingProposalsCache.length === 0 && proposalListCallback) {
      pendingProposalsCache = await proposalListCallback();
    }

    if (index < 0 || index >= pendingProposalsCache.length) {
      await respond(`Invalid proposal number. Valid range: 1-${pendingProposalsCache.length}`);
      return;
    }

    const proposalId = pendingProposalsCache[index].id;
    const rejected = await proposalActionCallback('reject', [proposalId], reason);

    if (rejected.length > 0) {
      const rejectedData: ProposalData = {
        id: rejected[0].id,
        title: rejected[0].title,
        description: rejected[0].description,
        impact_score: rejected[0].impact_score,
        estimated_sessions_opus: rejected[0].estimated_sessions_opus,
        estimated_sessions_sonnet: rejected[0].estimated_sessions_sonnet,
        reasoning: rejected[0].reasoning
      };
      await respond(formatProposalRejected(rejectedData, reason));
    }

    // Clear cache since proposals have changed
    pendingProposalsCache = [];
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await respond(`Failed to reject proposal: ${errorMessage}`);
  }
}

/**
 * Parse approval/rejection commands from a message.
 * Returns parsed command info or null if not a proposal command.
 */
export function parseProposalCommand(text: string): {
  action: 'approve' | 'reject' | 'list';
  indices?: number[];
  reason?: string;
} | null {
  const normalized = text.toLowerCase().trim();

  // Check for "approve all"
  if (normalized === 'approve all') {
    return { action: 'approve', indices: [] }; // Empty indices means all
  }

  // Check for "approve 1,2,3"
  const approveMatch = normalized.match(/^approve\s+([\d,\s]+)$/);
  if (approveMatch) {
    const indices = approveMatch[1].split(',').map(s => parseInt(s.trim(), 10) - 1);
    return { action: 'approve', indices };
  }

  // Check for "reject N: reason"
  const rejectMatch = text.match(/^reject\s+(\d+)[:\s]+(.+)$/i);
  if (rejectMatch) {
    const index = parseInt(rejectMatch[1], 10) - 1;
    return { action: 'reject', indices: [index], reason: rejectMatch[2].trim() };
  }

  return null;
}
