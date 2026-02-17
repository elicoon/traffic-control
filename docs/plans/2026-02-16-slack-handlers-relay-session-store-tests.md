# Plan: Unit Tests for Slack Handlers and Relay Session Store

**Created:** 2026-02-16
**Status:** Draft
**Total Tasks:** 5 (2 implementation + 3 verification)

## Summary

Add unit tests for two untested modules:
- `src/slack/handlers.ts` (575 lines) — all Slack command processing
- `src/relay/session-store.ts` (85 lines) — relay session lifecycle

Target: 15+ new tests, test-only changes.

---

## Task 1: Create `src/slack/handlers.test.ts`

**Target:** At least 10 tests covering all exported functions and command routing.

### Functions to test:

1. **Handler setters** (`setMessageHandler`, `setReactionHandler`, `setCommandHandler`, `setProposalActionHandler`, `setProposalListHandler`, `setReportHandler`) — verify callbacks are stored
2. **`resetHandlers()`** — verify all callbacks are cleared
3. **`parseProposalCommand()`** — pure function, most testable:
   - `"approve all"` → `{ action: 'approve', indices: [] }`
   - `"approve 1,2,3"` → `{ action: 'approve', indices: [0,1,2] }`
   - `"reject 2: reason"` → `{ action: 'reject', indices: [1], reason: 'reason' }`
   - Invalid text → `null`
4. **`handleProposalsCommand`** (via setupHandlers → `/tc proposals`):
   - No callback configured → responds with not configured message
   - Empty proposals → responds with "no pending proposals"
   - Proposals found → calls formatProposalBatch
5. **`handleApproveCommand`** (via setupHandlers → `/tc approve`):
   - No callback → responds with not configured
   - No args → responds with usage
   - `approve all` → calls proposalActionCallback with all IDs
   - `approve 1,2` → calls proposalActionCallback with specific IDs
6. **`handleRejectCommand`** (via setupHandlers → `/tc reject`):
   - No callback → responds with not configured
   - No args → responds with usage
   - `reject 2: reason` → calls proposalActionCallback with reject
   - Invalid index → responds with error
7. **`handleReportCommand`** (via setupHandlers → `/tc report`):
   - No callback → responds with not configured
   - Callback throws → responds with error
8. **Default command handling** (`/tc status`, `/tc help`, `/tc pause`, `/tc resume`, `/tc add`)

### Mock strategy:
- `vi.mock('./bot.js')` to mock `createSlackBot` (return object with `.message()`, `.command()`, `.event()` stubs)
- `vi.mock('../logging/index.js')` to silence logs
- Capture handler registrations from `app.message()`, `app.command()`, `app.event()` to invoke them directly

## Task 2: Create `src/relay/session-store.test.ts`

**Target:** At least 8 tests covering the `SessionStore` class.

### Methods to test:
1. **`set()` + `get()`** — store and retrieve session ID
2. **`get()` for missing key** — returns undefined
3. **`has()`** — returns true/false correctly
4. **`delete()`** — removes mapping, returns true; returns false for missing
5. **`clear()`** — removes all mappings
6. **`size()`** — returns correct count
7. **`threads()`** — returns all stored thread timestamps
8. **Multiple sessions** — concurrent independent sessions
9. **Overwrite** — setting same key overwrites value

### Mock strategy:
- No mocks needed — `SessionStore` is a pure in-memory class with no external dependencies.

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 3: Code Review

**Invoke:** `/code-review`

Review all implementation work for:
- Conventional commits (feat/fix/docs/chore prefixes)
- No obvious security issues (OWASP top 10)
- No over-engineering beyond requirements
- Documentation updated where needed

**Expected:** All issues addressed before proceeding.

### Task 4: Feature Testing

Run `npm test` and verify:
- All new tests pass
- No existing tests broken
- Total test count increased by 15+

**Expected:** All tests pass with evidence (actual output shown).

### Task 5: Final Commit

After verification passes:
```bash
git status  # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.
