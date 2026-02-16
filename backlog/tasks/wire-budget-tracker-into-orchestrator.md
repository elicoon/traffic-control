### Wire BudgetTracker into Orchestrator Main Loop
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** BudgetTracker exists in src/analytics/budget-tracker.ts with full period-based budget tracking (daily/weekly/monthly), alert thresholds, and projection capabilities. However it is instantiated nowhere — SpendMonitor handles basic spend limits but lacks BudgetTracker's period awareness and budget allocation from tc_budgets table. Wiring it in adds real budget enforcement alongside the existing circuit breaker and spend monitor safety checks.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] BudgetTracker is instantiated in MainLoop constructor using Supabase client and project config
- [ ] MainLoop.tick() calls BudgetTracker.checkBudget() before scheduling new tasks
- [ ] When budget is exceeded for current period, new task scheduling is paused and a Slack notification is sent
- [ ] BudgetTracker budget data is loaded from tc_budgets table (not hardcoded)
- [ ] Existing SpendMonitor continues to function as a secondary safety net
- [ ] Unit tests cover: budget check passes (tasks scheduled), budget exceeded (tasks paused + Slack notified), budget recovery (scheduling resumes)

#### Next steps
1. Read src/analytics/budget-tracker.ts to understand its interface and initialization requirements
2. Add BudgetTracker to MainLoopConfig interface and instantiate in MainLoop constructor
3. Add budget check call in tick() method between circuit breaker check and task scheduling
4. Wire Slack notification for budget exceeded events via existing event bus
5. Add unit tests for the integration points
