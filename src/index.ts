import 'dotenv/config';
import { assertEnv } from './config/env-validator.js';
import { Orchestrator } from './orchestrator.js';
import { logger } from './logging/index.js';

const log = logger.child('Main');

async function main() {
  assertEnv();

  log.info('TrafficControl starting', { phase: 'foundation' });

  const orchestrator = new Orchestrator();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    log.info('Shutting down');
    await orchestrator.stop();
    process.exit(0);
  });

  await orchestrator.start();
}

main().catch(err => {
  log.error('Fatal error', err);
  process.exit(1);
});
