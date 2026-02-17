### Add Intelligent Model Selection Based on Task Complexity
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** README.md lists "Cost optimization: Intelligent model selection based on task complexity" as a planned feature. Currently, model selection (Opus vs Sonnet) is manual via task configuration. The CalibrationEngine already tracks estimated vs actual sessions per model, and tasks have a `complexity_estimate` field in the schema. The opportunity: use historical calibration data to predict which model is sufficient for a given task complexity. Simple bug fixes and test-only tasks can run on Sonnet ($3/session), reserving Opus ($15/session) for architecture work and complex features. This could reduce costs by 20-40% while maintaining quality.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] New ModelSelector module analyzes task.complexity_estimate and recommends opus/sonnet
- [ ] Recommendation uses CalibrationEngine historical data to predict success likelihood per model
- [ ] Tasks tagged as "test-coverage" or "bug-fix" default to Sonnet unless complexity is high
- [ ] Tasks tagged as "feature" or "refactor" get Opus for complexity > medium, otherwise Sonnet
- [ ] Scheduler integrates ModelSelector recommendation before agent spawn
- [ ] Unit tests verify correct model selection for known task types and complexities

#### Next steps
1. Read src/analytics/calibration-engine.ts to understand historical data structure
2. Read src/scheduler/scheduler.ts to see where model selection happens during agent spawn
3. Design ModelSelector interface: `recommendModel(task: Task): 'opus' | 'sonnet'`
4. Implement heuristics: test-coverage→Sonnet, bug-fix (small/medium)→Sonnet, feature (high complexity)→Opus
