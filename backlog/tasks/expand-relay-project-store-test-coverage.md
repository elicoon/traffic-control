### Expand Relay ProjectStore Test Coverage from 67% to 90%+
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** ProjectStore (src/relay/project-store.ts, 314 lines) has only 67.9% statement coverage with a 133-line test file. Lines 58-259 and 298-300 are uncovered per the v8 coverage report. This module is used by the relay system to map projects — undertested code here could cause silent relay failures.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Test file `src/relay/project-store.test.ts` is expanded with new test cases
- [ ] Coverage for project-store.ts reaches ≥90% statements
- [ ] Tests cover the uncovered lines (58-259, 298-300) including edge cases and error paths
- [ ] All existing tests still pass (`npm run test`)

#### Next steps
1. Run `npx vitest run --coverage src/relay/project-store` to identify exact uncovered lines
2. Read the uncovered code paths to understand what scenarios are missing
3. Add test cases targeting those specific paths
4. Verify coverage improvement with `npm run test:coverage`
