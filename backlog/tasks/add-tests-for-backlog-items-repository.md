### Add Unit Tests for BacklogItemsRepository CRUD Operations
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** BacklogItemsRepository (src/db/repositories/backlog-items.ts, 328 lines) has 0% test coverage. It manages backlog item queries, status transitions, priority updates, and tag filtering — core operations for the task automation pipeline. Other repositories in the same directory already have comprehensive test files using mock Supabase clients.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Test file exists at `src/db/repositories/backlog-items.test.ts`
- [ ] Tests cover all public methods: CRUD operations, status transitions, priority queries, and tag filtering
- [ ] Tests verify error handling for Supabase failures (insert, update, query errors)
- [ ] Tests verify filtering by project_id, status, and priority_confirmed fields
- [ ] All existing tests still pass (`npm run test`)
- [ ] Coverage for backlog-items.ts reaches ≥80% statements

#### Next steps
1. Read `src/db/repositories/backlog-items.ts` to catalog all public methods
2. Read existing test files (e.g., `src/db/repositories/tasks.test.ts`) to follow the established mock pattern
3. Create `src/db/repositories/backlog-items.test.ts` with mock Supabase client
4. Run `npm run test` to verify all tests pass
