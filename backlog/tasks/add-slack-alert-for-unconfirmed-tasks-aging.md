### Add Slack Alert When Tasks Have Unconfirmed Priority for Over 24 Hours
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Tasks require priority_confirmed=true before scheduling (safety requirement from the $40+ cost incident). However, there is no notification when tasks sit unconfirmed for extended periods. This means backlog items can silently stall without the user knowing they need to confirm priorities. Adding a periodic check (e.g., once per main loop tick or daily) that sends a Slack message listing tasks with priority_confirmed=false and created_at > 24 hours ago would close this operational gap.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] A function queries tc_tasks for rows where status='queued', priority_confirmed=false, and created_at < now() - 24 hours
- [ ] When matching tasks are found, a single Slack message is sent to #all-traffic-control listing the stale unconfirmed tasks (title, age, priority)
- [ ] The alert fires at most once per 24-hour period per task (not on every tick) — tracked via a last-alerted timestamp or similar dedup mechanism
- [ ] Unit test verifies the query logic and message formatting
- [ ] Build passes and all tests pass

#### Next steps
1. Add a `getStaleUnconfirmedTasks(olderThanHours: number)` method to TaskRepository
2. Create a `PriorityConfirmationReminder` class that checks for stale unconfirmed tasks and sends a Slack summary
3. Wire the reminder into the main loop or BacklogValidator tick cycle with a 24-hour cooldown
4. Add tests for the query logic and deduplication behavior
