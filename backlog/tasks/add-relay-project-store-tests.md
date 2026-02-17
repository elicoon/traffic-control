### Improve RelayProjectStore Test Coverage to 80%+
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** RelayProjectStore (src/relay/project-store.ts) manages multi-project session tracking for the Slack relay feature, with fuzzy project name matching and active session management. It currently has 67.9% statement coverage and only 60% branch coverage, indicating untested error handling paths and edge cases. Given its role in routing Slack commands to the correct project context, higher coverage would improve confidence in production reliability.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Additional tests added to `src/relay/project-store.test.ts` (file already exists)
- [ ] Tests cover fuzzy project name matching edge cases (partial matches, multiple candidates, no matches)
- [ ] Tests cover active session tracking edge cases (duplicate session IDs, session cleanup)
- [ ] Tests verify error handling when base directory path is invalid
- [ ] Statement coverage for project-store.ts reaches ≥80%
- [ ] Branch coverage for project-store.ts reaches ≥75%
- [ ] All existing tests still pass (`npm run test`)

#### Next steps
1. Run `npm run test:coverage -- src/relay/project-store.test.ts` to see current coverage report
2. Read `src/relay/project-store.ts` lines 258-259, 298-300 (uncovered per coverage report)
3. Identify untested branches in fuzzy matching and session management logic
4. Add tests for edge cases (empty project name, non-existent base directory, concurrent session updates)
5. Run `npm run test:coverage` to verify coverage targets met
