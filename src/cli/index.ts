/**
 * CLI entry point for TrafficControl
 * Provides command-line interface for the orchestration system
 */

import { Commands, CommandContext, CommandResult } from './commands.js';
import { ConfigLoader, TrafficControlConfig } from './config-loader.js';
import { Logger } from './logger.js';

/**
 * Parsed command-line arguments
 */
export interface ParsedArgs {
  command?: string;
  subcommand?: string;
  args: string[];
  options: Record<string, string | boolean>;
}

/**
 * CLI options
 */
export interface CLIOptions {
  outputFormat?: 'text' | 'json';
}

/**
 * Package version (from package.json)
 */
const VERSION = '1.0.0';

/**
 * Parse command-line arguments into structured format
 */
export function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    args: [],
    options: {},
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const optionName = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('-')) {
        result.options[optionName] = nextArg;
        i += 2;
      } else {
        result.options[optionName] = true;
        i++;
      }
    } else if (arg.startsWith('-')) {
      const optionName = arg.slice(1);
      result.options[optionName] = true;
      i++;
    } else if (!result.command) {
      result.command = arg;
      i++;
    } else if (!result.subcommand && (result.command === 'task' || result.command === 'project' || result.command === 'config')) {
      result.subcommand = arg;
      i++;
    } else {
      result.args.push(arg);
      i++;
    }
  }

  return result;
}

/**
 * Format command result for output
 */
export function formatOutput(result: CommandResult, format: 'text' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  // Text format
  if (result.success) {
    let output = result.message;
    if (result.data) {
      output += '\n' + formatData(result.data);
    }
    return output;
  } else {
    return `Error: ${result.message}`;
  }
}

/**
 * Format data object for text output
 */
function formatData(data: Record<string, unknown>, indent = ''): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          lines.push(formatData(item as Record<string, unknown>, indent + '  '));
        } else {
          lines.push(`${indent}  - ${item}`);
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${indent}${key}:`);
      lines.push(formatData(value as Record<string, unknown>, indent + '  '));
    } else {
      lines.push(`${indent}${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create command context for executing commands
 */
function createContext(config: TrafficControlConfig): CommandContext {
  return {
    config,
    configLoader: ConfigLoader,
    // Other dependencies would be initialized here in production
    // mainLoop, backlogManager, projectRepository, reporter
  };
}

/**
 * CLI class with static methods
 */
export const CLI = {
  /**
   * Run the CLI with given arguments
   */
  async run(args: string[]): Promise<number> {
    const parsed = parseArgs(args);
    const format = (parsed.options.format as 'text' | 'json') || 'text';

    // Handle global flags
    if (parsed.options.help || parsed.options.h) {
      CLI.showHelp();
      return 0;
    }

    if (parsed.options.version || parsed.options.v) {
      CLI.showVersion();
      return 0;
    }

    // If no command, show help
    if (!parsed.command) {
      CLI.showHelp();
      return 0;
    }

    try {
      // Load config
      const configPath = parsed.options.config as string | undefined;
      const config = ConfigLoader.load(configPath);

      // Initialize logger
      Logger.setLevelFromString(config.logLevel);

      // Create context
      const context = createContext(config);

      // Execute command
      const result = await CLI.executeCommand(parsed, context);

      // Output result
      console.log(formatOutput(result, format));

      return result.success ? 0 : 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error: ${message}`);
      return 1;
    }
  },

  /**
   * Execute a command based on parsed arguments
   */
  async executeCommand(parsed: ParsedArgs, context: CommandContext): Promise<CommandResult> {
    const { command, subcommand, args, options } = parsed;

    switch (command) {
      case 'start':
        return Commands.start(context, { configPath: options.config as string });

      case 'stop':
        return Commands.stop(context);

      case 'status':
        return Commands.status(context);

      case 'task':
        return CLI.executeTaskCommand(subcommand, args, options, context);

      case 'project':
        return CLI.executeProjectCommand(subcommand, args, context);

      case 'report':
        return Commands.report(context, {
          format: options.format as 'json' | 'text',
        });

      case 'config':
        return CLI.executeConfigCommand(subcommand, args, context);

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  },

  /**
   * Execute task subcommands
   */
  async executeTaskCommand(
    subcommand: string | undefined,
    args: string[],
    options: Record<string, string | boolean>,
    context: CommandContext
  ): Promise<CommandResult> {
    switch (subcommand) {
      case 'add':
        return Commands.taskAdd(context, {
          description: args[0] || '',
          projectId: options.project as string,
          priority: parseInt(options.priority as string, 10) || 5,
        });

      case 'list':
        return Commands.taskList(context, {
          status: options.status as 'queued' | 'in_progress' | 'blocked' | undefined,
        });

      case 'cancel':
        return Commands.taskCancel(context, args[0] || '');

      default:
        throw new Error(`Unknown task command: ${subcommand}`);
    }
  },

  /**
   * Execute project subcommands
   */
  async executeProjectCommand(
    subcommand: string | undefined,
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    switch (subcommand) {
      case 'list':
        return Commands.projectList(context);

      case 'pause':
        return Commands.projectPause(context, args[0] || '');

      case 'resume':
        return Commands.projectResume(context, args[0] || '');

      default:
        throw new Error(`Unknown project command: ${subcommand}`);
    }
  },

  /**
   * Execute config subcommands
   */
  async executeConfigCommand(
    subcommand: string | undefined,
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    switch (subcommand) {
      case 'show':
        return Commands.configShow(context);

      case 'validate':
        return Commands.configValidate(context, args[0] || '');

      default:
        throw new Error(`Unknown config command: ${subcommand}`);
    }
  },

  /**
   * Show help message
   */
  showHelp(): void {
    const helpText = `
TrafficControl - Autonomous Agent Orchestration System

Usage: trafficcontrol <command> [options]

Commands:
  start [--config <path>]      Start the orchestrator
  stop                         Stop the orchestrator gracefully
  status                       Show current status

  task add <desc> --project <id> --priority <1-10>
                               Add a new task to the backlog
  task list [--status <status>]
                               List tasks (filter: queued|in_progress|blocked)
  task cancel <id>             Cancel a task

  project list                 List all projects
  project pause <id>           Pause a project
  project resume <id>          Resume a paused project

  report [--format json|text]  Generate status report

  config show                  Show current configuration
  config validate <path>       Validate a configuration file

Options:
  --help, -h                   Show this help message
  --version, -v                Show version number
  --config <path>              Path to configuration file
  --format <format>            Output format (json|text)

Environment Variables:
  SUPABASE_URL                 Supabase project URL
  SUPABASE_SERVICE_KEY         Supabase service key
  SLACK_BOT_TOKEN              Slack bot token
  SLACK_CHANNEL_ID             Slack channel ID
  TC_MAX_CONCURRENT_AGENTS     Max concurrent agents (default: 3)
  TC_POLL_INTERVAL_MS          Polling interval in ms (default: 5000)
  TC_LEARNINGS_PATH            Path to learnings directory
  TC_LOG_LEVEL                 Log level (debug|info|warn|error)

Examples:
  trafficcontrol start --config ./config.json
  trafficcontrol task add "Fix login bug" --project proj-1 --priority 8
  trafficcontrol task list --status queued
  trafficcontrol project pause proj-1
  trafficcontrol report --format json
`;

    console.log(helpText);
  },

  /**
   * Show version number
   */
  showVersion(): void {
    console.log(`TrafficControl v${VERSION}`);
  },
};

// Re-export types
export type { CommandResult } from './commands.js';
export type { TrafficControlConfig } from './config-loader.js';
export { Logger, LogLevel } from './logger.js';
