### Wire PriorityScorer into TaskQueue for Multi-Factor Scheduling
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** PriorityScorer in src/analytics/priority-scorer.ts implements a multi-factor scoring algorithm that weighs priority (25%), wait time, dependencies, and other factors to produce an urgency score. Currently TaskQueue sorts by a simple effectivePriority = priority + (hours_waiting * 0.1). Replacing this with PriorityScorer's urgency score would give smarter scheduling that considers blocked tasks, project balance, and diminishing returns — all without changing the external API.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] TaskQueue receives PriorityScorer instance via config
- [ ] Task ordering uses PriorityScorer.score() instead of the simple effectivePriority formula
- [ ] Tasks with unresolved blocked_by_task_id dependencies are scored lower (or excluded)
- [ ] If PriorityScorer is not provided, TaskQueue falls back to existing effectivePriority formula (backwards compatible)
- [ ] Unit tests verify: scored ordering differs from simple priority ordering when wait times and dependencies vary, fallback works without PriorityScorer

#### Next steps
1. Read src/analytics/priority-scorer.ts to understand the score() interface and input requirements
2. Read src/scheduler/task-queue.ts to find where effectivePriority is calculated
3. Add optional PriorityScorer to TaskQueue config
4. Replace effectivePriority calculation with PriorityScorer.score() when available
5. Add unit tests comparing scored vs simple ordering with varied task attributes
