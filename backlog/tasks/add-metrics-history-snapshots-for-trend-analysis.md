### Store Periodic Metrics Snapshots to Enable Trend Analysis in Dashboard
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The Reporter and MetricsCollector currently provide point-in-time metrics only. Each API call or scheduled report re-queries the full database but stores nothing about what was observed. This means the dashboard can't show trends like "completion rate declining" or "blocked tasks increasing over time." Adding a `tc_metrics_snapshots` table that stores periodic snapshots (e.g., when each report is generated) would unlock trend charts in the dashboard and provide data for smarter recommendations. The Reporter already runs on a schedule, making it the natural place to persist snapshots.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] New `tc_metrics_snapshots` table created in Supabase with columns: id, project_id, snapshot_at, tasks_queued, tasks_in_progress, tasks_completed, tasks_blocked, active_opus_sessions, active_sonnet_sessions, total_tokens_used, completion_rate
- [ ] Reporter.sendScheduledReport() persists a snapshot row after each successful report generation
- [ ] Dashboard `/api/metrics/history?projectId=X&days=7` endpoint returns snapshots for a project over a time range
- [ ] At least one test verifies snapshot persistence during a report cycle

#### Next steps
1. Create the `tc_metrics_snapshots` table via Supabase SQL migration
2. Add a `MetricsSnapshotRepo` in `src/db/repositories/` with `save()` and `getByProject()` methods
3. Call `MetricsSnapshotRepo.save()` in Reporter after each scheduled report
4. Add `/api/metrics/history` endpoint to dashboard API routes
5. Write tests for the repository and the reporter integration
