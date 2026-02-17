### Add Graceful Shutdown to Dashboard Server
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The relay module (src/relay/index.ts) implements graceful shutdown handling (SIGINT/SIGTERM → cleanup → exit), but the dashboard server (src/dashboard/server.ts) starts an Express server without handling shutdown signals. When the process receives SIGTERM (e.g., during deployment), active SSE connections and in-flight requests are dropped abruptly. Adding graceful shutdown ensures clean connection draining and prevents data loss in the SSE event stream.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Dashboard server handles SIGINT and SIGTERM by closing the HTTP server with `server.close()`
- [ ] Active SSE connections receive a close event before shutdown
- [ ] Server logs shutdown initiation and completion via structured logger
- [ ] Shutdown completes within 5 seconds (force-exit after timeout to prevent hangs)

#### Next steps
1. In `src/dashboard/server.ts`, capture the return value of `app.listen()` as `server`
2. Add SIGINT/SIGTERM handlers that call `server.close()` with a 5-second force-exit timeout
3. Add test verifying shutdown handler registration (mock process.on)
