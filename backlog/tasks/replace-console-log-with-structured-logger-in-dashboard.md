### Replace console.log with Structured Logger in Dashboard Server and API Routes
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** src/dashboard/server.ts has 13 console.error calls and src/dashboard/routes/api.ts has 11 console.error/warn calls (24 total). These are the web-facing components where structured logging would help correlate request errors with specific API endpoints. The dashboard module already imports from the same codebase that has the logger available.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] All console.error/warn calls in src/dashboard/server.ts are replaced with logger.child('DashboardServer') calls
- [ ] All console.error/warn calls in src/dashboard/routes/api.ts are replaced with logger.child('DashboardAPI') calls
- [ ] Build passes (`npm run build`) with zero errors
- [ ] All existing tests pass (`npm run test`)
- [ ] No console.log/error/warn calls remain in either file (verified by grep)

#### Next steps
1. Import `logger` from `../../logging/index.js` in both files and create child loggers
2. Replace each console.error with log.error, including the error object as the second argument for stack trace capture
3. Replace the console.warn in api.ts CostTracker fallback with log.warn
4. Run build and test suite to verify no regressions
