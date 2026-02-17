### Replace console.log with Structured Logger in Entry Point (index.ts)
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** src/index.ts has 3 console.log/error calls (startup message, shutdown handler, fatal error). The project has been systematically migrating all console calls to the structured logger — dashboard, reporter, and other modules are already done. This is the last easy module to migrate, completing the entry-point logging chain.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] All 3 `console.log`/`console.error` calls in `src/index.ts` replaced with `logger.info`/`logger.error`
- [ ] Logger import added from `./logging/index.js`
- [ ] Component logger created: `const log = logger.child('Main')`
- [ ] Build passes (`npm run build`)
- [ ] All tests pass (`npm run test`)

#### Next steps
1. Read `src/index.ts` to see current console calls
2. Import logger and create component logger
3. Replace `console.log('TrafficControl Phase 1...')` with `log.info('TrafficControl starting...')`
4. Replace `console.log('\nShutting down...')` with `log.info('Shutting down')`
5. Replace `console.error('Fatal error:', err)` with `log.error('Fatal error', err)`
6. Verify build and tests pass
