### Fix Flaky NotificationManager Integration Test (Batching Assertion Failure)
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Test suite shows 1 failing test: `src/orchestrator/integration.test.ts > Phase 5 Integration > NotificationManager Integration > should batch notifications`. The test expects `mockSendFn` to be called 2 times but gets 0 calls. This is a batching test where notifications should be queued and flushed. The failure suggests either the batching logic isn't triggering the flush, or the mock isn't wired correctly. All 2346 other tests pass, so this is an isolated integration test issue, not a production bug.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] Test `should batch notifications` in src/orchestrator/integration.test.ts passes consistently
- [ ] Full test suite runs with 0 failures (2347/2347 passing)
- [ ] Root cause is identified and documented in the test fix commit message
- [ ] If the test reveals a real batching bug, the production code is fixed; if it's a mock issue, the test is corrected

#### Next steps
1. Run the failing test in isolation to reproduce: `npm test -- src/orchestrator/integration.test.ts -t "should batch notifications"`
2. Read the test code at src/orchestrator/integration.test.ts:443 to understand what's being tested
3. Add console.log statements to trace whether notifications are queued and flush is called
4. Determine if the issue is in NotificationManager batching logic or test mock setup
