### Add ROI Tracking System Visibility and Reporting
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** traffic-control.md defines ROI tracking as a core requirement: map feature impact against expected/actual Claude consumption, implementation time, and user intervention required. Analytics module has cost-tracker, budget-tracker, estimate-tracker, accuracy-analyzer, and roi-calculator — all with tests — but no visible reporting interface. The ROI tracking system exists in code but is not exposed to users. Need to surface ROI metrics via CLI command or dashboard endpoint so users can see actual ROI data.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] Add `trafficcontrol roi` CLI command that displays ROI metrics (reads from analytics/roi-calculator)
- [ ] ROI report includes: project name, estimated vs actual tokens, estimated vs actual sessions, cost efficiency ratio
- [ ] Add `/api/roi` endpoint to dashboard server (src/dashboard/routes/api.ts) returning ROI metrics as JSON
- [ ] ROI metrics include time-based filtering (last 7 days, last 30 days, all time)
- [ ] CLI output is human-readable table format (use console.table or similar)
- [ ] Update README.md "Planned Features" to change "ROI tracking" from planned to implemented, linking to CLI usage

#### Next steps
1. Read src/analytics/roi-calculator.ts to understand available ROI calculation methods
2. Read src/cli/commands.ts to understand existing command structure
3. Add `roi` command to CLI that calls ROICalculator and formats output
4. Add `/api/roi` route to dashboard/routes/api.ts that returns ROI data
5. Test CLI command with actual database data (`npm run cli roi`)
6. Update README.md to document `trafficcontrol roi` command
