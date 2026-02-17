### Add Backlog Low Water Mark Alerts to Slack
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Per traffic-control.md principle #1 (Bias Toward Action), the backlog should never run dry. The BacklogManager already has `isBacklogLow()` and `needsProposals()` methods, and the Reporter can detect when backlog depth drops below thresholds. However, there's no proactive notification system. When backlog drops below 3 actionable items per project, the system should alert via Slack so the product-strategist role can be invoked before work stops. This prevents the failure state: "Insufficient backlog work to utilize every session limit."
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] When BacklogManager detects backlog depth < 3 actionable items for any active project, send Slack alert
- [ ] Alert includes project name, current item count, and a call-to-action (e.g., "Run /product-strategist")
- [ ] Alerts are rate-limited to avoid spam (max 1 alert per project per 4 hours)
- [ ] Alert logic integrates with existing Reporter periodic check or MainLoop tick
- [ ] Unit tests verify alert fires when threshold crossed and respects rate limiting

#### Next steps
1. Read src/backlog/backlog-manager.ts to confirm `isBacklogLow()` and `getBacklogStats()` interfaces
2. Read src/reporter/reporter.ts to see how periodic reporting works
3. Add a new method in Reporter or BacklogManager to check backlog and send alerts via Slack
4. Store last-alert timestamp per project to implement 4-hour rate limit
