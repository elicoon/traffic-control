### Add Real-Time Capacity Utilization Dashboard Widget
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** traffic-control.md's primary success metric is "100% utilization of session and weekly limits." CapacityTracker exists in src/scheduler/capacity-tracker.ts but dashboard (http://localhost:3000) does not show real-time capacity utilization. Users cannot see current Opus/Sonnet session usage vs limits, or weekly limit consumption. This visibility gap makes it impossible to verify the core success metric without SQL queries. Need dashboard widget showing: active sessions / session limit, weekly usage / weekly limit, visual progress bars.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] Dashboard displays Opus session utilization (e.g., "2 / 2 sessions active" with progress bar)
- [ ] Dashboard displays Sonnet session utilization (e.g., "3 / 5 sessions active" with progress bar)
- [ ] Dashboard displays weekly limit utilization for both Opus and Sonnet (e.g., "45% of weekly Opus limit used")
- [ ] Capacity widget updates in real-time (WebSocket or polling, 5-10 second refresh)
- [ ] Add `/api/capacity` endpoint to dashboard returning current capacity state
- [ ] Visual indicator changes color when approaching limits (green < 80%, yellow 80-95%, red > 95%)

#### Next steps
1. Read src/scheduler/capacity-tracker.ts to understand available capacity data (getCurrentUsage, getRemainingCapacity, etc.)
2. Read src/dashboard/server.ts and src/dashboard/routes/api.ts to understand existing API structure
3. Add `/api/capacity` endpoint returning CapacityTracker state as JSON
4. Read src/dashboard/views/ to understand dashboard UI structure
5. Add capacity utilization widget to dashboard HTML with progress bars
6. Test dashboard displays accurate capacity data when agents are running
