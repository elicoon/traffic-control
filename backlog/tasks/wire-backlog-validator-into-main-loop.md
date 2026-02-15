### Wire BacklogValidator into Orchestrator Main Loop and Slack Reporting
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The BacklogValidator (src/backlog/validator.ts) was recently implemented with checks for stale tasks, incomplete tasks, orphaned blockers, and unconfirmed high-priority tasks. It's exported from src/backlog/index.ts but not yet used anywhere in the system. It should be integrated into the orchestrator main loop to run periodically (e.g., once per tick or hourly) and surface validation issues via Slack notifications and the Reporter metrics. This turns a passive validator into an active health check that prevents backlog rot.
- **Added:** 2026-02-14
- **Updated:** 2026-02-14

#### Acceptance Criteria
- [ ] BacklogValidator.validate() runs during the orchestrator's main loop tick (at a configurable interval, default once per hour)
- [ ] Validation results with severity=error are posted to the #all-traffic-control Slack channel
- [ ] Validation results are included in the Reporter's scheduled reports (morning/evening)
- [ ] A new event type (e.g., `backlog:validation:complete`) is emitted with the ValidationResult
- [ ] Integration test confirms the validator runs and emits events during a simulated tick

#### Next steps
1. Read `src/orchestrator/` to identify where periodic checks are run in the main loop
2. Add BacklogValidator instantiation in the orchestrator, configured to run at a throttled interval
3. Add Slack notification formatting for ValidationIssue items (reuse existing Slack formatting patterns)
4. Add validation summary to MetricsCollector or Reporter output
5. Emit `backlog:validation:complete` event via the event bus
6. Write integration test for the wiring
