### Fix or Remove Skipped CLI Availability Test in AdapterFactory
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The test file `src/agent/adapter-factory.test.ts` contains one skipped test at line 172: "should return true when claude CLI is installed". Skipped tests indicate incomplete test coverage and should either be fixed to run reliably or removed if the functionality is no longer needed. This is a minor quality issue but should be addressed to maintain test suite health.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] The `it.skip` call at line 172 in `src/agent/adapter-factory.test.ts` is either removed or changed to `it`
- [ ] If the test is unskipped, it passes reliably in CI/local environments
- [ ] If the test is removed, add a comment explaining why CLI availability checking is not tested
- [ ] All existing tests still pass (`npm run test`)
- [ ] No other `.skip` or `.only` calls remain in the test suite

#### Next steps
1. Read `src/agent/adapter-factory.test.ts` line 172 and surrounding context
2. Determine why the test was skipped (flaky? environment-dependent? deprecated?)
3. If fixable: modify test to mock CLI availability check or use test fixtures
4. If not fixable: remove the skipped test and add explanatory comment
5. Search codebase for other `.skip` or `.only` calls: `grep -r "\.skip\|\.only" src/**/*.test.ts`
6. Run `npm run test` to verify all tests pass
