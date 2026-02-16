### Persist SpendMonitor Metrics to Database So Budget Tracking Survives Restarts
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** SpendMonitor tracks daily and weekly spend in memory only. When the orchestrator restarts, all spend counters reset to zero — meaning the system loses awareness of how much has been spent and budget alerts don't fire until spend accumulates again from scratch. This is dangerous because a restart mid-day could allow double the daily budget to be spent. The fix should persist spend records to tc_usage_log (which already exists and receives per-session usage data) and reconstruct SpendMonitor state on startup by summing recent usage records.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] SpendMonitor reconstructs daily and weekly spend totals from tc_usage_log records on startup
- [ ] After a simulated restart, SpendMonitor reports the same spend totals as before restart (within rounding tolerance)
- [ ] Budget threshold alerts (50%, 75%, 90%, 100%) fire correctly based on reconstructed totals
- [ ] No duplicate alert firing when spend is reconstructed from history
- [ ] At least 3 tests: startup reconstruction from existing records, empty history starts at zero, budget alert not re-fired for previously-alerted thresholds
- [ ] `npm run build` and `npm test` pass

#### Next steps
1. Read `src/orchestrator/spend-monitor.ts` (or `src/orchestrator/safety/spend-monitor.ts`) to understand current in-memory tracking
2. Read `src/db/repositories/usage-log.ts` to understand the tc_usage_log schema and query capabilities
3. Add a `reconstructFromHistory(since: Date)` method to SpendMonitor that queries tc_usage_log
4. Call `reconstructFromHistory` during MainLoop startup, after DB health check passes
5. Track which alert thresholds have already fired to prevent duplicate notifications
6. Add tests in the spend-monitor test file
7. Run `npm test` and `npm run build` to verify
