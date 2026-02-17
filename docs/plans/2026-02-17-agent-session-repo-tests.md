# AgentSessionRepository Unit Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Achieve ≥80% statement coverage for AgentSessionRepository by adding unit tests for all 11 public methods.

**Architecture:** Single test file using Vitest with mock Supabase client, following the existing pattern from `usage-log.test.ts`. Mock the Supabase chain methods (`from().insert().select().single()` etc.) and test each method's success path, error path, and edge cases.

**Tech Stack:** Vitest, vi.mock/vi.fn, Supabase client mocks, TypeScript with ESM (.js extensions)

**Total Tasks: 7** (4 implementation + 3 verification)

---

### Task 1: Create test file with mock setup and `create()` tests

**Files:**
- Create: `src/db/repositories/agent-sessions.test.ts`
- Reference: `src/db/repositories/usage-log.test.ts` (mock pattern)
- Reference: `src/db/repositories/agent-sessions.ts` (source under test)

**Step 1: Write the test file with mock Supabase client and `create()` tests**

The mock client must support these Supabase chain patterns:
- `from('tc_agent_sessions').insert({...}).select().single()` → for create
- `from('tc_agent_sessions').select('*').eq('id', id).single()` → for getById
- `from('tc_agent_sessions').update({...}).eq('id', id).select().single()` → for update
- `from('tc_agent_sessions').select('*').in('status', [...]).order(...)` → for getActive
- `from('tc_agent_sessions').select('*').eq('field', val).order(...)` → for getByTaskId, getChildren
- `from('tc_agent_sessions').select('status')` → for getStats

The mock needs separate result objects for select vs insert/single operations so different chain paths can return different results.

Write tests for `create()`:
- Creates session with required fields, verifies defaults applied (status='running', depth=0, tokens_used=0, parent_session_id=null)
- Creates session with all optional fields (parent_session_id, depth)
- Throws on insert error with descriptive message

**Step 2: Run test to verify it works**

Run: `npx vitest run src/db/repositories/agent-sessions.test.ts`
Expected: All create tests PASS

**Step 3: Commit**

```bash
git add src/db/repositories/agent-sessions.test.ts
git commit -m "test: add agent-sessions repo tests — create() with mock setup"
```

---

### Task 2: Add `getById()` and `update()` tests

**Files:**
- Modify: `src/db/repositories/agent-sessions.test.ts`

**Step 1: Write tests for `getById()`**

- Returns session when found
- Returns null when PGRST116 error (not found) — the error object has a `code` field
- Throws on other database errors

**Step 2: Write tests for `update()`**

- Updates session with partial fields
- Throws on update error

**Step 3: Run tests**

Run: `npx vitest run src/db/repositories/agent-sessions.test.ts`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/db/repositories/agent-sessions.test.ts
git commit -m "test: add getById and update tests for agent-sessions repo"
```

---

### Task 3: Add lifecycle method tests (`complete`, `fail`, `block`, `unblock`)

**Files:**
- Modify: `src/db/repositories/agent-sessions.test.ts`
- Reference: `src/db/repositories/agent-sessions.ts:100-170` (lifecycle methods)

**Step 1: Write tests for `complete()`**

- Marks session as complete with ended_at timestamp
- Optionally includes tokens_used
- Verify the update payload has `status: 'complete'` and `ended_at` is set

**Step 2: Write tests for `fail()`**

- Marks session as failed with ended_at timestamp
- Optionally includes tokens_used

**Step 3: Write tests for `block()`**

- Sets status='blocked', blocker_sent_at=timestamp
- Optionally includes blocker_reason
- Verify blocker tracking fields are set correctly

**Step 4: Write tests for `unblock()`**

- Sets status='running', blocker_resolved_at=timestamp
- Verify blocker_resolved_at is set

**Step 5: Run tests**

Run: `npx vitest run src/db/repositories/agent-sessions.test.ts`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/db/repositories/agent-sessions.test.ts
git commit -m "test: add lifecycle method tests (complete, fail, block, unblock)"
```

---

### Task 4: Add query method tests (`getActive`, `getByTaskId`, `getChildren`, `getStats`)

**Files:**
- Modify: `src/db/repositories/agent-sessions.test.ts`

**Step 1: Write tests for `getActive()`**

- Returns array of active sessions (status in ['running', 'blocked'])
- Returns empty array when no active sessions (data is null → returns [])
- Throws on query error
- Verifies `.in('status', ['running', 'blocked'])` and `.order('started_at', { ascending: false })`

**Step 2: Write tests for `getByTaskId()`**

- Returns sessions for a given task_id
- Returns empty array when none found
- Throws on error

**Step 3: Write tests for `getChildren()`**

- Returns child sessions for a parent_session_id
- Returns empty array when none found
- Verifies `.order('started_at', { ascending: true })` (ascending, not descending)

**Step 4: Write tests for `getStats()`**

- Returns aggregated counts by status (total, running, blocked, complete, failed)
- Returns zeros when no sessions exist
- Throws on error
- Verify client-side filtering logic works correctly

**Step 5: Run tests**

Run: `npx vitest run src/db/repositories/agent-sessions.test.ts`
Expected: All tests PASS

**Step 6: Run full test suite**

Run: `npm run test`
Expected: All existing + new tests PASS

**Step 7: Check coverage**

Run: `npx vitest run --coverage src/db/repositories/agent-sessions.test.ts`
Expected: ≥80% statement coverage for agent-sessions.ts

**Step 8: Commit**

```bash
git add src/db/repositories/agent-sessions.test.ts
git commit -m "test: add query method tests (getActive, getByTaskId, getChildren, getStats)"
```

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 5: Code Review

**Invoke:** `/code-review`

Review all implementation work for:
- Conventional commits (test: prefix for test-only changes)
- No obvious security issues (OWASP top 10)
- No over-engineering beyond requirements
- Mock patterns match existing codebase conventions
- All 11 methods have coverage

**Expected:** All issues addressed before proceeding.

### Task 6: Feature Testing

Verify the complete test suite:
- Run `npm run test` — all tests pass (existing + new)
- Run `npx vitest run --coverage src/db/repositories/agent-sessions.test.ts` — ≥80% statement coverage
- Verify no test data leaks or side effects between tests (beforeEach resets mocks)

**Expected:** All tests pass with evidence (actual output shown).

### Task 7: Final Commit

After verification passes:
```bash
git status  # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.
