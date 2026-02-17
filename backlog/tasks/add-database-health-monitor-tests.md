### Add Unit Tests for DatabaseHealthMonitor to Reach 80%+ Coverage
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** DatabaseHealthMonitor (src/orchestrator/database-health-monitor.ts, 216 lines) was recently extracted from MainLoop (commit b442cf9) to encapsulate health tracking, degraded mode transitions, and recovery attempts. Despite being critical infrastructure for resilience, it has only 33% test coverage with 195 lines uncovered. This includes untested paths for consecutive failure tracking, degraded mode entry/exit, event emission, and recovery backoff logic. Following the pattern established in other repository tests, this should have comprehensive unit tests with mocked dependencies.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Test file exists at `src/orchestrator/database-health-monitor.test.ts`
- [ ] Tests cover health check success/failure scenarios
- [ ] Tests verify degraded mode entry after consecutive failures (based on config.maxConsecutiveDbFailures)
- [ ] Tests verify recovery detection and degraded mode exit
- [ ] Tests verify event emission (`database:healthy`, `database:degraded`, `database:recovered`)
- [ ] Tests verify failure counter reset after successful health check
- [ ] Coverage for database-health-monitor.ts reaches ≥80% statements
- [ ] All existing tests still pass (`npm run test`)

#### Next steps
1. Read `src/orchestrator/database-health-monitor.ts` to understand public API and internal state
2. Review existing health check tests in `src/db/client.test.ts` for mocking patterns
3. Create test file with vitest, mock EventBus and db/client functions
4. Write test suites for constructor, recordSuccess, recordFailure, isHealthy, getStats
5. Write tests for degraded mode transitions (healthy → degraded → recovered)
6. Run `npm run test:coverage` to verify 80%+ coverage target met
