### Add Unit Tests for AgentSessionRepository CRUD Operations
- **Project:** traffic-control
- **Status:** done
- **Priority:** high
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** AgentSessionRepository (src/db/repositories/agent-sessions.ts, 284 lines) has 0% test coverage. It handles session creation, status updates, blocker tracking, and depth queries — all critical paths for agent lifecycle management. Other repositories (tasks, projects, proposals, usage-log) already have test files following a consistent mock-Supabase pattern.
- **Added:** 2026-02-16
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [x] Test file exists at `src/db/repositories/agent-sessions.test.ts`
- [x] Tests cover `create()`, `update()`, `getById()`, `getByTaskId()`, `getActiveSessions()`, and `endSession()` methods
- [x] Tests verify error handling for Supabase failures (insert errors, update errors, not-found)
- [x] Tests verify blocker tracking fields (`blocker_reason`, `blocker_sent_at`, `blocker_resolved_at`)
- [x] All existing tests still pass (`npm run test`)
- [x] Coverage for agent-sessions.ts reaches ≥80% statements

#### Completion Notes
- 35 tests across 11 describe blocks covering all public methods
- 100% statement/branch/function/line coverage
- Code review passed (chain argument assertions added per reviewer recommendation)
- Commit: `cd700a5`
