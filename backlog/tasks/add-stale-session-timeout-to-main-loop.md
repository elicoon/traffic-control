### Add Stale Session Timeout to Terminate Stuck Agent Sessions
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Agent sessions stuck in "assigned" or "in_progress" status with no activity accumulate indefinitely — there is no timeout or cleanup mechanism. This leaks capacity slots in CapacityTracker, preventing new work from being scheduled. The MainLoop tick should check for sessions older than a configurable threshold (default 6 hours) and mark them as failed with a "stale_timeout" reason, releasing their capacity slot. The architectural scan found this is one of the key resilience gaps.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] MainLoop tick checks for agent sessions with `status = 'in_progress'` or `status = 'assigned'` and `updated_at` older than the timeout threshold
- [ ] Stale sessions are marked as `status = 'failed'` with error reason "stale_timeout" in the database
- [ ] CapacityTracker releases the capacity slot for timed-out sessions
- [ ] Timeout threshold is configurable (default: 6 hours) via OrchestrationConfig
- [ ] At least 3 tests: session within threshold not affected, session past threshold marked failed, capacity released after timeout
- [ ] `npm run build` and `npm test` pass

#### Next steps
1. Read `src/orchestrator/main-loop.ts` tick method to identify where to add the stale check
2. Read `src/agent/manager.ts` to understand how sessions are tracked and how to query for stale ones
3. Add `staleSessionTimeoutMs` to OrchestrationConfig with a 6-hour default
4. Add a `cleanupStaleSessions()` method to MainLoop that queries and terminates stale sessions
5. Call `cleanupStaleSessions()` at the end of each tick cycle
6. Add tests in `src/orchestrator/main-loop.test.ts`
7. Run `npm test` and `npm run build` to verify
