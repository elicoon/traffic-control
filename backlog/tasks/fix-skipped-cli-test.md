### Fix Skipped CLI Availability Test
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Test suite shows "1 skipped" test out of 2348 total tests. Skipped tests indicate incomplete test coverage and usually point to a flaky test that was disabled rather than fixed. The skip prevents CI from catching regressions in that code path. Based on recent commits, the skipped test is likely in src/cli/index.test.ts (CLI availability test) which may have environment-dependent behavior that wasn't properly handled.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] Identify which test is skipped (grep for test.skip or it.skip in test files)
- [ ] Root cause documented (timing, environment, or mock issue)
- [ ] Test is fixed and re-enabled (no test.skip or it.skip)
- [ ] Test passes consistently in 10 consecutive runs
- [ ] Test suite reports 0 skipped tests

#### Next steps
1. Grep for "test.skip" or "it.skip" in src/**/*.test.ts to find skipped test
2. Read the test file and understand why it was skipped (check git history)
3. Fix the underlying issue (add proper mocks, fix timing, or add env guards)
4. Re-enable the test and run it 10 times
5. Run full test suite to verify 0 skipped
