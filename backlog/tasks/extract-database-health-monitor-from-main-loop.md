### Extract DatabaseHealthMonitor from MainLoop to Reduce Complexity
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** MainLoop is 1384 lines with multiple separable concerns. The database health management subsystem (onDbFailure, onDbSuccess, attemptDbRecovery, emitDatabaseEvent, degraded mode tracking) is a cohesive unit of ~100-150 lines that manages graceful degradation during DB outages. Extracting it into a standalone DatabaseHealthMonitor class would reduce MainLoop complexity, improve testability of the degradation logic in isolation, and align with the existing pattern of extracted safety subsystem classes (CircuitBreaker, SpendMonitor, etc.).
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] New file `src/orchestrator/database-health-monitor.ts` contains a DatabaseHealthMonitor class
- [ ] DatabaseHealthMonitor encapsulates: failure tracking, recovery attempts, degraded mode state, database event emission
- [ ] MainLoop delegates to DatabaseHealthMonitor instead of implementing DB health logic inline
- [ ] All existing database health tests pass without modification (or with minimal import path changes)
- [ ] MainLoop line count reduced by at least 100 lines

#### Next steps
1. Read src/orchestrator/main-loop.ts and identify all database health methods and their shared state (degradedMode flag, failure counters, etc.)
2. Create DatabaseHealthMonitor class with the extracted methods and state
3. Wire DatabaseHealthMonitor into MainLoop constructor, replacing inline methods with delegation
4. Run `npm test` to verify no regressions
5. Verify `npm run build` succeeds
