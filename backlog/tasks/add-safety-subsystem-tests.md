### Add Unit Tests for Safety Subsystem (CircuitBreaker, SpendMonitor, PreFlight, ProductivityMonitor, TaskApproval)
- **Project:** traffic-control
- **Status:** complete
- **Priority:** high
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The safety subsystem at src/orchestrator/safety/ has 5 production components (circuit-breaker.ts, spend-monitor.ts, preflight-checker.ts, productivity-monitor.ts, task-approval-manager.ts) totaling ~1,700 lines of code with 0% test coverage. These components are the primary defense against cost incidents (the project has already had a $50+ cost burn). CircuitBreaker state transitions, SpendMonitor threshold logic, and TaskApprovalManager timeout handling are all complex state machines that should be tested. The rest of the codebase has 72 test files and 1,755 tests — these safety modules are the most critical gap.
- **Added:** 2026-02-14
- **Updated:** 2026-02-14
- **Completed:** 2026-02-14
- **Commit:** 47b6e38

#### Acceptance Criteria
- [x] CircuitBreaker tests cover all 3 state transitions (closed→open, open→half-open, half-open→closed) and failure threshold behavior
- [x] SpendMonitor tests verify all 4 alert thresholds (50%, 75%, 90%, 100%) and hard-stop at budget limit
- [x] PreFlightChecker tests validate database health check, env var validation, and custom check support
- [x] ProductivityMonitor tests verify success rate calculation, failure streak detection (3+ consecutive), and per-model stats
- [x] TaskApprovalManager tests cover auto-approve for confirmed tasks, 5-minute timeout, and rejection handling
- [x] All tests pass in CI (`npm test`)

#### Next steps
1. Create test files: `circuit-breaker.test.ts`, `spend-monitor.test.ts`, `preflight-checker.test.ts`, `productivity-monitor.test.ts`, `task-approval-manager.test.ts` in `src/orchestrator/safety/`
2. For each component, read the implementation and identify state transitions, edge cases, and callback behaviors to test
3. Use vitest mocks for Supabase client and Slack notification callbacks
4. Run `npm test` to verify all new tests pass alongside existing 1,755 tests
