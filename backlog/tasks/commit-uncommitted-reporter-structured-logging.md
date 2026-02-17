### Commit Uncommitted Reporter Structured Logging Changes
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The tc-reporter-v2 worker dispatch completed successfully (replaced 4 console.log calls with structured logger in reporter and metrics-collector modules, 2042 tests pass) but the changes were never committed. Currently sitting as unstaged modifications in the working tree: `src/reporter/metrics-collector.ts` (1 console.warn replaced), `src/reporter/reporter.ts` (3 console calls replaced), plus 5 backlog task files with status updates. These need to be committed to avoid being lost on a branch switch or reset.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Changes to `src/reporter/metrics-collector.ts` and `src/reporter/reporter.ts` are committed
- [ ] Backlog task status updates (5 files) are committed
- [ ] `npm run build` succeeds after commit
- [ ] `npm test` passes after commit
- [ ] `git status` shows clean working tree for these files

#### Next steps
1. Run `git diff` to review the exact changes one more time
2. Stage and commit the reporter source changes: `git add src/reporter/metrics-collector.ts src/reporter/reporter.ts`
3. Stage and commit the backlog status updates: `git add backlog/tasks/`
4. Commit with message describing the completed reporter structured logging work
5. Verify with `npm run build && npm test`
