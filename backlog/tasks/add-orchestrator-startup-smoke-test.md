### Add Integration Smoke Test That Verifies Orchestrator Startup Sequence
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** There is no integration test that exercises the full orchestrator startup path — from config loading through DB health check, pre-flight validation, safety system initialization, to first tick completion. The existing integration.test.ts is minimal. The verification checklist in CLAUDE.md lists startup verification as the first category, but it's manual. An automated smoke test would catch initialization ordering bugs, missing dependency wiring, and configuration validation failures that unit tests miss because they mock out the startup chain.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] New test file `src/orchestrator/startup-smoke.test.ts` (or added to existing integration test)
- [ ] Test creates a MainLoop with mocked dependencies and runs through the full startup sequence (init → start → one tick → stop)
- [ ] Test verifies: DB health check called, pre-flight checks executed, safety systems initialized, first tick completes without error, graceful shutdown works
- [ ] Test runs in under 5 seconds (no real DB or Slack connections)
- [ ] At least 5 assertions covering each startup phase
- [ ] `npm run build` and `npm test` pass

#### Next steps
1. Read `src/orchestrator/main-loop.ts` start() method to trace the startup sequence
2. Read `src/orchestrator/main-loop.test.ts` to understand existing mock patterns for dependencies
3. Create the smoke test using the existing mock factory patterns
4. Verify the test exercises start → tick → stop lifecycle
5. Run `npm test` and `npm run build` to verify
