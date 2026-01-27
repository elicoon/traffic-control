#!/usr/bin/env node
/**
 * TrafficControl Short CLI - tc
 *
 * Convenient short command for Claude Code terminal interactions
 * Provides quick access to common TrafficControl operations
 *
 * Usage:
 *   tc status                           # Show system status
 *   tc list [tasks|projects|agents]     # List resources
 *   tc add "task description"           # Add task (prompts for project)
 *   tc watch                            # Watch mode - live updates
 *   tc report                           # Generate report
 *   tc approve [all|1,2,3]              # Approve proposals
 *   tc help                             # Show help
 */

import { CLI } from '../src/cli/index.js';

/**
 * Main entry point for short tc command
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // If no arguments, show quick status
  if (args.length === 0) {
    args.push('status');
  }

  // Map short commands to full commands
  const command = args[0];
  const mappedArgs = mapShortCommand(command, args.slice(1));

  try {
    const exitCode = await CLI.run(mappedArgs);
    process.exit(exitCode);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

/**
 * Map short commands to full CLI commands
 */
function mapShortCommand(command: string, restArgs: string[]): string[] {
  switch (command) {
    case 'ls':
    case 'list':
      // tc list tasks -> task list
      // tc list projects -> project list
      // tc list agents -> agent list
      // tc list (no arg) -> task list
      if (restArgs.length === 0) {
        return ['task', 'list'];
      }
      const resource = restArgs[0];
      if (resource === 'tasks' || resource === 'task') {
        return ['task', 'list', ...restArgs.slice(1)];
      } else if (resource === 'projects' || resource === 'project') {
        return ['project', 'list'];
      } else if (resource === 'agents' || resource === 'agent') {
        return ['agent', 'list'];
      } else if (resource === 'proposals' || resource === 'proposal') {
        return ['proposal', 'list'];
      }
      return ['task', 'list', ...restArgs];

    case 'add':
      // tc add "description" -> task add "description" --project <interactive>
      return ['task', 'add', ...restArgs];

    case 'rm':
    case 'cancel':
      // tc cancel <id> -> task cancel <id>
      return ['task', 'cancel', ...restArgs];

    case 'approve':
      // tc approve all -> proposal approve all
      // tc approve 1,2,3 -> proposal approve 1,2,3
      return ['proposal', 'approve', ...restArgs];

    case 'reject':
      // tc reject 2: reason -> proposal reject 2: reason
      return ['proposal', 'reject', ...restArgs];

    case 'pause':
      // tc pause <project-id> -> project pause <project-id>
      return ['project', 'pause', ...restArgs];

    case 'resume':
      // tc resume <project-id> -> project resume <project-id>
      return ['project', 'resume', ...restArgs];

    case 'capacity':
      // tc capacity -> agent capacity
      return ['agent', 'capacity'];

    case 'backlog':
      // tc backlog -> backlog summary
      return ['backlog', 'summary'];

    case 'watch':
      // tc watch -> watch (new command to be implemented)
      console.log('Watch mode not yet implemented. Use "tc status" for current state.');
      return ['status'];

    case 'help':
    case '--help':
    case '-h':
      showQuickHelp();
      process.exit(0);
      return [];

    default:
      // Pass through to main CLI
      return [command, ...restArgs];
  }
}

/**
 * Show quick help for tc command
 */
function showQuickHelp(): void {
  console.log(`
TrafficControl Quick CLI - tc

Quick Commands:
  tc                          Show current status (default)
  tc status                   Show detailed system status
  tc list [tasks|projects|agents|proposals]
                              List resources (defaults to tasks)
  tc add "description" --project <id> --priority <1-10>
                              Add a new task
  tc cancel <task-id>         Cancel a task
  tc backlog                  Show backlog summary
  tc capacity                 Show agent capacity

Project Commands:
  tc pause <project-id>       Pause a project
  tc resume <project-id>      Resume a project

Proposal Commands:
  tc approve all              Approve all pending proposals
  tc approve 1,2,3            Approve specific proposals by index
  tc reject <index>: <reason> Reject a proposal with reason

Reporting:
  tc report [--format json]   Generate status report
  tc watch                    Live monitoring (coming soon)

Configuration:
  tc config show              Show current configuration
  tc start [--config <path>]  Start orchestrator
  tc stop                     Stop orchestrator

Options:
  --help, -h                  Show this help
  --format json               Output as JSON
  --status <status>           Filter by status

Aliases:
  tc ls                       Alias for 'tc list'
  tc rm                       Alias for 'tc cancel'

Examples:
  tc                          # Quick status check
  tc list tasks --status queued
  tc add "Fix authentication bug" --project proj-1 --priority 8
  tc approve all
  tc reject 2: Not aligned with current priorities

For full command reference:
  trafficcontrol --help
`);
}

// Run the CLI
main();
