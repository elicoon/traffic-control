## TrafficControl

**Reference Projects:**
- [clawdbot](https://github.com/clawdbot/clawdbot)
- [ralph](https://github.com/snarktank/ralph)

---

## Core Principles

### 1. Bias Toward Action
- It is always better to take the wrong action than to have inaction
- Work should never stop; there should never be a lull on any project
- When problems arise, the first job is to find a way to continue
- If truly blocked, raise blockers immediately so they can be resolved

### 2. Continuous Learning
- Success isn't expected immediately, but an effective self-reinforcement learning mechanism is critical
- After failures, create detailed retrospectives to diagnose:
  - What went wrong
  - Why it happened
  - How to avoid it in the future
- Implement learnings into the core agent architecture
- Goal: Never make the same mistake twice

---

## Primary Goal

Remove myself from as much manual interaction with Claude Code as possible while managing multiple concurrent projects.

---

## Key Constraint: Claude Capacity

The **only** constraint I want to be bottlenecked on is Claude usage capacity. There are two types:
1. **Session limits** - per-session token/usage caps
2. **Weekly limits** - aggregate weekly usage caps

**Success metric:** Always operating at 100% utilization of both session and weekly limits. Anything less is a failure.

---

## Roles to Delegate

### 1. Project Scoping & Backlog Management
- Ensure there is always enough work in the backlog to keep all sub-agents occupied
- Proactively propose new features and review them with me before implementation
- Continuously ask questions to maintain a full backlog
- **Failure state:** Insufficient backlog work to utilize every session limit

### 2. Architecture Decisions
- Make backend architecture decisions effectively
- Extend to frontend UI architecture when heavy UI components are involved

### 3. Testing & Validation
- Currently a bottleneck: I'm the only one who can detect if the app is working
- **Priority improvement area:** Build autonomous testing capabilities

---

## Reporting Requirements

At each checkpoint, report on:
- Status of each work stream
- Current blockers
- Usage/cost consumption per project

This enables priority reallocation based on capacity constraints.

**Constraints to eliminate:**
- My personal time
- My ability to engage with different Claude Code instances
- Overall calendar time

---

## ROI Tracking System

Create a metric that maps **feature impact** against:
1. Expected Claude consumption
2. Actual Claude consumption
3. Implementation time required
4. **My time/intervention required** per feature or work stream

**Tracking goals:**
- Maintain detailed records of all projects and their statuses over time
- Track how estimates change over time:
  - Duration estimates
  - Impact estimates
  - Claude consumption estimates
  - Personal intervention requirements

---

## Success Metrics Summary

| Metric | Target |
|--------|--------|
| Session limit utilization | 100% |
| Weekly limit utilization (Opus & Sonnet) | 100% |
| Backlog depth | Always sufficient for full parallelization |
| Repeat mistakes | Zero |
| My manual intervention | Minimize progressively | 