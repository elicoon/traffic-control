### Fix Agent SDK Adapter Cost Calculation (costUSD Always 0)
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** In src/agent/sdk-adapter.ts line 304, costUSD is set via `result.total_cost_usd ?? 0`. The Claude Agent SDK does not provide total_cost_usd — it only returns token counts. This means costUSD is always 0, which breaks all downstream cost tracking including SpendMonitor, Reporter metrics, and any future BudgetTracker integration. The fix is to calculate cost from token counts using CostTracker from the analytics module.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] SDK adapter calculates costUSD from inputTokens and outputTokens using CostTracker.calculateCost()
- [ ] Cost calculation uses the correct model (opus/sonnet) based on agent session config
- [ ] costUSD in TokenUsage is non-zero for completed agent sessions with token usage
- [ ] SpendMonitor receives accurate cost data from agent completion events
- [ ] Unit tests verify cost calculation for both opus and sonnet models with known token counts

#### Next steps
1. Read src/agent/sdk-adapter.ts to confirm the costUSD assignment path and available token data
2. Read src/analytics/cost-tracker.ts to understand the calculateCost interface
3. Inject CostTracker (or a cost calculation function) into the SDK adapter
4. Replace the `result.total_cost_usd ?? 0` with a CostTracker calculation using input/output tokens and model type
5. Add unit tests verifying non-zero cost for known token counts
