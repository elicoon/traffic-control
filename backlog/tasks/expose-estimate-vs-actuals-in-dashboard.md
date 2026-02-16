### Expose Estimate-vs-Actuals Comparison in Dashboard API
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** MetricsCollector already has a compareEstimatesVsActuals() method that calculates how accurate session estimates were versus actual usage. This data exists in the backend but is never exposed through the dashboard API or UI. Exposing it would give visibility into estimation accuracy, which directly feeds into whether CalibrationEngine integration (a separate backlog item) is worth prioritizing. The backend work is minimal — add one API endpoint and one UI section.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] New GET `/api/estimates` endpoint returns estimate-vs-actuals comparison data from MetricsCollector
- [ ] Dashboard UI displays a table or summary showing: task title, estimated sessions, actual sessions, accuracy percentage
- [ ] Endpoint handles empty data gracefully (returns empty array, not error)
- [ ] At least one unit test verifies the endpoint response shape

#### Next steps
1. Read src/reporter/metrics-collector.ts to understand the compareEstimatesVsActuals() return type and data shape
2. Add GET `/api/estimates` route in src/dashboard/routes/api.ts that calls MetricsCollector
3. Add a "Estimation Accuracy" section to the dashboard HTML with a simple table
4. Add a test in src/dashboard/routes/api.test.ts for the new endpoint
5. Run `npm test` and `npm run build` to verify
