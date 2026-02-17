### Add Relay Module Usage Documentation
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** documentation
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The relay module (src/relay/) enables Slack-based Claude CLI execution, allowing users to invoke Claude Code from Slack messages. The module has 52+ tests and is production-ready, but lacks user-facing documentation. There's no guide on how to use the relay bot, what commands it accepts, or how to configure project directories. The .env.example has relay config variables but no explanation of workflows. Users looking at the codebase won't know this feature exists or how to enable it.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] Create docs/RELAY_USAGE.md with relay bot overview
- [ ] Document Slack message format for invoking relay (e.g., "run in traffic-control: check test coverage")
- [ ] Document RELAY_PROJECTS_DIR fuzzy matching behavior
- [ ] Document RELAY_MODEL and RELAY_TIMEOUT_MS configuration
- [ ] Add troubleshooting section (CLI not found, auth errors, timeout)
- [ ] Link to relay docs from main README.md

#### Next steps
1. Read src/relay/handler.ts and src/relay/bot.ts to understand message parsing
2. Read existing tests to understand command patterns
3. Create docs/RELAY_USAGE.md with setup, usage examples, and config reference
4. Add troubleshooting section based on error handling in handler.ts
5. Link from README.md "Features" section
