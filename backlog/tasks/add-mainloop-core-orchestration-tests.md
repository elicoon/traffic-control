### Add Unit Tests for MainLoop Core Orchestration Logic
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** MainLoop (src/orchestrator/main-loop.ts) is the core orchestration component at 62.79% statement coverage and 63.04% line coverage. Missing tests around state transitions, degraded mode behavior, error recovery paths, and tick lifecycle edge cases. The untested lines (1059-1091, 1169, 1180-1220) likely cover degraded mode, error handling, and state recovery — critical paths that must work correctly. Recent refactor extracted DatabaseHealthMonitor, making MainLoop more testable.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Test coverage for MainLoop.ts reaches >= 85% statement coverage
- [ ] Tests cover degraded mode entry (consecutive DB failures trigger degraded mode)
- [ ] Tests cover degraded mode exit (recovery after DB becomes healthy)
- [ ] Tests cover tick lifecycle with circuit breaker open (no work scheduled)
- [ ] Tests cover task scheduling priority ordering (high priority tasks first)
- [ ] Tests cover error handling in tick() method (errors don't crash the loop)
- [ ] All new tests pass (`npm test`)

#### Next steps
1. Read src/orchestrator/main-loop.ts focusing on lines 1059-1091, 1169, 1180-1220
2. Read existing main-loop.test.ts to understand current test patterns
3. Create tests for degraded mode state transitions (healthy → degraded → recovered)
4. Create tests for circuit breaker integration (open breaker prevents scheduling)
5. Create tests for tick error handling (errors logged but loop continues)
6. Run `npm run test:coverage` to verify coverage increase
