# Learnings Index

Index of all learnings tracked by TrafficControl.

## Statistics

- Total Learnings: 5
- Global Learnings: 5
- Retrospective Documents: 4
- Project-Specific Learnings: 0

## Categories

### Cost Control & Safety
- Count: 7
- Key Sources: 2026-01-27-api-cost-burn-incident.md

### Verification & Testing
- Count: 5
- Key Sources: 2026-01-26-failed-launch-retrospective.md, 2026-01-27-api-burn-failure-analysis.md, 2026-01-27-slack-relay-testing-gap.md

### Communication & Process
- Count: 3
- Key Sources: 2026-01-26-failed-launch-retrospective.md

### Architecture
- Count: 0

### Tooling
- Count: 0

### Project-Specific
- Count: 0

## Recent Learnings

<!-- RECENT_LEARNINGS_START -->
- [2026-01-27] [MEDIUM] Slack Relay Testing Gap - "It Works" vs "It Actually Works"
  - File: [2026-01-27-slack-relay-testing-gap.md](./2026-01-27-slack-relay-testing-gap.md)
  - Summary: Multiple failed iterations where unit tests passed but Slack integration didn't work
  - Key Learnings: Unit tests cannot verify OAuth scopes, event subscriptions, or real API behavior
  - Includes: Checklist for Slack changes, response templates, explicit test limitations

- [2026-01-27] [CRITICAL] API Cost Burn Incident - Comprehensive Retrospective
  - File: [2026-01-27-api-cost-burn-incident.md](./2026-01-27-api-cost-burn-incident.md)
  - Summary: $40 burned in 2 minutes - 15 agents processing 70+ test tasks
  - Key Learnings: Cost controls first, safe defaults, pre-flight checks, dry-run mode, circuit breakers
  - Includes: Concrete code changes, process changes, implementation plan

- [2026-01-27] [CRITICAL] API Burn Failure Analysis - Deep dive into why Claude failed to prevent $40 loss
  - File: [2026-01-27-api-burn-failure-analysis.md](./2026-01-27-api-burn-failure-analysis.md)
  - Key Learnings: Verify destructive operations, treat errors as blockers, query state before recommending actions, never claim done without evidence

- [2026-01-26] [HIGH] Failed Launch Retrospective - $40 wasted due to unverified cleanup and missing safeguards
  - File: [2026-01-26-failed-launch-retrospective.md](./2026-01-26-failed-launch-retrospective.md)
  - Key Learnings: Verify with queries not words, warn before expensive ops, recommend conservative paths
<!-- RECENT_LEARNINGS_END -->
