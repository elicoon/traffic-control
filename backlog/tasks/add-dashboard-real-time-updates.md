### Add Real-Time Updates to Dashboard via WebSocket or SSE
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** feature
- **Scope:** large
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The dashboard (Express server in src/dashboard/) currently requires manual refresh to see status changes. Users must reload the page to see new task assignments, agent completions, or capacity updates. The EventBus in src/events/ already emits events like `agent:started`, `agent:completed`, `task:completed`, and `database:healthy`. Adding WebSocket or Server-Sent Events (SSE) to push these events to connected dashboard clients would enable live monitoring. SSE is simpler (one-way, no extra protocol) and sufficient for read-only dashboard updates. This is a nice-to-have UX improvement, not critical for core functionality.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] Dashboard server exposes `/api/events` SSE endpoint that streams EventBus events
- [ ] Frontend dashboard connects to SSE endpoint and updates UI on agent/task events
- [ ] Status table auto-refreshes when `agent:started`, `agent:completed`, or `task:completed` events fire
- [ ] Connection handles reconnect with exponential backoff if server restarts
- [ ] No polling fallback required (SSE degrades gracefully to manual refresh on connection failure)
- [ ] Performance: SSE endpoint does not create memory leaks for long-lived connections

#### Next steps
1. Read src/events/event-bus.ts to understand event subscription interface
2. Add `/api/events` route in src/dashboard/routes/api.ts that returns SSE stream
3. Subscribe to EventBus and send events as `data: {JSON}\n\n` SSE format
4. Update dashboard frontend HTML to use EventSource API and handle incoming events
