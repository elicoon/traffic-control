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

/**
 * Proposal data for formatting.
 */
export interface ProposalData {
  id: string;
  title: string;
  description: string | null;
  impact_score: 'high' | 'medium' | 'low' | null;
  estimated_sessions_opus: number;
  estimated_sessions_sonnet: number;
  reasoning: string | null;
  projectName?: string;
}

/**
 * Formats a single proposal for Slack display.
 */
export function formatProposal(proposal: ProposalData, index?: number): string {
  const impactEmoji = getImpactEmoji(proposal.impact_score);
  const indexPrefix = index !== undefined ? `*${index + 1}.* ` : '';
  const projectInfo = proposal.projectName ? ` _[${proposal.projectName}]_` : '';

  const lines = [
    `${indexPrefix}${impactEmoji} *${proposal.title}*${projectInfo}`
  ];

  if (proposal.description) {
    lines.push(`   ${proposal.description}`);
  }

  const sessions = [];
  if (proposal.estimated_sessions_opus > 0) {
    sessions.push(`${proposal.estimated_sessions_opus} Opus`);
  }
  if (proposal.estimated_sessions_sonnet > 0) {
    sessions.push(`${proposal.estimated_sessions_sonnet} Sonnet`);
  }
  if (sessions.length > 0) {
    lines.push(`   Est: ${sessions.join(' + ')} sessions`);
  }

  if (proposal.reasoning) {
    lines.push(`   _Reasoning: ${proposal.reasoning}_`);
  }

  return lines.join('\n');
}

/**
 * Formats multiple proposals for Slack display.
 */
export function formatProposalBatch(proposals: ProposalData[], title?: string): string {
  if (proposals.length === 0) {
    return 'No proposals to display.';
  }

  const header = title || `Proposed Tasks (${proposals.length})`;
  const formattedProposals = proposals.map((p, i) => formatProposal(p, i));

  const lines = [
    `*${header}*`,
    '',
    ...formattedProposals
  ];

  lines.push('');
  lines.push('_Reply with:_');
  lines.push('`approve all` - Approve all proposals');
  lines.push('`approve 1,2,3` - Approve specific proposals');
  lines.push('`reject 2: reason` - Reject with reason');

  return lines.join('\n');
}

/**
 * Formats a proposal approval confirmation.
 */
export function formatProposalApproved(proposals: ProposalData[]): string {
  if (proposals.length === 0) {
    return 'No proposals were approved.';
  }

  const titles = proposals.map(p => `  - ${p.title}`).join('\n');
  return `Approved ${proposals.length} proposal(s) and added to backlog:\n${titles}`;
}

/**
 * Formats a proposal rejection confirmation.
 */
export function formatProposalRejected(proposal: ProposalData, reason: string): string {
  return `Rejected: *${proposal.title}*\nReason: ${reason}`;
}

/**
 * Formats a low backlog alert.
 */
export function formatBacklogAlert(currentDepth: number, threshold: number, pendingProposals: number): string {
  const lines = [
    'Backlog Running Low',
    '',
    `Current queued tasks: ${currentDepth}`,
    `Threshold: ${threshold}`,
    `Pending proposals: ${pendingProposals}`
  ];

  if (pendingProposals > 0) {
    lines.push('');
    lines.push('_Use `/tc proposals` to review pending proposals._');
  } else {
    lines.push('');
    lines.push('_Generating new proposals..._');
  }

  return lines.join('\n');
}

/**
 * Get the appropriate emoji for impact score.
 */
function getImpactEmoji(impact: 'high' | 'medium' | 'low' | null): string {
  switch (impact) {
    case 'high':
      return '[HIGH]';
    case 'medium':
      return '[MED]';
    case 'low':
      return '[LOW]';
    default:
      return '[ ? ]';
  }
}

/**
 * Metrics data for status report.
 */
export interface StatusReportMetrics {
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
}

/**
 * Recommendation report data.
 */
export interface RecommendationData {
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
}

/**
 * Formats a comprehensive status report for Slack.
 * Includes overview, per-project breakdown, recommendations, and action items.
 */
export function formatStatusReport(
  metrics: StatusReportMetrics,
  recommendations: RecommendationData
): string {
  const lines: string[] = [];
  const timestamp = new Date().toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  // Header
  lines.push(`*TrafficControl Status Report*`);
  lines.push(`_${timestamp}_`);
  lines.push('');

  // Overview Section
  lines.push('*Overview*');
  lines.push('```');
  lines.push(`Projects:    ${metrics.systemMetrics.totalProjects} active`);
  lines.push(`Tasks:       ${metrics.systemMetrics.totalTasksQueued} queued | ${metrics.systemMetrics.totalTasksInProgress} in progress | ${metrics.systemMetrics.totalTasksBlocked} blocked`);
  lines.push(`Completed:   ${metrics.systemMetrics.totalTasksCompletedToday} today | ${metrics.systemMetrics.totalTasksCompletedThisWeek} this week`);
  lines.push(`Sessions:    ${metrics.systemMetrics.totalSessions} total`);
  lines.push(`Utilization: Opus ${Math.round(metrics.systemMetrics.opusUtilization)}% | Sonnet ${Math.round(metrics.systemMetrics.sonnetUtilization)}%`);
  lines.push('```');
  lines.push('');

  // Per-Project Breakdown
  if (metrics.projectMetrics.length > 0) {
    lines.push('*Per-Project Breakdown*');

    for (const project of metrics.projectMetrics) {
      const statusIndicator = project.tasksBlocked > 0 ? '[!]' : '[OK]';
      lines.push(`${statusIndicator} *${project.projectName}* (${Math.round(project.completionRate)}% complete)`);
      lines.push(`   Queued: ${project.tasksQueued} | In Progress: ${project.tasksInProgress} | Blocked: ${project.tasksBlocked}`);
      lines.push(`   Completed: ${project.tasksCompletedToday} today | ${project.tasksCompletedThisWeek} this week`);

      // Show token usage if significant
      if (project.tokensOpus > 0 || project.tokensSonnet > 0) {
        const opusK = Math.round(project.tokensOpus / 1000);
        const sonnetK = Math.round(project.tokensSonnet / 1000);
        lines.push(`   Tokens: ${opusK}K Opus | ${sonnetK}K Sonnet`);
      }
      lines.push('');
    }
  }

  // Recommendations Section
  const hasRecommendations =
    recommendations.systemRecommendations.length > 0 ||
    recommendations.projectRecommendations.size > 0;

  if (hasRecommendations) {
    lines.push('*Recommendations*');

    // Critical items first
    const criticalRecs = [
      ...recommendations.systemRecommendations.filter(r => r.priority === 'critical'),
      ...Array.from(recommendations.projectRecommendations.values())
        .flat()
        .filter(r => r.priority === 'critical')
    ];

    if (criticalRecs.length > 0) {
      lines.push('_Critical:_');
      for (const rec of criticalRecs) {
        lines.push(`  [!] ${rec.message}`);
      }
      lines.push('');
    }

    // Warnings
    const warningRecs = [
      ...recommendations.systemRecommendations.filter(r => r.priority === 'warning'),
      ...Array.from(recommendations.projectRecommendations.values())
        .flat()
        .filter(r => r.priority === 'warning')
    ];

    if (warningRecs.length > 0) {
      lines.push('_Warnings:_');
      for (const rec of warningRecs) {
        lines.push(`  [~] ${rec.message}`);
      }
      lines.push('');
    }

    // Positive feedback
    const positiveRecs = [
      ...recommendations.systemRecommendations.filter(r => r.priority === 'positive'),
      ...Array.from(recommendations.projectRecommendations.values())
        .flat()
        .filter(r => r.priority === 'positive')
    ];

    if (positiveRecs.length > 0) {
      lines.push('_Good News:_');
      for (const rec of positiveRecs) {
        lines.push(`  [+] ${rec.message}`);
      }
      lines.push('');
    }
  }

  // Action Items Section
  if (recommendations.actionItems.length > 0) {
    lines.push('*Action Items*');
    for (let i = 0; i < Math.min(recommendations.actionItems.length, 5); i++) {
      lines.push(`${i + 1}. ${recommendations.actionItems[i]}`);
    }
    if (recommendations.actionItems.length > 5) {
      lines.push(`_...and ${recommendations.actionItems.length - 5} more_`);
    }
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('_Use `/tc report` to generate a new report anytime._');

  return lines.join('\n');
}
