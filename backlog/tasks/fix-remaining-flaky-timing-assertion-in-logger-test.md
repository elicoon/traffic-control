### Fix Remaining Flaky Timing Assertion in Logger Test
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The fix-flaky-timing-assertions task (commit 711fd2f) widened assertions in orchestrator tests but missed src/logging/logger.test.ts line 156. That test uses `setTimeout(resolve, 10)` then asserts `>=10ms`, which flakes under load (observed 9ms). Same pattern as the fixed tests — needs the same tolerance widening. This is the only remaining test failure in the suite (2105/2107 passing).
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] `src/logging/logger.test.ts` timing assertion at line 156 uses `>=5` instead of `>=10` (matching the tolerance pattern from commit 711fd2f)
- [ ] `npm run test` passes with 0 failures across 3 consecutive runs

#### Next steps
1. Edit `src/logging/logger.test.ts` lines 156 and 161 to change `toBeGreaterThanOrEqual(10)` to `toBeGreaterThanOrEqual(5)`
2. Run `npm run test` three times to confirm stability
