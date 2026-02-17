### Add Usage Log Summary Query to CLI (Tokens, Cost, Sessions by Project)
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** UsageLogRepository was recently wired into MainLoop (handler-state: tc-persist-usage ✅), persisting agent token usage to tc_usage_log table. This data is stored but not queryable via CLI. Handler-state shows budget tracking issues and mentions checking usage manually. CLI should provide quick summary queries: total tokens/cost by project, tokens/cost by model tier (Opus/Sonnet), session count by project, time range filtering. This enables quick budget verification without manual database queries or relying on OAuth endpoint scraping.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] CLI command `trafficcontrol usage summary` returns total tokens, total cost, session count
- [ ] CLI accepts --project flag to filter by project_id or project name
- [ ] CLI accepts --since and --until flags for time range filtering (ISO8601 dates)
- [ ] CLI accepts --model flag to filter by Opus or Sonnet
- [ ] CLI output includes breakdown by project (table format: project_name, tokens, cost_usd, sessions)
- [ ] CLI --format=json flag returns machine-readable JSON for scripting
- [ ] Unit tests verify query filtering and aggregation logic

#### Next steps
1. Create `src/cli/commands/usage.ts` with summary subcommand
2. Add UsageLogRepository.getSummary(filters) method with aggregation query
3. Add command-line argument parsing for --project, --since, --until, --model flags
4. Add table formatter for human-readable output (reuse existing CLI formatters if available)
5. Add JSON formatter for --format=json flag
6. Write unit tests for filter combinations and edge cases (empty results, invalid dates)
