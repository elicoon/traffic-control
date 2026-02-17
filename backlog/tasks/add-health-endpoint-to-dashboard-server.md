### Add /health Endpoint to Dashboard Server
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The database health check function (`checkHealth()` in src/db/client.ts) exists and returns `{ healthy, latencyMs, error? }`, but it's only used internally by PreFlightChecker. The dashboard has no dedicated health endpoint — the closest is `/api/status` which returns full system metrics. A lightweight `/health` endpoint is standard for production services and enables external monitoring, load balancer health checks, and uptime tracking. The relay module already has graceful shutdown patterns that could inform this.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] `GET /health` returns `200 { status: "ok", database: { healthy: true, latencyMs: N } }` when DB is reachable
- [ ] `GET /health` returns `503 { status: "degraded", database: { healthy: false, error: "..." } }` when DB is unreachable
- [ ] Endpoint responds in <100ms (does not block on slow DB queries — uses existing `checkHealth` with timeout)
- [ ] Route is registered in `src/dashboard/routes/api.ts` with a test in the dashboard test file

#### Next steps
1. Add `GET /health` route in `src/dashboard/routes/api.ts` that calls `checkHealth(3000)` from `src/db/client.ts`
2. Return 200 with DB latency on success, 503 with error details on failure
3. Add unit test mocking `checkHealth` for both healthy and degraded scenarios
