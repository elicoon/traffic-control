### Add Test Verification Loop (HYPERVELOCITY Component 1)
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** HYPERVELOCITY roadmap identifies verification as P0-CRITICAL foundation component. Currently agents complete tasks without proof of correctness. This implements automated test/build verification before task completion, automatic retry on failure (up to 3 attempts), and database storage of verification results. The system has 2213 passing tests and a clean build, making verification infrastructure straightforward. Key insight: "Verification defines correctness. Agents should never claim completion without proof."
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] VerificationRunner.runWithRetry() executes `npm test && npm run build` before task completion
- [ ] ResultParser extracts pass/fail status from command output
- [ ] RetryManager schedules automatic retry (max 3 attempts) on verification failure
- [ ] Only emit task:completed event when verification passes
- [ ] Verification results stored in tc_verification_results table with task_id, attempt_number, status, output
- [ ] Integration test confirms failed verification blocks task completion

#### Next steps
1. Create `src/verification/verification-runner.ts` with runWithRetry() method
2. Create `src/verification/result-parser.ts` to parse npm test/build output
3. Create `src/verification/retry-manager.ts` with exponential backoff logic
4. Add tc_verification_results table schema to database
5. Wire VerificationRunner into MainLoop task completion flow
6. Add integration test for full verification cycle
