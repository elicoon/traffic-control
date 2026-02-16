### Fix CostTracker $0 Fallback When Database Pricing Is Unavailable
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** CostTracker falls back to $0 USD when tc_model_pricing is unavailable (DB outage or empty table). This means during degraded mode, all cost calculations report zero — defeating the purpose of spend monitoring and budget enforcement. The system had a $40+ cost burn incident precisely because cost controls failed. The fix should use hardcoded known-good pricing (Opus: $15/$75 per 1M tokens, Sonnet: $3/$15) as the fallback instead of $0, matching the values that were previously hardcoded in the dashboard before the CostTracker refactor.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] CostTracker uses hardcoded fallback prices (Opus input $15/M, output $75/M; Sonnet input $3/M, output $15/M) when DB pricing is unavailable
- [ ] A warning is logged when fallback pricing is used (not silently defaulting)
- [ ] SpendMonitor and BudgetTracker receive non-zero costs even during DB outages
- [ ] At least 2 tests verify fallback pricing behavior (DB unavailable returns hardcoded prices, DB available returns DB prices)
- [ ] `npm run build` and `npm test` pass

#### Next steps
1. Read `src/analytics/cost-tracker.ts` to find the fallback pricing logic and current $0 default
2. Replace the $0 default with hardcoded known-good pricing constants
3. Add a log.warn when falling back to hardcoded pricing
4. Add tests in `src/analytics/cost-tracker.test.ts` for the fallback path
5. Run `npm test` and `npm run build` to verify
