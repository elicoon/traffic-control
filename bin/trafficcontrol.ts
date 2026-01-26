#!/usr/bin/env node
/**
 * TrafficControl CLI Entry Point
 *
 * This is the main executable for the TrafficControl command-line interface.
 * It can be run directly with ts-node/tsx or after compilation.
 *
 * Usage:
 *   npx tsx bin/trafficcontrol.ts <command> [options]
 *   node dist/bin/trafficcontrol.js <command> [options]
 *
 * After `npm link` or global install:
 *   trafficcontrol <command> [options]
 */

import { CLI } from '../src/cli/index.js';

/**
 * Main entry point
 * Passes command-line arguments to the CLI and exits with the appropriate code
 */
async function main(): Promise<void> {
  // Get arguments, skipping node and script path
  const args = process.argv.slice(2);

  try {
    const exitCode = await CLI.run(args);
    process.exit(exitCode);
  } catch (error) {
    // Unexpected error - log and exit with code 1
    console.error('Fatal error:', error instanceof Error ? error.message : 'Unknown error');
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

// Run the CLI
main();
