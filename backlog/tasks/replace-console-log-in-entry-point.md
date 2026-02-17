### Replace console.log with Structured Logger in Entry Point
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** src/index.ts (entry point) and src/orchestrator.ts still use console.log/console.error for startup messages and fatal errors. This bypasses the structured logging system that provides correlation IDs, redaction, and consistent formatting. Other modules (dashboard, reporter, relay) have already been migrated to structured logging. This creates inconsistent logs where some messages are structured JSON and others are plain console output.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] All console.log/console.error calls in src/index.ts replaced with logger calls
- [ ] All console.log/console.error calls in src/orchestrator.ts replaced with logger calls
- [ ] Startup messages use logger.info() with appropriate component context
- [ ] Fatal errors use logger.error() with error object
- [ ] Graceful shutdown message uses logger.info()
- [ ] All 2348 tests still pass

#### Next steps
1. Read src/index.ts and src/orchestrator.ts to catalog all console calls
2. Import logger from src/logging/index.ts and create component loggers
3. Replace console.log with logger.info() for informational messages
4. Replace console.error with logger.error() for error messages
5. Run npm test to verify no regressions
