### Add Integration Test for Full Orchestration Cycle
- **Project:** TrafficControl
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** All current tests are unit tests. No integration tests verify that the orchestrator can actually spawn an agent, assign a task, receive completion, and update database. Need end-to-end test that validates the full cycle works.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Integration test creates a real task in test database
- [ ] Test starts orchestrator main loop
- [ ] Test verifies task transitions: queued → assigned → in_progress → complete
- [ ] Test verifies agent session is created and tracked
- [ ] Test verifies usage logs are persisted
- [ ] Test runs in under 30 seconds
- [ ] Test cleanup removes test data after completion
- [ ] Test can be run in CI without requiring real Anthropic API key (use mock adapter)

#### Next steps
1. Create src/__tests__/integration/ directory
2. Add integration test file: orchestration-cycle.integration.test.ts
3. Set up test database fixtures and cleanup
4. Create mock AgentAdapter for integration tests (no real API calls)
5. Write test that verifies full task lifecycle
6. Add npm run test:integration script
7. Update CI documentation with integration test requirements
