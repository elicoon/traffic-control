# Plan: Add Unit Tests for BacklogItemsRepository

**Created:** 2026-02-17
**Source:** handler dispatch — tc-backlog-items-repo-tests
**Total Tasks:** 6 (3 implementation + 3 verification)

## Goal

Achieve ≥80% statement coverage for `src/db/repositories/backlog-items.ts` by adding comprehensive unit tests using mock Supabase client pattern.

## Research Summary

- **Source file:** `backlog-items.ts` — 328 lines, 10 public methods, 0% coverage
- **Mock pattern:** `agent-sessions.test.ts` uses `createMockClient()` with thenable query chains and `setSingleResult`/`setQueryResult` helpers
- **Public methods to test:**
  1. `create(input)` — insert + select + single chain
  2. `getById(id)` — select + eq + single (handles PGRST116 for not-found)
  3. `list(filter?)` — select with conditional eq/contains + order chain (thenable)
  4. `update(id, input)` — update + eq + select + single chain
  5. `updateStatus(id, status)` — update with conditional `reviewed_at`/`implemented_at` timestamps
  6. `delete(id)` — delete + eq chain (thenable, no single)
  7. `linkProposal(itemId, proposalId)` — getById + update combo
  8. `linkTask(itemId, taskId)` — getById + update combo
  9. `getBySourceFile(sourceFile)` — select + eq + single (handles PGRST116)
  10. `getByStatus/getByPriority/getByType/getByProject/getByTag` — all delegate to `list()`

## Tasks

### Task 1: Create mock Supabase client and test scaffold

Adapt `createMockClient()` from agent-sessions.test.ts for BacklogItemRepository's chains:
- insert().select().single() — for `create`
- select().eq().single() — for `getById`, `getBySourceFile`
- select().eq().contains().order() — for `list` (thenable, not single)
- update().eq().select().single() — for `update`, `updateStatus`
- delete().eq() — for `delete` (thenable)

Create `makeBacklogItem()` helper returning a default `BacklogItem` with overrides.

**File:** `src/db/repositories/backlog-items.test.ts`

### Task 2: Write tests for all public methods

For each method, write:
- **Success path** — returns expected data
- **Error path** — Supabase returns error, method throws with correct message
- **Edge cases** specific to each method

Specific test groups:
- `create`: success with defaults, success with all fields, insert error
- `getById`: found, not found (PGRST116 → null), other error throws
- `list`: no filter, each filter individually (project_id, status, priority, type, tags), multiple tags, error
- `update`: success, error
- `updateStatus`: regular status, `in_review` sets `reviewed_at`, `implemented` sets `implemented_at`, error
- `delete`: success, error
- `linkProposal`: success (appends to existing), item not found throws
- `linkTask`: success (appends to existing), item not found throws
- `getBySourceFile`: found, not found (PGRST116 → null), error
- `getByStatus/getByPriority/getByType/getByProject/getByTag`: verify they delegate to `list` with correct filter

**Target:** ~35-45 tests

### Task 3: Run tests and verify coverage

```bash
npm run test -- src/db/repositories/backlog-items.test.ts
npm run test:coverage -- --reporter=text src/db/repositories/backlog-items.test.ts
```

Verify: all tests pass, ≥80% statement coverage on backlog-items.ts.

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 4: Code Review

Review all implementation work for:
- Mock pattern consistency with agent-sessions.test.ts
- No obvious security issues
- No over-engineering beyond requirements
- All public methods covered

**Expected:** All issues addressed before proceeding.

### Task 5: Run full test suite

```bash
npm run test
```

Verify no regressions — all existing tests still pass.

**Expected:** All tests pass with evidence (actual output shown).

### Task 6: Final Commit

After verification passes:
```bash
git add src/db/repositories/backlog-items.test.ts
git commit -m "test: add unit tests for BacklogItemRepository (≥80% coverage)"
git status
git log --oneline -5
```

Mark task as done only after this step completes successfully.
