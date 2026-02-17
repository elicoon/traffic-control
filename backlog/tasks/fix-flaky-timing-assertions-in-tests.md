### Fix Flaky Timing Assertions in delegation-metrics and main-loop Tests
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Two tests use `toBeGreaterThanOrEqual(50)` to assert elapsed time after a `setTimeout(50)` or similar delay. Under load or on slower CI runners, `Date.now()` can return 49ms, causing intermittent failures. The delegation-metrics test at line 247 (`src/orchestrator/delegation-metrics.test.ts`) and the main-loop test at line 440 (`src/orchestrator/main-loop.test.ts`) both exhibit this pattern. The fix should widen the tolerance or use a different assertion strategy (e.g., `toBeGreaterThanOrEqual(40)` or assert within a range).
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] `delegation-metrics.test.ts` line 247 timing assertion no longer fails intermittently (widen threshold to ≥40ms or use range assertion)
- [ ] `main-loop.test.ts` line 440 timing assertion uses same fix pattern
- [ ] Full test suite passes 3 consecutive runs with no flaky failures (`npm test` × 3)

#### Next steps
1. Open `src/orchestrator/delegation-metrics.test.ts` and change `toBeGreaterThanOrEqual(50)` on line 247 to `toBeGreaterThanOrEqual(40)`
2. Open `src/orchestrator/main-loop.test.ts` and apply the same change on line 440
3. Run `npm test` three times to confirm no flaky failures
