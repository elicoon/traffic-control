### Document Slack Claude Relay Module Usage and Setup
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** documentation
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The Slack Claude Relay module (src/relay/) is fully implemented with bot, handler, session-store, project-store, and config — all with tests — but is not documented anywhere. Users cannot discover this feature. .env.example has RELAY_* variables but no guide explains what the relay does, how to enable it, or use cases. This is a gap in discoverability for a working feature.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] Create docs/RELAY_SETUP.md explaining relay module purpose (Slack-to-Claude Code bridge)
- [ ] Document how to enable relay (environment variables: RELAY_MODEL, RELAY_CLI_PATH, RELAY_PROJECTS_DIR, RELAY_TIMEOUT_MS)
- [ ] Document Slack commands/syntax for triggering relay sessions
- [ ] Add "Relay Module" section to README.md with link to docs/RELAY_SETUP.md
- [ ] Include example use case (e.g., "trigger Claude Code session from Slack for quick project queries")
- [ ] Update CLAUDE.md to remove "CLI (planned)" since CLI exists and relay provides Slack interface

#### Next steps
1. Read src/relay/bot.ts and src/relay/handler.ts to understand relay workflow
2. Read src/relay/config.ts to identify all configuration options
3. Create docs/RELAY_SETUP.md with setup instructions, environment variables, usage examples
4. Add "Relay Module" section to README.md after "Slack Setup" section
5. Update CLAUDE.md interaction methods to include relay as a working feature
