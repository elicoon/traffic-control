### Standardize Dashboard API Error Responses
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The dashboard API routes in `src/dashboard/routes/api.ts` catch errors in individual route handlers but return inconsistent error formats — some return `{ error: message }`, others may return plain text or let Express handle it. A consistent error response format (`{ error: string, code?: string, details?: unknown }`) makes the API predictable for dashboard consumers and simplifies error handling in the frontend. This is a quality-of-life improvement that becomes important as the dashboard grows.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] All API routes return errors in a consistent JSON format: `{ error: string, statusCode: number }`
- [ ] Express error-handling middleware is added as a catch-all for unhandled route errors
- [ ] 404 responses for unknown API routes return JSON (not HTML)
- [ ] Existing dashboard tests pass, plus new test for the error middleware

#### Next steps
1. Review all catch blocks in `src/dashboard/routes/api.ts` to catalog current error response patterns
2. Add an Express error-handling middleware at the end of the route chain that formats all errors as `{ error, statusCode }`
3. Add a 404 catch-all route for `/api/*` returning `{ error: "Not found", statusCode: 404 }`
4. Update tests to verify error format consistency
