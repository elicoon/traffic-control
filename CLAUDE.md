# TrafficControl - CLAUDE.md

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
└── trafficControl.md    # Core philosophy & principles
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
| TrafficControl Internal | `YOUR_PROJECT_ID` |
| TrafficControl Infrastructure | `YOUR_INFRA_PROJECT_ID` |

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
  'YOUR_PROJECT_ID',  -- TrafficControl Internal project
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
  'YOUR_PROJECT_ID',
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
  'YOUR_PROJECT_ID',
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
| `priority` | INTEGER | No | Higher = more urgent (default: 0) |
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

## Common Operations

### View Backlog
```sql
SELECT title, status, priority, tags FROM tc_tasks
WHERE project_id = 'YOUR_PROJECT_ID'
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
npm run test           # Run all tests (1257 tests)
npm run test:watch     # Run tests in watch mode
npm run cli            # Run CLI commands
```

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
- **Channel**: `#all-traffic-control` (ID: `YOUR_CHANNEL_ID`)
- **Bot user**: `@trafficcontrol`

### Agent Management
- **Subagent tracking** - Monitors agent hierarchies with depth limits
- **Session management** - Tracks active sessions and capacity
- **Project lookup** - Links agents to tasks and projects

---

## Core Principles (from trafficControl.md)

1. **Bias Toward Action** - Always prefer action over inaction. Work should never stop.
2. **Continuous Learning** - After failures, create retrospectives and implement learnings.
3. **100% Utilization** - Always be bottlenecked only on Claude capacity, never on backlog depth.
4. **Thin Orchestrator** - The orchestrator should delegate, not implement directly.

## Reporting Requirements

At each checkpoint, report on:
- Status of each work stream
- Current blockers
- Usage/cost consumption per project
