# TrafficControl Design Document

**Date:** 2026-01-26
**Status:** Approved
**Author:** Brainstorming session with Claude

---

## Executive Summary

TrafficControl is an autonomous agent orchestration system that maximizes Claude usage capacity while minimizing manual intervention. It manages multiple concurrent projects through parallel Claude Code agents, communicates via Slack for mobile-first interaction, and implements a continuous learning system to prevent repeated mistakes.

---

## Core Principles

### 1. Bias Toward Action
- Action (even imperfect) is better than inaction
- Work should never stop; agents find ways to continue or immediately escalate blockers
- Blocked agents don't block the system - other work continues in parallel

### 2. Continuous Learning
- Detailed retrospectives after failures
- Learnings propagate to prevent repeat mistakes
- Goal: Never make the same mistake twice

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR PHONE                               │
│                    (Slack Mobile App)                           │
└─────────────────────────┬───────────────────────────────────────┘
                          │ Slack API
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DESKTOP PC (Always-on)                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   TrafficControl Core                     │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │  │
│  │  │  Scheduler  │  │   Router    │  │  Reporter   │       │  │
│  │  │  (capacity  │  │  (Slack ↔   │  │  (metrics,  │       │  │
│  │  │   manager)  │  │   agents)   │  │   status)   │       │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘       │  │
│  │                          │                                │  │
│  │  ┌───────────────────────┴───────────────────────────┐   │  │
│  │  │              Agent Session Manager                │   │  │
│  │  │         (Claude Agent SDK - TypeScript)           │   │  │
│  │  └───────────────────────┬───────────────────────────┘   │  │
│  └──────────────────────────┼────────────────────────────────┘  │
│                             │                                    │
│      ┌──────────────────────┼──────────────────────┐            │
│      ▼                      ▼                      ▼            │
│  ┌────────┐            ┌────────┐            ┌────────┐         │
│  │Agent 1 │            │Agent 2 │            │Agent N │         │
│  │Project │            │Project │            │Project │         │
│  │   A    │            │   B    │            │   C    │         │
│  └───┬────┘            └───┬────┘            └────────┘         │
│      │                     │                                     │
│      ▼                     ▼                                     │
│  ┌────────┐            ┌────────┐                               │
│  │Subagent│            │Subagent│  (depth limit: 2)             │
│  └────────┘            └────────┘                               │
└─────────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
    ┌──────────┐                   ┌─────────────┐
    │ Supabase │                   │  Markdown   │
    │ (metrics,│                   │  (learnings,│
    │ backlog) │                   │  retrospect)│
    └──────────┘                   └─────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime environment | Desktop PC | Free, powerful, local to Claude Code |
| Agent management | Claude Agent SDK (TypeScript) | Programmatic control, streaming events, usage metrics |
| Mobile interface | Slack | Robust API, good mobile app, threading support |
| Data storage | Hybrid (Supabase + Markdown) | Queryable metrics + agent-readable learnings |
| Language | TypeScript | Matches existing stack, SDK support |

---

## Core Components

### 1. Scheduler (Capacity Manager)
- Tracks usage against Opus/Sonnet session and weekly caps
- Maintains priority queue of ready tasks
- Spawns agents when capacity available
- Balances model selection based on task complexity

### 2. Agent Manager
- Spawns sessions via Claude Agent SDK with project context
- Monitors state: working, blocked, waiting approval, complete
- Captures streaming events for logging and metrics
- Enforces subagent depth limit (max 2 levels)
- Collects usage metrics per session

### 3. Router
- Routes agent questions/blockers → Slack
- Routes Slack replies → correct agent
- Manages conversation threading (one thread per task)
- All agent questions go through Slack - no exceptions

### 4. Backlog Manager
- Stores tasks with priority, project, complexity estimates
- Tracks task state: `queued` → `assigned` → `in_progress` → `review` → `complete`
- Proactively prompts when backlog runs low with detailed proposals:
  - Impact assessment
  - Estimated sessions
  - Reasoning for each proposed task
- Accepts new tasks via Slack commands

### 5. Reporter
- Scheduled checkpoint reports (configurable frequency)
- Per-project: status, blockers, usage consumed
- ROI metrics: expected vs actual consumption, intervention time
- **Prioritization recommendations** for resource allocation between projects
- Alerts on capacity underutilization

---

## Data Model

### Supabase Tables

```sql
-- Projects
projects (
  id, name, description, status, priority,
  created_at, updated_at
)

-- Tasks in backlog
tasks (
  id, project_id, title, description,
  status: 'queued'|'assigned'|'in_progress'|'review'|'complete'|'blocked',
  priority, complexity_estimate,
  -- Estimates (human-friendly)
  estimated_sessions_opus, estimated_sessions_sonnet,
  -- Actuals (precise)
  actual_tokens_opus, actual_tokens_sonnet,
  actual_sessions_opus, actual_sessions_sonnet,
  assigned_agent_id, started_at, completed_at,
  requires_visual_review: boolean
)

-- Agent sessions
agent_sessions (
  id, task_id, model: 'opus'|'sonnet'|'haiku',
  parent_session_id,  -- null for top-level, set for subagents
  status: 'running'|'blocked'|'waiting_approval'|'complete'|'failed',
  tokens_used, started_at, ended_at,
  blocker_reason, blocker_sent_at, blocker_resolved_at
)

-- Usage tracking (with cost at time of use)
usage_log (
  id, model, tokens_input, tokens_output,
  cost_usd,  -- actual dollar cost at time of usage
  session_id, timestamp
)

-- Estimate evolution tracking
estimates_history (
  id, task_id, recorded_at,
  estimated_sessions, estimated_impact_score,
  estimated_intervention_minutes
)

-- Intervention time tracking
interventions (
  id, task_id, type: 'question'|'approval'|'blocker'|'review',
  started_at, resolved_at, duration_seconds
)
```

### Markdown Files (Agent-Readable)

```
traffic-control/
├── learnings/
│   ├── global.md           # Cross-project patterns
│   ├── project-a.md        # Project-specific learnings
│   └── project-b.md
├── retrospectives/
│   ├── 2026-01-26-auth-bug.md
│   └── ...
└── agents.md               # Agent behavior guidelines
```

---

## Agent Orchestration Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MAIN LOOP                                     │
│                                                                         │
│  ┌─────────┐    ┌─────────────┐    ┌─────────────┐    ┌────────────┐   │
│  │ Check   │───▶│ Pick task   │───▶│ Spawn agent │───▶│  Monitor   │   │
│  │capacity │    │ from backlog│    │ (SDK)       │    │  events    │   │
│  └─────────┘    └─────────────┘    └─────────────┘    └─────┬──────┘   │
│       ▲                                                      │          │
│       │                                                      ▼          │
│       │         ┌────────────────────────────────────────────────┐     │
│       │         │              EVENT HANDLERS                     │     │
│       │         ├────────────────────────────────────────────────┤     │
│       │         │  on_question ──▶ Route to Slack, mark blocked  │     │
│       │         │  on_tool_call ──▶ Log activity, track tokens   │     │
│       │         │  on_subagent_spawn ──▶ Register, enforce limit │     │
│       │         │  on_completion ──▶ Run validation pipeline     │     │
│       │         │  on_error ──▶ Log, notify, maybe retry         │     │
│       │         └───────────────────────────────────────┬────────┘     │
│       │                                                 │               │
│       └─────────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Behaviors

1. **Capacity-first scheduling** - Won't spawn if at limit; queues until capacity frees
2. **Non-blocking on questions** - Blocked agents don't block system; other work continues
3. **Subagent awareness** - Registered, tokens roll up, depth enforced
4. **Completion triggers validation** - Full pipeline before human review

---

## Testing & Validation Pipeline

Agents must complete this entire pipeline before requesting human review:

```
┌──────────────────────────────────────────────────────────────────┐
│               AGENT-SIDE VALIDATION (before human review)        │
└──────────────────────────────────────────────────────────────────┘

1. Write tests (including failing edge case tests)
         │
         ▼
2. Run tests ◀───────────────────┐
         │                       │
    Pass │            Fail ──▶ Fix and retry
         ▼
3. Lint/Type check
         │
    Pass │            Fail ──▶ Fix and retry
         ▼
4. Browser tests (Playwright)
         │
    Pass │            Fail ──▶ Fix and retry
         ▼
5. Code Review Plugin
         │
   Clean │         Issues ──▶ Fix, go back to step 2
         ▼
6. Re-run all tests
         │
    Pass │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│               HUMAN REVIEW (only after all green)                │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
7. Screenshot to Slack (UI tasks only)
         │
    ✅   │   ❌ + feedback ──▶ Back to agent, restart at step 2
         ▼
8. Commit & Update Metrics
```

### Agent Testing Instructions

```markdown
Before marking any task complete:
1. Write comprehensive tests including edge cases
2. Ensure all tests pass
3. Run lint and type checks, fix any errors
4. For UI changes: run Playwright browser tests
5. Invoke code-review plugin, address all feedback
6. Re-run full test suite
7. Only then submit for human review
```

---

## Slack Integration

### Channel Structure

```
#trafficcontrol (or DM)
│
├── 📌 Pinned: Status Dashboard
│
├── 🧵 Thread: [Project A] Task title
│   ├── Agent: "Starting task..."
│   ├── Agent: "Question: ..."
│   ├── You: "Answer"
│   ├── Agent: "Complete. Screenshot attached."
│   └── You: ✅
│
└── 🧵 Thread: [System] Daily Report
```

### Message Types

| Type | Format | Your Response |
|------|--------|---------------|
| Question | ❓ [Project] Agent asks: ... | Free-text reply |
| Blocker | 🚫 [Project] Blocked: ... | Free-text or "skip" |
| Visual Review | 👁️ [Project] Screenshot | ✅ / ❌ / feedback |
| Backlog Low | 📋 Proposals: ... | "approve all" / "approve 1,2" / add own |
| Checkpoint | 📊 Status + recommendations | "reallocate" / acknowledge |
| Feature Proposal | 💡 Proposed: ... | "approve" / "reject: reason" |

### Commands

- `status` - Current status of all agents
- `pause [project]` - Pause project
- `resume [project]` - Resume project
- `add task: [description]` - Add to backlog
- `prioritize [project]` - Bump priority
- `report` - Trigger immediate report

---

## Learning & Retrospective System

### Retrospective Triggers

| Trigger | Action |
|---------|--------|
| Task fails validation 3+ times | Auto-generate retrospective |
| Agent explicitly blocked | Retrospective after resolution |
| Visual review rejected | Capture feedback as learning |
| Test suite regression | Mandatory retrospective |
| Corrective feedback given | Extract and store learning |

### Retrospective Structure

```markdown
# Retrospective: [Task Title]
Date: YYYY-MM-DD
Project: [Project]
Agent Session: [id]

## What Happened
[Description of the failure]

## Root Cause
[Analysis of why it happened]

## What Should Have Been Done
[Correct approach]

## Learning (machine-readable)
```yaml
category: [testing|architecture|tooling|communication|project-specific]
subcategory: [specific area]
pattern: [identifier]
trigger: "when this situation occurs"
rule: "do this instead"
applies_to: [technologies/contexts]
```

## Prevention
[How this was incorporated into the system]
```

### Learning Propagation

1. Extract machine-readable learning from retrospective
2. Update `learnings/{project}.md`
3. If global pattern: update `learnings/global.md`
4. Update `agents.md` behavior rules

### Agent Context Loading

Every agent session starts with:
1. `traffic-control/agents.md` - Core behavior rules
2. `traffic-control/learnings/global.md` - Cross-project patterns
3. `traffic-control/learnings/{project}.md` - Project-specific gotchas
4. Project's own `CLAUDE.md`

---

## Success Metrics

| Metric | Target | Tracking |
|--------|--------|----------|
| Session limit utilization | 100% | Supabase: usage_log |
| Weekly limit utilization (Opus & Sonnet) | 100% | Supabase: usage_log |
| Backlog depth | Always sufficient for full parallelization | Supabase: tasks |
| Repeat mistakes | Zero | Supabase: retrospectives with same root cause |
| Manual intervention | Minimize progressively | Supabase: interventions |
| Estimate accuracy | Improve over time | Supabase: estimates_history vs actuals |

---

## Technology Stack

- **Language:** TypeScript
- **Agent SDK:** @anthropic-ai/claude-agent-sdk
- **Slack:** @modelcontextprotocol/server-slack or korotovsky/slack-mcp-server
- **Database:** Supabase (PostgreSQL)
- **Browser Testing:** Playwright
- **Runtime:** Node.js on Desktop PC

---

## Implementation Phases

### Phase 1: Foundation
- Basic orchestrator with single-agent spawning
- Slack integration (questions/answers routing)
- Supabase schema setup
- Manual task assignment

### Phase 2: Automation
- Capacity-aware scheduling
- Multi-agent parallel execution
- Backlog manager with proposals
- Reporter with checkpoint reports

### Phase 3: Learning
- Retrospective system
- Learning propagation
- Subagent support
- Visual review pipeline

### Phase 4: Optimization
- ROI tracking and recommendations
- Estimate accuracy improvement
- Prioritization engine
- Dashboard (web UI)

---

## Git Workflow

### Branching Strategy
- **One branch per task**: `task/{task-id}-{short-description}`
- Clean isolation for code review
- Easy rollback if issues arise
- Parallel tasks on same project don't conflict until merge

### Conflict Resolution

Agents handle merge conflicts autonomously - you are never bothered with implementation-level conflicts.

```
Merge conflict detected
        │
        ▼
Agent attempts to resolve (up to 5 tries)
        │
   ┌────┴────┐
   │         │
Resolved   Still failing
   │         │
   ▼         ▼
Continue   Analyze: Is this an architecture issue?
           │
      ┌────┴────┐
      │         │
     No        Yes
      │         │
      ▼         ▼
   Park task,  Escalate: "Tasks X and Y have
   move to     conflicting architectural
   other work  assumptions about [component]"
```

**What stays agent-side (never escalated):**
- Import ordering, variable naming, formatting
- Adding properties to same object
- Function signature changes that can be traced through

**What gets escalated (architecture issues only):**
- Conflicting data models
- Incompatible API contracts
- Different assumptions about feature scope

When a task is parked due to merge conflicts:
- Marked as "blocked on merge with task X"
- Agent continues with other work
- Automatically retried when blocking task merges

---

## Cost Tracking

Track both tokens and actual dollar cost at time of use:

```sql
usage_log (
  id, model,
  tokens_input, tokens_output,
  cost_usd,  -- actual cost at time of usage
  session_id, timestamp
)
```

This provides:
- Exact historical record of spending
- Accurate ROI calculations even if pricing changes
- Budget tracking and forecasting

---

## Notification Policy

### Notification Tiers

| Notification Type | Behavior |
|-------------------|----------|
| True blocker (agent stuck, can't continue) | Immediate |
| Question (agent waiting but others continue) | Batch every 30 min, or immediate if active |
| Visual review request | Batch every 30 min |
| Status report | **Twice daily** (morning + evening) |
| Backlog low | Once, then daily reminder |
| Task completed | Silent (logged only) |

### Quiet Hours
- **Midnight to 7 AM**: No notifications
- Urgent blockers queued for morning summary
- You can override with `dnd off` if needed

### Commands
- `dnd [duration]` - Enable do-not-disturb (e.g., `dnd 2h`)
- `dnd off` - Disable do-not-disturb

---

## References

- [clawdbot](https://github.com/clawdbot/clawdbot) - Multi-channel AI assistant framework
- [ralph](https://github.com/snarktank/ralph) - Autonomous AI agent loop
- [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview)
- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless)
