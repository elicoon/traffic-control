### Replace console.log/console.error with Structured Logger in Reporter Module
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The Reporter module (src/reporter/reporter.ts, metrics-collector.ts, recommendation-engine.ts) uses console.log and console.error for logging instead of the project's structured logging system (src/logging/). Every other module in the codebase uses `logger.child('ComponentName')` for structured, level-aware, redaction-capable logging. The reporter is the only module still using raw console output, which means its logs lack correlation IDs, can't be filtered by level, and don't benefit from automatic secret redaction. This is a straightforward find-and-replace refactor.
- **Added:** 2026-02-14
- **Updated:** 2026-02-14

#### Acceptance Criteria
- [ ] No `console.log` or `console.error` calls remain in src/reporter/*.ts files
- [ ] All logging uses `logger.child('Reporter')`, `logger.child('MetricsCollector')`, `logger.child('RecommendationEngine')` respectively
- [ ] Log levels are appropriate: info for normal operations, warn for skipped projects, error for failures
- [ ] Existing reporter tests still pass (`npm test`)

#### Next steps
1. Read `src/reporter/reporter.ts`, `src/reporter/metrics-collector.ts`, and `src/reporter/recommendation-engine.ts` to locate all console.log/console.error calls
2. Import `logger` from `../logging/index.js` in each file
3. Create component-scoped loggers (`const log = logger.child('Reporter')` etc.)
4. Replace each console.log with appropriate log.info/log.warn/log.error
5. Run `npm test` to verify no regressions
