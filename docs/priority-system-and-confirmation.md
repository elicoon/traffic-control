# Priority System Documentation and Confirmation Requirements

**Created:** 2026-01-26
**Status:** Proposal / Documentation

---

## Table of Contents

1. [Current Priority System](#current-priority-system)
2. [How Priority is Used in Scheduling](#how-priority-is-used-in-scheduling)
3. [Task Selection Code Locations](#task-selection-code-locations)
4. [New Requirement: Priority Confirmation](#new-requirement-priority-confirmation)
5. [Implementation Proposal](#implementation-proposal)

---

## Current Priority System

### Priority Field Definition

The `priority` field in `tc_tasks` is an **INTEGER** with the following characteristics:

| Attribute | Value |
|-----------|-------|
| Type | INTEGER |
| Default | 0 |
| Range | Unbounded (no min/max constraint) |
| Direction | **Higher values = Higher priority** |

### Current Understanding

- **Higher numbers indicate more urgent/important tasks**
- **Default is 0** (lowest priority unless negative values are used)
- **No upper limit** - tasks can have priority 1, 50, 100, or any integer
- **Used in PriorityScorer** as part of the urgency calculation where priority 0-10 is scaled to 0-50 points

### Priority Usage in PriorityScorer (src/analytics/priority-scorer.ts)

The `calculateUrgencyScore` function combines:
1. **Age component**: 5 points per day in queue, capped at 50
2. **Priority component**: `(task.priority / 10) * 50` (assumes 0-10 scale, scales to 0-50 points)

This means:
- Priority 0 = 0 urgency points from priority
- Priority 5 = 25 urgency points from priority
- Priority 10 = 50 urgency points from priority
- Priority > 10 = More than 50 points (exceeds expected range)

**Recommended Scale:** 0-10 for consistency with the scoring algorithm, but not enforced.

---

## How Priority is Used in Scheduling

### 1. TaskQueue (src/scheduler/task-queue.ts)

The `TaskQueue` class manages tasks in a priority queue with **age-based boosting**:

```typescript
// Age boost: +0.1 priority per hour waiting
const AGE_BOOST_PER_HOUR = 0.1;

// Effective priority = base priority + (hours in queue * 0.1)
effectivePriority = task.priority + (ageHours * AGE_BOOST_PER_HOUR);
```

**Key behaviors:**
- Tasks are sorted by `effectivePriority` (descending - highest first)
- Older tasks gradually increase in priority to prevent starvation
- A task with priority 0 waiting 10 hours gets effective priority 1.0
- The `dequeue()` method returns the highest effective priority task

### 2. Scheduler (src/scheduler/scheduler.ts)

The `Scheduler` coordinates between the TaskQueue and CapacityTracker:

1. Checks if capacity is available (opus/sonnet)
2. Gets the next task from TaskQueue using `getNextForModel()`
3. Considers model preference (opus vs sonnet) based on `estimated_sessions_*` fields
4. Spawns an agent for the selected task

### 3. Database Queries (src/db/repositories/tasks.ts)

All task queries order by priority descending:

```typescript
// getQueued(), getByProject(), getByStatus(), etc.
.order('priority', { ascending: false })
```

### 4. PriorityScorer (src/analytics/priority-scorer.ts)

Advanced multi-factor scoring system:

| Factor | Weight | Description |
|--------|--------|-------------|
| Impact | 40% | Task complexity (high=100, medium=60, low=30) |
| Urgency | 25% | Age in queue + explicit priority |
| Efficiency | 20% | Historical estimate accuracy |
| Dependency | 15% | Number of tasks this blocks |

**Adjustments:**
- +20 if project has low backlog (< 3 tasks)
- +10 if task is from underutilized project
- -10 if complex task but Opus at capacity

---

## Task Selection Code Locations

| File | Function | Description |
|------|----------|-------------|
| `src/scheduler/task-queue.ts` | `dequeue()` | Returns highest priority task |
| `src/scheduler/task-queue.ts` | `getNextForModel()` | Gets task preferring specific model |
| `src/scheduler/task-queue.ts` | `getSortedTasks()` | Sorts by effective priority |
| `src/scheduler/scheduler.ts` | `scheduleNext()` | Main scheduling decision point |
| `src/db/repositories/tasks.ts` | `getQueued()` | Fetches queued tasks by priority |
| `src/analytics/priority-scorer.ts` | `scoreTasks()` | Advanced multi-factor scoring |
| `src/orchestrator/main-loop.ts` | `tick()` | Triggers scheduling each interval |

---

## New Requirement: Priority Confirmation

### Rationale

To prevent autonomous task execution without user oversight, **all tasks must have their priority explicitly confirmed before scheduling**. This ensures:

1. **User control** over what work gets done next
2. **Priority ordering review** before execution
3. **No surprise task starts** without explicit approval
4. **Opportunity to re-prioritize** new tasks relative to existing backlog

### Requirements

1. **Before any task starts:**
   - User must confirm priority ordering via Slack
   - The system presents the current queue with priorities
   - User approves or adjusts before execution begins

2. **When new tasks are added:**
   - Tasks start with `priority_confirmed = false`
   - System notifies user of new task requiring priority review
   - Task cannot be scheduled until confirmed

3. **No task starts without explicit user approval:**
   - Scheduler checks `priority_confirmed = true` before scheduling
   - Tasks with `priority_confirmed = false` are filtered from queue

---

## Implementation Proposal

### Database Migration

Add a new field to `tc_tasks`:

```sql
-- Migration: add_priority_confirmation_field
ALTER TABLE tc_tasks
ADD COLUMN priority_confirmed BOOLEAN NOT NULL DEFAULT false;

-- Add index for efficient filtering
CREATE INDEX idx_tc_tasks_priority_confirmed ON tc_tasks(priority_confirmed);

-- Optionally: add confirmation metadata
ALTER TABLE tc_tasks
ADD COLUMN priority_confirmed_at TIMESTAMPTZ,
ADD COLUMN priority_confirmed_by TEXT;
```

### Code Changes

#### 1. Task Repository (src/db/repositories/tasks.ts)

```typescript
// Update getQueued() to only return confirmed tasks
async getQueued(): Promise<Task[]> {
  const { data, error } = await this.client
    .from('tc_tasks')
    .select()
    .eq('status', 'queued')
    .eq('priority_confirmed', true)  // NEW: Only confirmed tasks
    .order('priority', { ascending: false });
  // ...
}

// New method to get unconfirmed tasks
async getUnconfirmedTasks(): Promise<Task[]> {
  const { data, error } = await this.client
    .from('tc_tasks')
    .select()
    .eq('status', 'queued')
    .eq('priority_confirmed', false)
    .order('created_at', { ascending: false });
  // ...
}

// New method to confirm task priority
async confirmPriority(id: string, confirmedBy?: string): Promise<Task> {
  const { data, error } = await this.client
    .from('tc_tasks')
    .update({
      priority_confirmed: true,
      priority_confirmed_at: new Date().toISOString(),
      priority_confirmed_by: confirmedBy || 'user',
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();
  // ...
}
```

#### 2. Task Interface Update

```typescript
export interface Task {
  // ... existing fields ...
  priority_confirmed: boolean;
  priority_confirmed_at: string | null;
  priority_confirmed_by: string | null;
}
```

#### 3. Slack Integration

Add new Slack commands/notifications:

```typescript
// New tasks notification
"New task added to backlog: [TITLE]
Priority: [N] | Project: [PROJECT]
To confirm and allow scheduling, reply: /tc confirm [task-id]
To adjust priority first: /tc priority [task-id] [new-priority]"

// Queue review command
"/tc queue review" - Shows all queued tasks sorted by priority
"/tc confirm all" - Confirms all current priorities
"/tc confirm [task-id]" - Confirms single task
```

#### 4. TaskQueue Integration

Update TaskQueue to filter unconfirmed tasks:

```typescript
// Only add confirmed tasks to the queue
enqueue(task: Task): void {
  if (!task.priority_confirmed) {
    log.debug('Task not confirmed, skipping queue', { taskId: task.id });
    return;
  }
  // ... existing logic
}
```

### Alternative: Soft Confirmation via Slack Poll

Instead of blocking scheduling entirely, the system could:

1. Send a Slack message before scheduling: "About to start: [TASK]. Proceed? (react with checkmark to approve, X to block)"
2. Wait for reaction within timeout (e.g., 5 minutes)
3. If approved or no response: proceed
4. If blocked: skip to next task

This provides oversight without requiring proactive confirmation of every task.

---

## Recommended Priority Values

For consistency with the PriorityScorer algorithm:

| Priority | Label | Use Case |
|----------|-------|----------|
| 0 | Default | Standard backlog items |
| 1-3 | Low | Nice-to-have features, maintenance |
| 4-6 | Medium | Regular features, bug fixes |
| 7-9 | High | Important features, critical bugs |
| 10 | Urgent | Blocking issues, critical path |
| 11+ | Emergency | Overrides normal scoring (use sparingly) |

---

## Files to Update for Implementation

1. **Database Migration** (Supabase MCP)
   - Add `priority_confirmed`, `priority_confirmed_at`, `priority_confirmed_by` columns

2. **src/db/repositories/tasks.ts**
   - Update Task interface
   - Modify `getQueued()` to filter by `priority_confirmed`
   - Add `getUnconfirmedTasks()` method
   - Add `confirmPriority()` method

3. **src/db/schema.sql** (documentation)
   - Update schema to reflect new columns

4. **src/scheduler/task-queue.ts**
   - Filter unconfirmed tasks in `enqueue()`

5. **src/slack/command-handler.ts**
   - Add `/tc confirm` command
   - Add `/tc queue review` command

6. **src/slack/notification-manager.ts**
   - Add notification for new unconfirmed tasks
   - Add periodic reminder for pending confirmations

7. **CLAUDE.md**
   - Document the new priority confirmation requirement

---

## Summary

The TrafficControl priority system uses integer values where **higher = more important**. The recommended scale is 0-10 to align with the PriorityScorer algorithm. Tasks are selected by effective priority (base + age boost) to prevent starvation.

The proposed `priority_confirmed` field adds user oversight, ensuring no task starts without explicit approval. This maintains the "bias toward action" principle while giving users control over what work proceeds.

---

## Appendix: Migration SQL

Run this migration via Supabase MCP to add the priority confirmation fields:

```sql
-- Migration: add_priority_confirmation_fields
-- Description: Add priority_confirmed field to ensure user approval before task scheduling

-- Add the main confirmation flag
ALTER TABLE tc_tasks
ADD COLUMN IF NOT EXISTS priority_confirmed BOOLEAN NOT NULL DEFAULT false;

-- Add metadata fields for audit trail
ALTER TABLE tc_tasks
ADD COLUMN IF NOT EXISTS priority_confirmed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS priority_confirmed_by TEXT;

-- Create index for efficient filtering of confirmed tasks
CREATE INDEX IF NOT EXISTS idx_tc_tasks_priority_confirmed
ON tc_tasks(priority_confirmed)
WHERE status = 'queued';

-- Backfill: Optionally confirm existing queued tasks (uncomment if needed)
-- WARNING: Only run this after reviewing existing tasks!
-- UPDATE tc_tasks
-- SET priority_confirmed = true,
--     priority_confirmed_at = now(),
--     priority_confirmed_by = 'migration_backfill'
-- WHERE status = 'queued';

COMMENT ON COLUMN tc_tasks.priority_confirmed IS 'Must be true for task to be scheduled. Ensures user approval of priorities.';
COMMENT ON COLUMN tc_tasks.priority_confirmed_at IS 'Timestamp when priority was confirmed by user';
COMMENT ON COLUMN tc_tasks.priority_confirmed_by IS 'Identifier of who confirmed the priority (user, slack_user_id, etc)';
```

**To apply this migration:**
```
mcp__supabase__apply_migration(
  name: "add_priority_confirmation_fields",
  query: "<the SQL above>"
)
```
