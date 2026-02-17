### Implement Skipped Test Coverage Across Modules
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Found multiple test files with `.skip` or `.todo` markers indicating incomplete test coverage. These include tests in scheduler/task-queue.test.ts, slack/router.test.ts, backlog/validator.test.ts, backlog/markdown-importer.test.ts, agent modules, and orchestrator safety components. While the codebase has excellent overall coverage (2347 passing tests), these skipped tests represent edge cases or complex scenarios that were deferred during initial implementation. With the project now in production use (Phase 5 complete), filling these gaps reduces risk.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] All `.skip()` calls in test files are either implemented or explicitly removed with justification
- [ ] All `.todo()` test stubs are either implemented or removed
- [ ] Test suite shows 0 skipped tests in the final output
- [ ] No new failing tests are introduced (all new tests pass)
- [ ] Document in commit message which skipped tests were implemented vs. removed and why

#### Next steps
1. Search codebase for all occurrences: `grep -r "\.skip\|\.todo" src/**/*.test.ts`
2. For each skipped test, read the surrounding context to understand what needs testing
3. Prioritize by risk: safety modules > core orchestration > utilities
4. Implement tests starting with highest-risk modules (TaskApprovalManager, PreFlightChecker, CircuitBreaker)
