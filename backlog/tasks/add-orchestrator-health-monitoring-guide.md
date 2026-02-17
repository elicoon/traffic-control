### Add Orchestrator Health Monitoring and Troubleshooting Guide
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** documentation
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** README and docs cover setup/features but not operational health monitoring. Users cannot answer: "Is my orchestrator running correctly?", "How do I check if agents are being spawned?", "What does healthy logging look like?", "How do I debug stuck tasks?" The verification checklist in CLAUDE.md exists but is buried in AI instructions, not user-facing. Operators need a troubleshooting guide with queries, log patterns, and remediation steps.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] Create docs/OPERATIONS.md or docs/TROUBLESHOOTING.md with health monitoring section
- [ ] Document how to verify orchestrator is running (process check, log output patterns)
- [ ] Include SQL queries to check system health (recent agent sessions, task status distribution, stuck tasks)
- [ ] Document expected log patterns for healthy operation (tick cycles, task assignments, Slack connectivity)
- [ ] Include common failure modes and remediation (database connectivity, Slack auth, agent spawn failures)
- [ ] Add "Health Monitoring" or "Troubleshooting" section to README.md with link to detailed guide
- [ ] Extract verification checklist from CLAUDE.md into user-facing operations guide

#### Next steps
1. Read CLAUDE.md "Verification Checklist" section (lines ~280-320) to extract operational checks
2. Review src/orchestrator/main-loop.ts to identify key log events for health monitoring
3. Create docs/OPERATIONS.md with sections: Health Checks, SQL Queries, Log Patterns, Common Issues
4. Document SQL queries from CLAUDE.md verification checklist with explanations
5. Add troubleshooting flowchart (e.g., "No agents spawning" → check DB → check Slack → check capacity limits)
6. Link from README.md "How It Works" section to operations guide
