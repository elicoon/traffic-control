### Add Error Recovery Scenario Tests for Resilience Features
- **Project:** TrafficControl
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Phase 5 added resilience features (database health checks, graceful degradation, retry logic), but there are no scenario tests that verify these features actually work during failures. Need tests that simulate failures and verify recovery behavior.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Test simulates database outage during startup (verify retry with exponential backoff)
- [ ] Test simulates database outage during tick (verify degraded mode entry and recovery)
- [ ] Test simulates Slack transient failure (verify retry logic)
- [ ] Test simulates agent crash (verify session cleanup and task reassignment)
- [ ] Test simulates network partition (verify graceful degradation)
- [ ] All tests verify that system emits correct events (database:degraded, database:recovered, etc.)
- [ ] All tests verify that state remains consistent after recovery

#### Next steps
1. Create src/__tests__/scenarios/ directory
2. Add scenario test file: error-recovery.scenario.test.ts
3. Create test utilities for simulating failures (database mock, network mock)
4. Write scenario tests for each failure mode
5. Add npm run test:scenarios script
6. Document recovery scenarios in docs/RESILIENCE.md
7. Verify all scenarios pass consistently
