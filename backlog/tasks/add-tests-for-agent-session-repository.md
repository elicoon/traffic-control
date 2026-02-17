### Add Unit Tests for AgentSessionRepository CRUD Operations
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** AgentSessionRepository (src/db/repositories/agent-sessions.ts, 284 lines) has 0% test coverage. It handles session creation, status updates, blocker tracking, and depth queries — all critical paths for agent lifecycle management. Other repositories (tasks, projects, proposals, usage-log) already have test files following a consistent mock-Supabase pattern.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Test file exists at `src/db/repositories/agent-sessions.test.ts`
- [ ] Tests cover `create()`, `update()`, `getById()`, `getByTaskId()`, `getActiveSessions()`, and `endSession()` methods
- [ ] Tests verify error handling for Supabase failures (insert errors, update errors, not-found)
- [ ] Tests verify blocker tracking fields (`blocker_reason`, `blocker_sent_at`, `blocker_resolved_at`)
- [ ] All existing tests still pass (`npm run test`)
- [ ] Coverage for agent-sessions.ts reaches ≥80% statements

#### Next steps
1. Read existing repository test files (e.g., `src/db/repositories/tasks.test.ts`) to follow the established mock pattern
2. Create `src/db/repositories/agent-sessions.test.ts` with mock Supabase client
3. Write tests for each public method including success and error paths
4. Run `npm run test` to verify all tests pass
