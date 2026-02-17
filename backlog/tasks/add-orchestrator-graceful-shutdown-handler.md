### Add Graceful Shutdown Handler to Orchestrator Main Loop
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Current orchestrator lacks shutdown handling — SIGTERM/SIGINT kills the process immediately without cleanup. Handler-state shows worker sessions running continuously (85 test files, 2213 tests). If orchestrator is killed mid-task or mid-database-write, state becomes inconsistent. Dashboard server has graceful shutdown (backlog/tasks/add-graceful-shutdown-to-dashboard-server.md) but orchestrator does not. Need SIGTERM/SIGINT handlers to: wait for active agents to complete or timeout, flush pending database writes, close database connections, save state file, exit cleanly.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] SIGTERM and SIGINT handlers registered in src/index.ts
- [ ] On shutdown signal, MainLoop.shutdown() called to stop accepting new tasks
- [ ] Active agent sessions given 30s grace period to complete current operation
- [ ] Pending database writes flushed before exit
- [ ] Database connections closed via SupabaseClient.close() or equivalent
- [ ] State file written with shutdown timestamp and active task states
- [ ] Process exits with code 0 on clean shutdown, code 1 on timeout
- [ ] Integration test simulates SIGTERM and verifies clean shutdown

#### Next steps
1. Add MainLoop.shutdown() method to stop tick loop and mark shutdown_requested=true
2. Add process.on('SIGTERM') and process.on('SIGINT') handlers in src/index.ts
3. Implement 30s timeout for active agent cleanup using Promise.race
4. Add StateManager.saveShutdownState() to persist shutdown metadata
5. Add database connection close in shutdown sequence
6. Write integration test that sends SIGTERM and checks for clean exit
