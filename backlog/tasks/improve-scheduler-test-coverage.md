### Improve Scheduler Unit Test Coverage to 80%+
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The Scheduler (src/scheduler/scheduler.ts) is a core component that coordinates task assignment, capacity tracking, and agent session management. It currently has 75.51% statement coverage and 66.66% branch coverage, with uncovered lines at 239, 245, 360-367. These gaps likely include error handling paths, edge cases in task assignment logic, and capacity limit enforcement. Higher coverage would improve confidence in the orchestrator's ability to correctly manage concurrent agents and respect session limits.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Additional tests added to `src/scheduler/scheduler.test.ts` (file already exists)
- [ ] Tests cover error handling when task assignment fails
- [ ] Tests cover capacity limit enforcement (Opus and Sonnet session limits)
- [ ] Tests verify behavior when no tasks are available in queue
- [ ] Tests verify correct agent session lifecycle management
- [ ] Statement coverage for scheduler.ts reaches ≥80%
- [ ] Branch coverage for scheduler.ts reaches ≥70%
- [ ] All existing tests still pass (`npm run test`)

#### Next steps
1. Run `npm run test:coverage -- src/scheduler/scheduler.test.ts` to see current coverage report
2. Read `src/scheduler/scheduler.ts` lines 239, 245, 360-367 (uncovered per coverage report)
3. Identify untested branches in assignNextTask and capacity checking logic
4. Add tests for edge cases (capacity at limit, task queue empty, assignment failure)
5. Add tests for concurrent session tracking and cleanup
6. Run `npm run test:coverage` to verify coverage targets met
