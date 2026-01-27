# Logging Implementation Plan

**Task ID:** 88a08cbc-7a20-4430-9124-795cd7a0329d
**Status:** In Progress
**Created:** 2026-01-26

---

## Overview

Implement comprehensive structured logging throughout TrafficControl to improve debuggability and reduce time-to-resolution for issues.

## Current State Analysis

- **Existing Logger**: `src/cli/logger.ts` provides a well-designed foundation with levels, JSON output, and child loggers
- **Current Pattern**: Inconsistent mix of `console.log()` calls and custom Logger usage
- **Gaps**: DB layer, scheduler, and dashboard have minimal/no logging
- **Opportunity**: EventBus can be leveraged for centralized log correlation

## Architecture Decision

**Approach: Extend Existing Custom Logger**

Rationale:
1. `src/cli/logger.ts` already has the core features needed (levels, JSON, child loggers)
2. Zero new dependencies
3. Full control over implementation
4. Already familiar to the codebase

### Logger Enhancements Required

1. **Correlation ID support** - Trace requests across components
2. **Component tagging** - Auto-prefix logs with component name
3. **Performance metrics** - Optional timing for operations
4. **Redaction** - Auto-redact sensitive fields (tokens, keys)
5. **Global singleton** - Single logger instance for consistency

---

## Implementation Phases

### Phase 1: Logger Infrastructure (BLOCKING)

**Files to Create/Modify:**
- `src/logging/logger.ts` - New centralized logger module
- `src/logging/redaction.ts` - Sensitive data redaction
- `src/logging/correlation.ts` - Correlation ID management
- `src/logging/index.ts` - Public exports

**Features:**
```typescript
interface Logger {
  info(message: string, meta?: object): void;
  warn(message: string, meta?: object): void;
  error(message: string, meta?: object): void;
  debug(message: string, meta?: object): void;

  // Create child logger with component context
  child(component: string): Logger;

  // Correlation ID management
  withCorrelationId(id: string): Logger;

  // Performance timing
  time(label: string): void;
  timeEnd(label: string): void;
}
```

**Configuration:**
- `TC_LOG_LEVEL` - DEBUG, INFO, WARN, ERROR
- `TC_LOG_FORMAT` - json, pretty
- `TC_LOG_REDACT` - Comma-separated fields to redact

---

### Phase 2: Component Logging (PARALLELIZABLE)

Each component can be updated independently after Phase 1 completes.

#### 2A: Orchestrator Logging
**Files:**
- `src/orchestrator/main-loop.ts`
- `src/orchestrator/state-manager.ts`
- `src/orchestrator/event-dispatcher.ts`
- `src/orchestrator/context-budget-manager.ts`

**Log Events:**
- State transitions (INFO)
- Delegation decisions with reasoning (INFO)
- Capacity calculations (DEBUG)
- Errors and recovery attempts (ERROR/WARN)

#### 2B: Agent Manager Logging
**Files:**
- `src/agent/manager.ts`
- `src/agent/sdk-adapter.ts`
- `src/agent/subagent-tracker.ts`

**Log Events:**
- Agent spawn (INFO)
- Agent complete/fail/timeout (INFO/ERROR)
- Subagent hierarchy changes (DEBUG)
- Session state transitions (DEBUG)

#### 2C: Slack Integration Logging
**Files:**
- `src/slack/bot.ts`
- `src/slack/handlers.ts`
- `src/slack/notification-manager.ts`
- `src/slack/router.ts`

**Log Events:**
- Message routing decisions (DEBUG)
- Thread tracking updates (DEBUG)
- Retry attempts with backoff info (WARN)
- API response times (DEBUG)
- Connection state changes (INFO)

#### 2D: Database Layer Logging
**Files:**
- `src/db/client.ts`
- `src/db/repositories/*.ts`

**Log Events:**
- Query execution times (DEBUG)
- Connection health changes (INFO/WARN)
- Retry attempts (WARN)
- Failed queries (ERROR)

#### 2E: Scheduler Logging
**Files:**
- `src/scheduler/scheduler.ts`
- `src/scheduler/capacity-tracker.ts`
- `src/scheduler/task-queue.ts`

**Log Events:**
- Task queue operations (DEBUG)
- Capacity decisions (INFO)
- Assignment logic (DEBUG)

#### 2F: Event Bus Logging
**Files:**
- `src/events/event-bus.ts`
- `src/events/event-logger.ts`

**Log Events:**
- All emitted events with timestamps (DEBUG)
- Event handler errors (ERROR)

---

### Phase 3: Integration & Documentation

**Tasks:**
- Update `CLAUDE.md` with logging configuration
- Add logging section to README
- Update `.env.example` with logging env vars
- Add log level per-component config option

---

## Acceptance Criteria Mapping

| Criteria | Implementation |
|----------|----------------|
| All major components have structured logging | Phases 2A-2F |
| Correlation IDs trace across boundaries | Phase 1 correlation module |
| Log levels correctly categorized | Logger interface with level methods |
| Sensitive data properly redacted | Phase 1 redaction module |
| Documentation updated | Phase 3 |
| No significant performance regression | Async logging, lazy evaluation |

---

## Task Breakdown for Parallel Execution

### Task 1: Logger Infrastructure (MUST COMPLETE FIRST)
Create the logging module with:
- Centralized logger singleton
- Child logger factory
- Correlation ID support
- Redaction utilities
- Environment configuration

### Task 2-7: Component Logging (PARALLEL AFTER TASK 1)
Each task updates one component to use the new logger:
- Task 2: Orchestrator
- Task 3: Agent Manager
- Task 4: Slack Integration
- Task 5: Database Layer
- Task 6: Scheduler
- Task 7: Event Bus

### Task 8: Tests & Documentation
- Add unit tests for logger module
- Update documentation
- Verify all acceptance criteria

---

## File Structure

```
src/
├── logging/
│   ├── index.ts           # Public exports
│   ├── logger.ts          # Core logger implementation
│   ├── redaction.ts       # Sensitive data redaction
│   ├── correlation.ts     # Correlation ID management
│   └── types.ts           # Type definitions
```

---

## Risk Mitigation

1. **Performance Impact**: Use lazy evaluation for debug logs
2. **Breaking Changes**: Gradual migration, keep console.log working initially
3. **Missing Logs**: Add integration test to verify critical paths are logged
