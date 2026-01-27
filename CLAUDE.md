# TrafficControl - CLAUDE.md

> **WARNING: $50+ COST INCIDENT (2026-01-27)**
>
> This system burned $40+ in API credits in under 2 minutes due to missing safeguards.
> Before starting ANY agents, you MUST read and follow the **Critical Safety Requirements**
> and **Pre-Launch Checklist** sections below. NO EXCEPTIONS.
>
> Full incident details: `learnings/2026-01-27-api-cost-burn-incident.md`
> Retrospective: `retrospectives/2026-01-27-expensive-lesson-api-cost-burn.md`

---

## Critical Safety Requirements

These rules are MANDATORY. Violating them can result in significant financial loss.

### NEVER Do These Things
1. **NEVER start agents without Slack confirmation** - Always notify the user via Slack and wait for explicit "yes" or "go ahead" before spawning any agent
2. **NEVER say "done" without query verification** - Always run a database query and show the results before claiming any operation is complete
3. **NEVER use high capacity limits** - Default to 1 Opus, 2 Sonnet maximum. Never increase without explicit user approval
4. **NEVER leave test data in the queue** - Clean test data after EVERY test run. Query to verify before production use
5. **NEVER skip the pre-launch checklist** - Every section must be completed with evidence

### ALWAYS Do These Things
1. **ALWAYS verify database state before operations** - Run queries to check task count, types, and status before any launch
2. **ALWAYS show cost estimates before starting** - Calculate and display estimated costs, get user confirmation if > $5
3. **ALWAYS confirm priorities with user** - Task priorities must be explicitly confirmed before work begins
4. **ALWAYS start with minimal capacity** - Begin with 1 agent, scale up only after validation
5. **ALWAYS have a rollback plan** - Know how to stop agents and revert state before starting

### Default Capacity Limits (SAFE DEFAULTS)
```
OPUS_SESSION_LIMIT=1      # Maximum 1 Opus agent
SONNET_SESSION_LIMIT=2    # Maximum 2 Sonnet agents
maxConcurrentAgents=2     # Total concurrent agent limit
```

These are intentionally low. Only increase with explicit user confirmation and clear justification.

---

## Pre-Launch Checklist

**MANDATORY before starting TrafficControl in any capacity-spending mode.**

You must complete EVERY item and show evidence (query results, not just claims).

### 1. Query Database for Task Count and Types
```sql
-- Run this and show the results
SELECT COUNT(*) as total, status FROM tc_tasks GROUP BY status;
SELECT title, priority, priority_confirmed, status FROM tc_tasks WHERE status = 'queued' ORDER BY priority DESC LIMIT 20;
```
**Required:** Show the actual query output. Do not proceed if you cannot run these queries.

### 1b. Verify All Scheduled Tasks Have Confirmed Priorities
```sql
-- Run this to check for unconfirmed tasks that might be scheduled
SELECT id, title, priority FROM tc_tasks
WHERE status = 'queued' AND (priority_confirmed IS NULL OR priority_confirmed = false);
```
**Required:** This query must return 0 rows. If unconfirmed tasks exist, they must be confirmed before proceeding:
```sql
-- Confirm task priorities (only after user reviews the queue)
UPDATE tc_tasks SET priority_confirmed = true WHERE id IN ('<task_ids_to_confirm>');
```

### 2. Verify No Test Data in Queue
```sql
-- Check for test data patterns
SELECT id, title FROM tc_tasks
WHERE status = 'queued'
AND (title ILIKE '%test%' OR title ILIKE '%sample%' OR title ILIKE '%example%' OR title ILIKE '%placeholder%');
```
**Required:** This query must return 0 rows. If test data exists, clean it first:
```sql
DELETE FROM tc_tasks WHERE title ILIKE '%test%' OR title ILIKE '%sample%';
```

### 3. Confirm Priorities with User via Slack
- Send a message to Slack listing the top 5 tasks by priority
- Wait for user to respond with confirmation
- Do NOT proceed without explicit "yes" or equivalent

### 4. Show Cost Estimate
Calculate and display:
- Number of queued tasks
- Estimated Opus sessions required
- Estimated Sonnet sessions required
- **Total estimated cost in USD**

Example output:
```
Cost Estimate:
- Queued tasks: 5
- Opus sessions: 2 ($6.00 estimated)
- Sonnet sessions: 3 ($1.50 estimated)
- TOTAL: $7.50

Proceed? (requires explicit user confirmation)
```

### 5. Get Explicit User Confirmation
**Required:** Wait for one of these exact confirmations:
- "yes"
- "go ahead"
- "confirmed"
- "proceed"

Do NOT interpret other responses as approval. When in doubt, ask again.

### 6. Start with Minimal Capacity
Even after confirmation:
- Start with 1 agent only
- Wait for first task completion
- Verify costs are as expected
- Only then consider scaling up (with user permission)

---

## Overview

TrafficControl is an orchestration system for managing multiple Claude Code agents across concurrent projects. The goal is to maximize Claude usage capacity (100% utilization of session and weekly limits) while minimizing manual intervention.

**Current Status:** Phase 5 complete. Core orchestration, Slack integration (connected to `#all-traffic-control`), and resilience features implemented.

## Interaction Methods

Currently TrafficControl can be interacted with via:
- **Slack** - Primary interface for notifications, questions, and commands
- **Supabase MCP** - Direct database queries from Claude Code sessions
- **CLI** (planned) - Terminal interface for Claude Code sessions

## Project Structure

```
traffic-control/
├── src/
│   ├── agent/           # Agent lifecycle management & SDK adapter
│   ├── backlog/         # Backlog monitoring & proposal generation
│   ├── cli/             # CLI commands and configuration
│   ├── dashboard/       # Web dashboard (Express server)
│   ├── db/              # Supabase client & repositories
│   ├── events/          # Event bus and event types
│   ├── learning/        # Retrospectives & learning storage
│   ├── logging/         # Structured logging with correlation IDs
│   ├── orchestrator/    # Main loop, state manager, delegation
│   ├── reporter/        # Metrics collection & Slack reports
│   ├── scheduler/       # Task queue & capacity tracking
│   └── slack/           # Slack bot, router, notifications
├── docs/
│   ├── backlog/         # Backlog item proposals (markdown)
│   └── plans/           # Implementation plans
├── learnings/           # Project learnings storage
├── CLAUDE.md            # This file
├── agents.md            # Agent behavior guidelines
├── CAPABILITIES.md      # Tools & skills reference
└── traffic-control.md    # Core philosophy & principles
```

## Database (Supabase)

All data is stored in Supabase. Tables are prefixed with `tc_`:

| Table | Description |
|-------|-------------|
| `tc_projects` | Projects being managed |
| `tc_tasks` | Tasks in the backlog |
| `tc_proposals` | Proposed tasks awaiting approval |
| `tc_agent_sessions` | Agent session tracking |
| `tc_usage_log` | Token usage logging |
| `tc_interventions` | Human intervention tracking |
| `tc_budgets` | Project budget allocations |
| `tc_calibration_factors` | Estimation calibration data |
| `tc_estimates_history` | Historical estimate tracking |
| `tc_model_pricing` | Model pricing configuration |
| `tc_retrospectives` | Learning retrospectives |
| `tc_visual_reviews` | Visual review tracking |

## Key Project IDs

| Project | ID |
|---------|-----|
| TrafficControl Internal | `4d854ae0-4d64-4c0c-a571-8bcffa10860a` |
| TrafficControl Infrastructure | `67f785f8-a9df-41eb-a9c9-0a01b434b705` |

---

## Adding Backlog Items

There are **three ways** to add backlog items:

### Option 1: Add a Task Directly to the Database (Quick)

Use the Supabase MCP to insert directly into `tc_tasks`:

```sql
INSERT INTO tc_tasks (
  project_id,
  title,
  description,
  priority,
  status,
  source,
  tags,
  acceptance_criteria,
  estimated_sessions_opus,
  estimated_sessions_sonnet
) VALUES (
  '4d854ae0-4d64-4c0c-a571-8bcffa10860a',  -- TrafficControl Internal project
  'Your task title',
  'Detailed description of what needs to be done',
  50,           -- Priority (higher = more urgent, default 0)
  'queued',     -- Status: queued, assigned, in_progress, review, complete, blocked
  'user',       -- Source: user, agent_proposal, decomposition
  '["tag1", "tag2"]'::jsonb,
  'Clear acceptance criteria',
  1,            -- Estimated Opus sessions
  2             -- Estimated Sonnet sessions
);
```

**Minimal version (required fields only):**
```sql
INSERT INTO tc_tasks (project_id, title, description)
VALUES (
  '4d854ae0-4d64-4c0c-a571-8bcffa10860a',
  'Task title',
  'Task description'
);
```

### Option 2: Create a Proposal (For Review)

For items that need user approval before becoming tasks, create a proposal:

```sql
INSERT INTO tc_proposals (
  project_id,
  title,
  description,
  impact_score,
  estimated_sessions_opus,
  estimated_sessions_sonnet,
  reasoning
) VALUES (
  '4d854ae0-4d64-4c0c-a571-8bcffa10860a',
  'Proposed feature title',
  'What this feature does and why',
  'high',       -- Impact: high, medium, low
  2,            -- Estimated Opus sessions
  3,            -- Estimated Sonnet sessions
  'Why this should be prioritized'
);
```

### Option 3: Document in docs/backlog/ (For Complex Items)

For complex features that need detailed planning, create a markdown file in `docs/backlog/`:

```markdown
# Backlog Item: [Feature Name]

**Priority:** High/Medium/Low
**Type:** Feature/Bug/Architecture Improvement
**Status:** Proposed
**Created:** YYYY-MM-DD

---

## Problem Statement
[What problem does this solve?]

## Proposed Solution
[How should it be implemented?]

## Implementation Phases
[Break down into phases if complex]

## Success Metrics
[How do we know it's done?]

## Related Files
[Links to relevant code]
```

Then create a corresponding `tc_proposals` entry linking to this doc.

**Important:** The Supabase database is the source of truth for backlog items. Markdown files in `docs/backlog/` are for detailed planning only.

---

## Task Schema Reference

### Task Fields (tc_tasks)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | UUID | Yes | Foreign key to tc_projects |
| `title` | TEXT | Yes | Short task title |
| `description` | TEXT | No | Detailed description |
| `status` | TEXT | No | `queued` (default), `assigned`, `in_progress`, `review`, `complete`, `blocked` |
| `priority` | INTEGER | No | Higher = more urgent (default: 0). Recommended scale: 0-10 |
| `priority_confirmed` | BOOLEAN | No | **REQUIRED for scheduling.** Must be `true` for task to be scheduled |
| `source` | TEXT | No | `user`, `agent_proposal`, `decomposition` |
| `tags` | JSONB | No | Array of string tags |
| `acceptance_criteria` | TEXT | No | How to verify completion |
| `parent_task_id` | UUID | No | For subtasks |
| `blocked_by_task_id` | UUID | No | Task blocking this one |
| `eta` | TIMESTAMPTZ | No | Estimated completion time |
| `estimated_sessions_opus` | INTEGER | No | Expected Opus sessions |
| `estimated_sessions_sonnet` | INTEGER | No | Expected Sonnet sessions |
| `requires_visual_review` | BOOLEAN | No | Needs human visual check |

### Proposal Fields (tc_proposals)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | UUID | Yes | Foreign key to tc_projects |
| `title` | TEXT | Yes | Proposal title |
| `description` | TEXT | No | What and why |
| `impact_score` | TEXT | No | `high`, `medium`, `low` |
| `reasoning` | TEXT | No | Why this should be prioritized |
| `status` | TEXT | No | `proposed` (default), `approved`, `rejected` |
| `estimated_sessions_opus` | INTEGER | No | Expected Opus sessions |
| `estimated_sessions_sonnet` | INTEGER | No | Expected Sonnet sessions |

---

---

## Priority System & Confirmation Requirements

### Priority Values

The `priority` field is an INTEGER where **higher values = higher priority**:

| Priority | Label | Use Case |
|----------|-------|----------|
| 0 | Default | Standard backlog items |
| 1-3 | Low | Nice-to-have features, maintenance |
| 4-6 | Medium | Regular features, bug fixes |
| 7-9 | High | Important features, critical bugs |
| 10 | Urgent | Blocking issues, critical path |

**Note:** The PriorityScorer algorithm assumes a 0-10 scale. Values >10 are allowed but may produce unexpected scoring.

### How Scheduling Uses Priority

1. **TaskQueue** sorts tasks by `effectivePriority = priority + (hours_waiting * 0.1)`
2. Older tasks gradually rise in priority to prevent starvation
3. **PriorityScorer** weighs priority as 25% of the urgency score (part of overall task scoring)

### MANDATORY: Priority Confirmation Before Task Start

**No task may be scheduled without explicit user confirmation of its priority.**

This is enforced via the `priority_confirmed` field:

| Field | Default | Requirement |
|-------|---------|-------------|
| `priority_confirmed` | `false` | Must be `true` for scheduler to pick up task |

**Workflow:**
1. New tasks are created with `priority_confirmed = false`
2. System notifies user via Slack of pending priority review
3. User reviews and confirms priorities via Slack command or database update
4. Only confirmed tasks enter the scheduling queue

**To confirm a task:**
```sql
UPDATE tc_tasks
SET priority_confirmed = true,
    priority_confirmed_at = now(),
    priority_confirmed_by = 'user'
WHERE id = '<task_id>';
```

**To view unconfirmed tasks:**
```sql
SELECT id, title, priority, created_at FROM tc_tasks
WHERE status = 'queued' AND priority_confirmed = false
ORDER BY created_at DESC;
```

### Why This Matters

This requirement ensures:
- No autonomous task execution without user oversight
- Opportunity to adjust priorities before work begins
- Clear audit trail of who approved what
- Prevents runaway agent costs on unexpected tasks

**See also:** `docs/priority-system-and-confirmation.md` for full implementation details.

---

## Common Operations

### View Backlog
```sql
SELECT title, status, priority, priority_confirmed, tags FROM tc_tasks
WHERE project_id = '4d854ae0-4d64-4c0c-a571-8bcffa10860a'
AND status IN ('queued', 'in_progress')
ORDER BY priority DESC;
```

### View Pending Proposals
```sql
SELECT title, impact_score, reasoning FROM tc_proposals
WHERE status = 'proposed'
ORDER BY created_at;
```

### Approve a Proposal (converts to task)
```sql
-- First update proposal status
UPDATE tc_proposals SET status = 'approved', resolved_at = now() WHERE id = '<proposal_id>';

-- Then create the task
INSERT INTO tc_tasks (project_id, title, description, source)
SELECT project_id, title, description, 'agent_proposal'
FROM tc_proposals WHERE id = '<proposal_id>';
```

### Update Task Status
```sql
UPDATE tc_tasks SET status = 'in_progress', started_at = now() WHERE id = '<task_id>';
UPDATE tc_tasks SET status = 'complete', completed_at = now() WHERE id = '<task_id>';
```

### Check Database Health
```sql
SELECT 1 as health_check;  -- Simple connectivity test
```

---

## Development Commands

```bash
# Run from traffic-control directory
npm run build          # Compile TypeScript
npm run start          # Start the orchestrator
npm run dev            # Development mode with hot reload
npm run test           # Run all tests (1287 tests)
npm run test:watch     # Run tests in watch mode
npm run cli            # Run CLI commands
```

## Code Style

- **ESM Imports**: Use `.js` extensions in TypeScript imports (e.g., `import { x } from './module.js'`) due to `--moduleResolution node16`
- **Logging**: Use component loggers via `logger.child('ComponentName')` - see Logging System section below

## Parallel Agent Pattern

For multi-file changes across independent components, spawn parallel Task agents:
- Each agent handles one component with a focused prompt
- Use `run_in_background: true` and `TaskOutput` to wait for completion
- Verify build (`npm run build`) and tests (`npm test`) after all agents complete

## Key Features

### Resilience & Health Monitoring
- **Database health checks** - Startup validation with exponential backoff
- **Graceful degradation** - Continues operating in degraded mode during DB outages
- **Automatic recovery** - Detects when services recover and resumes normal operation
- **Event-driven monitoring** - Emits `database:healthy`, `database:degraded`, `database:recovered` events

### Slack Integration
- **Retry with exponential backoff** - Handles transient network failures
- **Question routing** - Routes agent questions to Slack threads
- **Thread tracking** - Maintains conversation context
- **Notification batching** - Efficient message delivery
- **Channel**: `#all-traffic-control` (ID: `C0ABXJYCGMN`)
- **Bot user**: `@trafficcontrol`

### Agent Management
- **Subagent tracking** - Monitors agent hierarchies with depth limits
- **Session management** - Tracks active sessions and capacity
- **Project lookup** - Links agents to tasks and projects

### Logging System
TrafficControl uses a structured logging system with the following features:

**Log Levels:**
- `DEBUG` - Detailed diagnostic information
- `INFO` - General operational information
- `WARN` - Warning conditions
- `ERROR` - Error conditions

**Configuration (Environment Variables):**
```bash
TC_LOG_LEVEL=INFO      # DEBUG, INFO, WARN, ERROR (default: INFO)
TC_LOG_FORMAT=pretty   # json, pretty (default: pretty)
TC_LOG_REDACT=field1,field2  # Additional fields to redact
```

**Usage:**
```typescript
import { logger } from './logging/index.js';

// Create component logger
const log = logger.child('MyComponent');

// Basic logging
log.info('Operation started', { taskId: '123' });
log.debug('Processing details', { step: 1, total: 5 });
log.warn('Rate limit approaching', { current: 90, limit: 100 });
log.error('Operation failed', error, { context: 'retry' });

// Performance timing
log.time('database-query');
await database.query(...);
log.timeEnd('database-query');

// Correlation IDs for request tracing
const correlatedLog = log.withCorrelationId('req-abc123');
correlatedLog.info('Request received');
```

**Features:**
- **Component-scoped loggers** - Each module has its own logger context
- **Correlation IDs** - Trace requests across component boundaries
- **Auto-redaction** - Sensitive data (tokens, keys, secrets) automatically masked
- **Performance timing** - Built-in timing utilities for operations
- **JSON output** - Machine-parseable format for log aggregation

---

## Verification Checklist

When making changes to TrafficControl or claiming work is complete, use this checklist to verify the system is actually working:

### Startup & Connectivity
- [ ] Application starts without errors
- [ ] Database connection is healthy (run `SELECT 1 as health_check;`)
- [ ] No immediate crashes or error logs in console

### Agent Operations
- [ ] At least one agent session is created in the database:
  ```sql
  SELECT * FROM tc_agent_sessions
  WHERE created_at > now() - interval '5 minutes'
  ORDER BY created_at DESC;
  ```
- [ ] Agents can spawn and execute basic operations
- [ ] Agent status is correctly tracked in `tc_tasks` table

### Slack Integration
- [ ] Slack bot is connected and online
- [ ] Test @mention receives a response
- [ ] Recent interventions are logged:
  ```sql
  SELECT * FROM tc_interventions
  ORDER BY created_at DESC
  LIMIT 5;
  ```
- [ ] Messages appear in the configured Slack channel

### Main Loop Activity
- [ ] Tasks are being assigned (status changes from `queued` to `assigned`):
  ```sql
  SELECT * FROM tc_tasks
  WHERE status = 'in_progress' OR status = 'assigned'
  ORDER BY updated_at DESC;
  ```
- [ ] Main loop shows activity in logs (task processing, capacity checks, etc.)
- [ ] State file is being updated (if using file-based state)

### After Code Changes
- [ ] Run the build: `npm run build` (must succeed)
- [ ] Run the test suite: `npm run test` (must pass)
- [ ] Start the application and wait at least one full tick cycle
- [ ] Verify the specific functionality you changed actually works

### Red Flags (Never Ignore These)
- Silent startup (no logs) = something is wrong
- Database queries timing out = connectivity issue
- Agent sessions not appearing = spawn logic broken
- Slack messages not sending = integration broken
- Tasks stuck in "assigned" with no progress = main loop not running

**Remember:** "No errors" during compilation or startup does NOT mean the system is working. Always verify end-to-end functionality.

---

## Core Principles (from traffic-control.md)

1. **Bias Toward Action** - Always prefer action over inaction. Work should never stop.
2. **Continuous Learning** - After failures, create retrospectives and implement learnings.
3. **100% Utilization** - Always be bottlenecked only on Claude capacity, never on backlog depth.
4. **Thin Orchestrator** - The orchestrator should delegate, not implement directly.

## Reporting Requirements

At each checkpoint, report on:
- Status of each work stream
- Current blockers
- Usage/cost consumption per project
