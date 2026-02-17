### Replace console.log with Structured Logger in pre-flight.ts
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** src/orchestrator/pre-flight.ts has 21 console.log calls, primarily in the printDryRunResults method which outputs the pre-flight check summary. These should use the structured logger for consistency with the rest of the codebase. The dry-run output can use log.info at INFO level so it still appears during normal operation.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] All 21 console.log calls in src/orchestrator/pre-flight.ts are replaced with logger.child('PreFlight') calls
- [ ] Build passes (`npm run build`) with zero errors
- [ ] All existing tests pass (`npm run test`)
- [ ] No console.log calls remain in src/orchestrator/pre-flight.ts (verified by grep)

#### Next steps
1. Import `logger` from `../logging/index.js` and create `const log = logger.child('PreFlight')` at module level
2. Replace console.log calls in printDryRunResults with log.info, preserving the readable output format
3. Run build and test suite to verify no regressions
