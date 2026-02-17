### Replace console.log with Structured Logger in orchestrator.ts
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** src/orchestrator.ts contains 36 console.log/error/warn calls — more than any other file in the codebase. The Reporter module was already migrated (commit 2df122e). The structured logger provides correlation IDs, auto-redaction, and level-aware filtering that console.log lacks. This file is the main entry point class that runs in production, so structured logs here directly improve operational observability.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] All 36 console.log/error/warn calls in src/orchestrator.ts are replaced with logger.child('Orchestrator') calls using appropriate log levels (info, warn, error, debug)
- [ ] Build passes (`npm run build`) with zero errors
- [ ] All existing tests pass (`npm run test`)
- [ ] No console.log/error/warn calls remain in src/orchestrator.ts (verified by grep)

#### Next steps
1. Import `logger` from `./logging/index.js` and create `const log = logger.child('Orchestrator')` at module level
2. Replace each console.log with log.info, console.error with log.error, console.warn with log.warn
3. Convert string interpolation to structured metadata objects where possible (e.g., `log.info('Delegation recorded', { taskId, sessionId, model, contextTokens })`)
4. Run build and test suite to verify no regressions
