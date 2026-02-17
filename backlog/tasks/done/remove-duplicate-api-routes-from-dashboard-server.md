### Remove Duplicate API Routes from Dashboard server.ts
- **Project:** traffic-control
- **Status:** done
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The dashboard refactoring (tc-dashboard-costs-v2 dispatch) added `src/dashboard/routes/api.ts` with all API endpoints extracted from `server.ts`, but `server.ts` still contained the original route handlers (~200 lines). Both files had identical endpoint error handling for 10 routes (status, projects, project, agents, tasks, metrics, recommendations, task priority update, pause, resume). The `server.ts` routes were dead code now that `api.ts` was mounted. Removing them cut `server.ts` from 472 to 233 lines and eliminated the duplication that caused double maintenance burden.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16
- **Completed:** 2026-02-16
- **Commit:** b30f29a

#### Acceptance Criteria
- [x] All 10 duplicate API route handlers removed from `src/dashboard/server.ts`
- [x] `src/dashboard/server.ts` only contains server lifecycle (create, start, stop, SSE) — no API route definitions
- [x] `src/dashboard/routes/api.ts` remains the single source for all API routes
- [x] `npm run build` succeeds with no type errors
- [x] `npm test` passes with no failures (including existing dashboard tests)

#### Next steps
None — task complete.
