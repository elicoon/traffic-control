# Implementation Plan: DatabaseHealthMonitor Unit Tests

**Created:** 2026-02-17
**Target Coverage:** ≥80% statements for database-health-monitor.ts
**Test Framework:** Vitest with @vitest/coverage-v8

---

## Overview

Add comprehensive unit tests for DatabaseHealthMonitor to achieve ≥80% coverage. The class manages health tracking, degraded mode transitions, and recovery logic for database resilience.

## Current State

- **Existing coverage:** 33% (195 lines uncovered)
- **Source file:** `src/orchestrator/database-health-monitor.ts` (234 lines)
- **Reference tests:** `src/db/client.test.ts` shows mocking patterns

## Test Coverage Requirements

### Public API Methods to Test
1. `constructor()` - Initialization with config and eventBus
2. `isDegraded()` - Returns degraded state
3. `getStats()` - Returns health statistics
4. `validateOnStartup()` - Startup validation with retry
5. `recordStartupHealthy()` - Records successful startup
6. `isDbError()` - Detects database-related errors
7. `onDbFailure()` - Handles failures, enters degraded mode
8. `onDbSuccess()` - Handles success, exits degraded mode
9. `attemptDbRecovery()` - Recovery attempts
10. `reset()` - Resets state

### Private Methods (tested indirectly)
- `enterDegradedMode()` - Via onDbFailure
- `exitDegradedMode()` - Via onDbSuccess
- `emitDatabaseEvent()` - Via event emission tests

---

## Tasks

### Task 1: Set Up Test File Structure

**File:** `src/orchestrator/database-health-monitor.test.ts`

Create test file with:
- Vitest imports (`describe`, `it`, `expect`, `beforeEach`, `vi`)
- Mock setup for EventBus
- Mock setup for db/client functions (`checkHealth`, `waitForHealthy`)
- Test fixtures for config and eventBus
- Helper to create monitor instances

**Acceptance:**
- Test file exists and imports compile
- Mock infrastructure ready

---

### Task 2: Test Constructor and Basic State

**Test Suite:** `DatabaseHealthMonitor - Constructor and State`

Tests:
1. Initializes with config and eventBus
2. Starts in healthy state (isDegraded returns false)
3. Starts with zero consecutive failures
4. getStats returns correct initial state

**Acceptance:**
- 4 tests passing
- Constructor coverage complete

---

### Task 3: Test Failure Tracking

**Test Suite:** `DatabaseHealthMonitor - Failure Tracking`

Tests:
1. `onDbFailure()` increments consecutive failure counter
2. `onDbFailure()` stores last error message
3. `onDbFailure()` does NOT enter degraded mode before threshold
4. `onDbFailure()` DOES enter degraded mode at threshold (config.maxConsecutiveDbFailures)
5. `onDbSuccess()` resets consecutive failures to 0
6. `onDbSuccess()` clears last error

**Acceptance:**
- 6 tests passing
- Failure counter logic fully covered

---

### Task 4: Test Degraded Mode Transitions

**Test Suite:** `DatabaseHealthMonitor - Degraded Mode`

Tests:
1. Enters degraded mode after N consecutive failures (use config.maxConsecutiveDbFailures = 3)
2. isDegraded returns true after entering degraded mode
3. Emits `database:degraded` event when entering degraded mode
4. Exits degraded mode on first success after degraded
5. Emits `database:recovered` event when exiting degraded mode
6. Does not re-emit `database:degraded` if already degraded

**Acceptance:**
- 6 tests passing
- Degraded mode state machine fully covered
- Event emissions verified with mock assertions

---

### Task 5: Test Event Emissions

**Test Suite:** `DatabaseHealthMonitor - Event Emissions`

Tests:
1. `recordStartupHealthy()` emits `database:healthy` with latencyMs
2. Degraded mode entry emits `database:degraded` with error, lastHealthyAt, retryCount
3. Recovery emits `database:recovered` with latencyMs, downtimeMs
4. No events emitted if eventBus is null
5. Events contain correct payload structure

**Acceptance:**
- 5 tests passing
- All event emission paths covered
- Null eventBus handling verified

---

### Task 6: Test Database Error Detection

**Test Suite:** `DatabaseHealthMonitor - Error Detection`

Tests for `isDbError()`:
1. Returns true for Error with "supabase" in message
2. Returns true for Error with "database" in message
3. Returns true for Error with "connection" in message
4. Returns true for Error with "network" in message
5. Returns true for Error with "timeout" in message
6. Returns true for Error with "ECONNREFUSED" in message
7. Returns true for Error with "ENOTFOUND" in message
8. Returns false for non-database errors
9. Returns false for non-Error objects

**Acceptance:**
- 9 tests passing
- All error detection branches covered

---

### Task 7: Test Recovery Logic

**Test Suite:** `DatabaseHealthMonitor - Recovery`

Tests:
1. `attemptDbRecovery()` calls checkHealth
2. Successful recovery resets consecutiveFailures
3. Successful recovery clears lastError
4. Successful recovery sets lastDbHealthyAt
5. Successful recovery exits degraded mode
6. Successful recovery emits `database:recovered`
7. Failed recovery keeps degraded mode active
8. `reset()` clears degraded state
9. `reset()` resets consecutive failures

**Acceptance:**
- 9 tests passing
- Recovery paths fully covered

---

### Task 8: Test Startup Validation

**Test Suite:** `DatabaseHealthMonitor - Startup Validation`

Tests:
1. `validateOnStartup()` calls waitForHealthy with correct retry config
2. `validateOnStartup()` passes retry callback that logs warnings
3. `recordStartupHealthy()` sets lastDbHealthyAt
4. `recordStartupHealthy()` emits database:healthy event

**Acceptance:**
- 4 tests passing
- Startup flow covered

---

### Task 9: Test getStats() Method

**Test Suite:** `DatabaseHealthMonitor - Statistics`

Tests:
1. getStats returns healthy=true initially
2. getStats returns healthy=false when degraded
3. getStats returns correct consecutiveFailures count
4. getStats returns lastHealthyAt after success
5. getStats returns lastError after failure
6. getStats converts null lastHealthyAt to undefined
7. getStats converts null lastError to undefined

**Acceptance:**
- 7 tests passing
- All stats fields covered

---

### Task 10: Verify Coverage and Fix Gaps

**Actions:**
1. Run `npm run test:coverage` and check database-health-monitor.ts coverage
2. Identify any uncovered lines
3. Add targeted tests for missing coverage
4. Re-run coverage until ≥80% achieved

**Acceptance:**
- Coverage report shows ≥80% statements for database-health-monitor.ts
- No critical logic paths left uncovered

---

### Task 11: Run Full Test Suite

**Actions:**
1. Run `npm run test` to execute all tests
2. Verify all new tests pass
3. Verify no regressions in existing tests
4. Check for any test warnings or deprecations

**Acceptance:**
- All tests pass (expected: 1683 + new tests)
- No test failures or regressions
- Clean test output

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 12: Code Review

**Invoke:** `/code-review`

Review all implementation work for:
- Test quality and comprehensiveness
- Proper use of mocks and test isolation
- No over-engineering beyond requirements
- Clear test names and assertions
- Follows existing test patterns from client.test.ts

**Expected:** All issues addressed before proceeding.

---

### Task 13: Feature Testing

**Invoke:** `/test-feature DatabaseHealthMonitor Unit Tests`

Verify:
- All test suites run successfully
- Coverage target achieved (≥80%)
- Tests are deterministic (run multiple times)
- Mock cleanup happens properly (no test pollution)

**Expected:** All verification passes with evidence (test output shown).

---

### Task 14: Final Commit

After verification passes:
```bash
git status  # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.

---

## Mock Patterns to Use

Based on `src/db/client.test.ts`:

### EventBus Mock
```typescript
const mockEventBus = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};
```

### Database Client Mocks
```typescript
vi.mock('../db/client.js', () => ({
  checkHealth: vi.fn(),
  waitForHealthy: vi.fn(),
}));
```

### Reset Between Tests
```typescript
beforeEach(() => {
  vi.clearAllMocks();
});
```

---

## Total Tasks: 14

**Estimated time:** 60-90 minutes
**Risk areas:** Event emission timing, degraded mode state transitions
**Success criteria:** ≥80% coverage + all tests green + code review passed
