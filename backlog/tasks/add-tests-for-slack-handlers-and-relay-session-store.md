### Add Unit Tests for Slack Handlers and Relay Session Store
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** 9 source files have zero test coverage. The highest-risk untested files are src/slack/handlers.ts (575 lines, processes all Slack commands and interactions) and src/relay/session-store.ts (manages relay session lifecycle). These modules handle user-facing interactions and session state — bugs here directly impact the Slack interface which is the primary way the user interacts with TrafficControl. Other untested files (markdown-generator, markdown-importer, context-budget, config) are lower risk.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] src/slack/handlers.test.ts exists with tests covering: command routing, task approval flow, status query handling, error responses for invalid commands
- [ ] src/relay/session-store.test.ts exists with tests covering: session creation, session retrieval, session cleanup/expiry, concurrent session handling
- [ ] At least 15 total new tests across both files
- [ ] All new tests pass (`npm test`)
- [ ] No changes to production source files (test-only change)

#### Next steps
1. Read src/slack/handlers.ts to identify public methods and their input/output contracts
2. Read src/relay/session-store.ts to understand session lifecycle methods
3. Create src/slack/handlers.test.ts with mocked Slack bolt context, testing each command handler
4. Create src/relay/session-store.test.ts with tests for CRUD operations and edge cases
5. Run `npm test` to verify all new and existing tests pass
