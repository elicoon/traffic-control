import 'dotenv/config';
import { Orchestrator } from './orchestrator.js';

async function main() {
  console.log('TrafficControl Phase 1 - Foundation');

  const orchestrator = new Orchestrator();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await orchestrator.stop();
    process.exit(0);
  });

  await orchestrator.start();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
