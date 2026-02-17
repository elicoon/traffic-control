### Expose Task Age Metrics in Dashboard (Oldest Queued, Average Wait Time)
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Dashboard shows task counts by status but not time-based metrics. BacklogValidator checks for stale tasks (>7 days), but this data isn't exposed to users. Handler-state mentions "Oldest unaddressed" as a backlog health metric. Useful metrics: oldest queued task age (days), average wait time (created_at to started_at), longest in-progress task duration. These surface bottlenecks and help identify stuck work. Current dashboard has /api/tasks endpoint — extend it to include age aggregations. Priority Scorer uses hours_waiting in urgency calculation, so wait time data is already relevant to scheduling.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] Dashboard /api/tasks endpoint returns oldest_queued_task_age_hours field
- [ ] Dashboard returns average_wait_time_hours for recently started tasks (last 30 days)
- [ ] Dashboard returns longest_in_progress_task_hours for currently active tasks
- [ ] Dashboard UI displays these metrics in a "Backlog Health" card or similar
- [ ] Metrics update on page refresh (no real-time updates required for MVP)
- [ ] Integration test confirms metrics calculated correctly from mock task data

#### Next steps
1. Add SQL aggregations to TaskRepository for age metrics (MAX(NOW() - created_at), AVG(started_at - created_at), etc.)
2. Extend DashboardAPI /api/tasks response to include age_metrics object
3. Add "Backlog Health" card to dashboard UI showing oldest/average/longest metrics
4. Add unit tests for age metric calculations with fixed timestamps
5. Update dashboard documentation with new metrics
