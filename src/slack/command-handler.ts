import { formatStatusReport, StatusReportMetrics, RecommendationData } from './bot.js';
import { logger } from '../logging/index.js';

const log = logger.child('Slack.CommandHandler');

/**
 * Status information from the orchestrator.
 */
export interface OrchestratorStatus {
  isRunning: boolean;
  activeAgents: number;
  pendingTasks: number;
  pausedProjects: string[];
}

/**
 * Report data from the reporter.
 */
export interface ReportData {
  metrics: StatusReportMetrics;
  recommendations: RecommendationData;
  timestamp: Date;
}

/**
 * Backlog summary data.
 */
export interface BacklogSummary {
  totalQueued: number;
  totalInProgress: number;
  totalBlocked: number;
  totalPendingProposals: number;
  isBacklogLow: boolean;
  threshold: number;
}

/**
 * Task creation result.
 */
export interface TaskResult {
  id: string;
  title: string;
}

/**
 * Dependencies for the command handler.
 * These are typically provided by the orchestrator, backlog manager, and notification manager.
 */
export interface SlackCommandHandlerDeps {
  // Orchestrator methods
  getStatus: () => Promise<OrchestratorStatus>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  pauseProject: (projectName: string) => Promise<boolean>;
  resumeProject: (projectName: string) => Promise<boolean>;

  // Backlog manager methods
  addTask: (description: string) => Promise<TaskResult>;
  getBacklogSummary: () => Promise<BacklogSummary>;
  prioritizeProject: (projectName: string) => Promise<boolean>;

  // Reporter methods
  generateReport: () => Promise<ReportData>;

  // Notification manager methods
  setDnd: (durationMs: number) => void;
  disableDnd: () => void;
  getDndRemainingMs: () => number;
}

/**
 * Handles Slack commands from users.
 */
export class SlackCommandHandler {
  private deps: SlackCommandHandlerDeps;

  constructor(deps: SlackCommandHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Handles a command and returns the response text.
   */
  async handleCommand(command: string, args: string[], userId: string): Promise<string> {
    const normalizedCommand = command.toLowerCase().trim();
    const trimmedArgs = args.map(a => a.trim()).filter(Boolean);

    log.debug('Handling command', {
      command: normalizedCommand,
      args: trimmedArgs,
      userId
    });

    try {
      log.time(`command-${normalizedCommand}`);
      let result: string;

      switch (normalizedCommand) {
        case 'status':
          result = await this.handleStatus();
          break;
        case 'pause':
          result = await this.handlePause(trimmedArgs);
          break;
        case 'resume':
          result = await this.handleResume(trimmedArgs);
          break;
        case 'add':
          result = await this.handleAdd(trimmedArgs);
          break;
        case 'prioritize':
          result = await this.handlePrioritize(trimmedArgs);
          break;
        case 'report':
          result = await this.handleReport();
          break;
        case 'dnd':
          result = await this.handleDnd(trimmedArgs);
          break;
        case 'help':
          result = this.getHelpText();
          break;
        default:
          log.debug('Unknown command received', { command: normalizedCommand, userId });
          result = `Unknown command: "${command}". Use \`help\` to see available commands.`;
      }

      log.timeEnd(`command-${normalizedCommand}`, { command: normalizedCommand, userId });
      return result;
    } catch (error) {
      log.timeEnd(`command-${normalizedCommand}`);
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Command execution failed', err, {
        command: normalizedCommand,
        args: trimmedArgs,
        userId
      });
      return `Error: ${err.message}`;
    }
  }

  /**
   * Handles the status command.
   */
  private async handleStatus(): Promise<string> {
    const status = await this.deps.getStatus();

    const lines: string[] = [];
    lines.push('*TrafficControl Status*');
    lines.push('');
    lines.push(`State: ${status.isRunning ? 'Running' : 'Stopped'}`);
    lines.push(`Active Agents: ${status.activeAgents}`);
    lines.push(`Pending Tasks: ${status.pendingTasks}`);

    if (status.pausedProjects.length > 0) {
      lines.push('');
      lines.push(`Paused Projects: ${status.pausedProjects.join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Handles the pause command.
   */
  private async handlePause(args: string[]): Promise<string> {
    if (args.length === 0) {
      // Pause all
      log.info('Pausing all agent activity');
      await this.deps.pause();
      return 'Paused all agent activity.';
    }

    // Pause specific project
    const projectName = args.join(' ');
    log.info('Pausing project', { projectName });
    const success = await this.deps.pauseProject(projectName);

    if (success) {
      return `Project "${projectName}" has been paused.`;
    } else {
      log.warn('Project not found for pause', { projectName });
      return `Project "${projectName}" not found.`;
    }
  }

  /**
   * Handles the resume command.
   */
  private async handleResume(args: string[]): Promise<string> {
    if (args.length === 0) {
      // Resume all
      log.info('Resuming all agent activity');
      await this.deps.resume();
      return 'Resumed all agent activity.';
    }

    // Resume specific project
    const projectName = args.join(' ');
    log.info('Resuming project', { projectName });
    const success = await this.deps.resumeProject(projectName);

    if (success) {
      return `Project "${projectName}" has been resumed.`;
    } else {
      log.warn('Project not found for resume', { projectName });
      return `Project "${projectName}" not found.`;
    }
  }

  /**
   * Handles the add task command.
   */
  private async handleAdd(args: string[]): Promise<string> {
    if (args.length === 0) {
      return 'Please provide a task description. Usage: `add task: <description>` or `add <description>`';
    }

    // Remove "task:" prefix if present
    let description = args.join(' ');
    if (description.toLowerCase().startsWith('task:')) {
      description = description.substring(5).trim();
    }

    if (!description) {
      return 'Please provide a task description.';
    }

    log.info('Adding task via Slack command', { descriptionLength: description.length });
    const task = await this.deps.addTask(description);
    log.info('Task added', { taskId: task.id, taskTitle: task.title });
    return `Added task: "${task.title}" (ID: ${task.id})`;
  }

  /**
   * Handles the prioritize command.
   */
  private async handlePrioritize(args: string[]): Promise<string> {
    if (args.length === 0) {
      return 'Please specify a project name. Usage: `prioritize <project name>`';
    }

    const projectName = args.join(' ');
    log.info('Prioritizing project', { projectName });
    const success = await this.deps.prioritizeProject(projectName);

    if (success) {
      return `Project "${projectName}" has been prioritized.`;
    } else {
      log.warn('Project not found for prioritize', { projectName });
      return `Project "${projectName}" not found.`;
    }
  }

  /**
   * Handles the report command.
   */
  private async handleReport(): Promise<string> {
    const report = await this.deps.generateReport();
    return formatStatusReport(report.metrics, report.recommendations);
  }

  /**
   * Handles the dnd command.
   */
  private async handleDnd(args: string[]): Promise<string> {
    // Check for "off" to disable
    if (args.length > 0 && args[0].toLowerCase() === 'off') {
      log.info('Disabling Do Not Disturb via command');
      this.deps.disableDnd();
      return 'Do Not Disturb has been disabled.';
    }

    // Parse duration or use default
    let durationMs = 30 * 60 * 1000; // Default 30 minutes

    if (args.length > 0) {
      const parsed = SlackCommandHandler.parseDuration(args[0]);
      if (parsed !== null) {
        durationMs = parsed;
      }
    }

    log.info('Enabling Do Not Disturb via command', { durationMs });
    this.deps.setDnd(durationMs);
    const durationStr = SlackCommandHandler.formatDuration(durationMs);
    return `Do Not Disturb enabled for ${durationStr}. Only critical blockers will come through.`;
  }

  /**
   * Returns help text for all commands.
   */
  private getHelpText(): string {
    return `*TrafficControl Commands*

*Status & Control*
- \`status\` - Show current status of all agents
- \`pause [project]\` - Pause all agents or a specific project
- \`resume [project]\` - Resume all agents or a specific project

*Task Management*
- \`add task: <description>\` - Add a new task to the backlog
- \`prioritize <project>\` - Bump priority of a project

*Reporting*
- \`report\` - Generate a full status report

*Notifications*
- \`dnd [duration]\` - Enable Do Not Disturb (default: 30m)
- \`dnd off\` - Disable Do Not Disturb

*Duration formats*: \`30m\`, \`2h\`, \`45\` (minutes)

Use \`/tc <command>\` to run any command.`;
  }

  /**
   * Parses a duration string into milliseconds.
   * Supports formats: "30m", "2h", "45" (defaults to minutes)
   */
  static parseDuration(input: string): number | null {
    const normalized = input.toLowerCase().trim();

    // Check for negative values
    if (normalized.startsWith('-')) {
      return null;
    }

    // Parse hours
    const hourMatch = normalized.match(/^(\d+)h$/);
    if (hourMatch) {
      return parseInt(hourMatch[1], 10) * 60 * 60 * 1000;
    }

    // Parse minutes
    const minuteMatch = normalized.match(/^(\d+)m$/);
    if (minuteMatch) {
      return parseInt(minuteMatch[1], 10) * 60 * 1000;
    }

    // Parse plain number as minutes
    const plainMatch = normalized.match(/^(\d+)$/);
    if (plainMatch) {
      return parseInt(plainMatch[1], 10) * 60 * 1000;
    }

    return null;
  }

  /**
   * Formats a duration in milliseconds to a human-readable string.
   */
  static formatDuration(ms: number): string {
    const totalMinutes = Math.floor(ms / (60 * 1000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    const parts: string[] = [];

    if (hours > 0) {
      parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    }
    if (minutes > 0) {
      parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }

    return parts.join(' ') || '0 minutes';
  }
}
