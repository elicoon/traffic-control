#!/usr/bin/env npx tsx
/**
 * CLI script to clean up test data from the database
 * Run with: npm run cleanup:test-data
 */

import 'dotenv/config';
import { runCleanup } from '../src/db/test-cleanup.js';

runCleanup().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
