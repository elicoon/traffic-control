### Persist Agent Usage Logs to tc_usage_log on Completion
- **Project:** traffic-control
- **Status:** done
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** When agents complete, MainLoop processes the completion event and updates SpendMonitor in-memory, but never writes a row to tc_usage_log. This means cost data is lost on restart, historical cost queries return incomplete data, and Reporter/Dashboard cannot show accurate cumulative costs. The tc_usage_log table exists and has the right schema — it just never receives writes from the main execution path.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] On agent completion (success or error), a row is inserted into tc_usage_log with: session_id, task_id, project_id, model, input_tokens, output_tokens, cost_usd, timestamp
- [ ] On agent error/failure, usage is still logged (partial work still costs money)
- [ ] tc_usage_log entries survive orchestrator restart and are queryable for historical cost analysis
- [ ] Dashboard /api/metrics endpoint can query tc_usage_log for accurate cumulative costs
- [ ] Unit tests verify: usage logged on success, usage logged on error, correct fields populated

#### Next steps
1. Read the MainLoop completion/error event handlers to find where token usage data is available
2. Read src/db/ repository files to find or create a UsageLogRepository with an insert method
3. Add tc_usage_log insert call in the completion handler after SpendMonitor update
4. Add tc_usage_log insert call in the error handler for partial usage tracking
5. Add unit tests mocking the repository to verify correct data is written
