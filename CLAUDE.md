# TrafficControl - CLAUDE.md

## Overview

TrafficControl is an orchestration system for managing multiple Claude Code agents across concurrent projects. The goal is to maximize Claude usage capacity (100% utilization of session and weekly limits) while minimizing manual intervention.

## Project Structure

```
trafficControl/
├── src/
│   ├── agent/           # Agent lifecycle management
│   ├── backlog/         # Backlog monitoring & proposal generation
│   ├── db/repositories/ # Supabase database repositories
│   ├── orchestrator/    # Main orchestration logic
│   ├── scheduler/       # Task scheduling & capacity tracking
│   ├── slack/           # Slack bot integration
│   └── ...
├── docs/
│   ├── backlog/         # Backlog item proposals (markdown)
│   └── plans/           # Implementation plans
└── CLAUDE.md            # This file
```

## Database (Supabase)

All data is stored in Supabase. Tables are prefixed with `tc_`:
- `tc_projects` - Projects being managed
- `tc_tasks` - Tasks in the backlog
- `tc_proposals` - Proposed tasks awaiting approval
- `tc_agent_sessions` - Agent session tracking
- `tc_usage_log` - Token usage logging
- `tc_interventions` - Human intervention tracking

## Key Project IDs

| Project | ID |
|---------|-----|
| TrafficControl Internal | `4d854ae0-4d64-4c0c-a571-8bcffa10860a` |
| TrafficControl Infrastructure | `67f785f8-a9df-41eb-a9c9-0a01b434b705` |

---

## Adding Backlog Items

There are **two ways** to add backlog items:

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

---

## Development Commands

```bash
# Run from trafficControl directory
npm run build          # Compile TypeScript
npm run test           # Run all tests
npm run test:watch     # Run tests in watch mode
```

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
