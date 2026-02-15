### Replace Hardcoded Token Costs in Dashboard with CostTracker from Analytics
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The Dashboard server (src/dashboard/server.ts) has hardcoded token costs (Opus input $15/M, output $75/M; Sonnet input $3/M, output $15/M) and uses a 50/50 input/output split assumption. The analytics module already has a CostTracker and model pricing stored in the tc_model_pricing database table. The dashboard should use the existing CostTracker instead of hardcoded values to ensure cost calculations stay accurate when pricing changes. This also eliminates the inaccurate 50/50 token split assumption since the CostTracker tracks actual input vs output tokens.
- **Added:** 2026-02-14
- **Updated:** 2026-02-14

#### Acceptance Criteria
- [ ] Dashboard server imports and uses CostTracker (or queries tc_model_pricing) instead of hardcoded cost constants
- [ ] Cost calculations use actual input/output token counts instead of 50/50 split assumption
- [ ] /api/status and /api/metrics endpoints return costs consistent with what CostTracker reports
- [ ] Existing dashboard tests updated to reflect new cost calculation path
- [ ] No hardcoded dollar-per-token values remain in src/dashboard/

#### Next steps
1. Read `src/analytics/` to understand CostTracker's public API and how it retrieves pricing
2. Read `src/dashboard/server.ts` to locate all hardcoded cost constants and the calculation logic
3. Replace hardcoded constants with CostTracker dependency injection or tc_model_pricing query
4. Update cost calculation to use actual input/output token breakdown
5. Update dashboard tests to mock CostTracker instead of hardcoded values
