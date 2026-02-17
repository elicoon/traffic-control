### Remove Duplicate API Routes from Dashboard server.ts
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The dashboard refactoring (tc-dashboard-costs-v2 dispatch) added `src/dashboard/routes/api.ts` with all API endpoints extracted from `server.ts`, but `server.ts` still contains the original route handlers (~200 lines). Both files have identical endpoint error handling for 10 routes (status, projects, project, agents, tasks, metrics, recommendations, task priority update, pause, resume). The `server.ts` routes are dead code now that `api.ts` is mounted. Removing them will cut `server.ts` from 468 to ~260 lines and eliminate the duplication that causes double maintenance burden.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] All 10 duplicate API route handlers removed from `src/dashboard/server.ts`
- [ ] `src/dashboard/server.ts` only contains server lifecycle (create, start, stop, SSE) — no API route definitions
- [ ] `src/dashboard/routes/api.ts` remains the single source for all API routes
- [ ] `npm run build` succeeds with no type errors
- [ ] `npm test` passes with no failures (including existing dashboard tests)

#### Next steps
1. Read `src/dashboard/server.ts` and `src/dashboard/routes/api.ts` to confirm which routes are duplicated
2. Verify `api.ts` routes are actually mounted in `server.ts` (check the `app.use()` call)
3. Remove all duplicate route handlers from `server.ts`, keeping only server lifecycle code
4. Run `npm run build && npm test` to verify no regressions
