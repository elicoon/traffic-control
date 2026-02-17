### Add Performance Benchmarks for Multi-Agent Capacity
- **Project:** TrafficControl
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** TrafficControl claims to handle multi-agent orchestration and maximize capacity utilization, but there are no performance benchmarks validating these claims. Need benchmarks that measure throughput, capacity tracking accuracy, and system behavior under load.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Benchmark tests measure task throughput (tasks/minute) with mock agents
- [ ] Benchmark validates capacity tracker accuracy with 5+ concurrent agents
- [ ] Benchmark measures main loop tick time under load (should stay under 1 second)
- [ ] Benchmark tests scheduler performance with 100+ queued tasks
- [ ] Results are logged with metrics: throughput, tick time, memory usage
- [ ] Benchmarks can be run via npm run benchmark
- [ ] Baseline performance numbers documented in docs/PERFORMANCE.md

#### Next steps
1. Create src/__tests__/benchmarks/ directory
2. Add benchmark test: multi-agent-capacity.benchmark.test.ts
3. Set up mock agent adapter for performance testing
4. Implement throughput and latency measurements
5. Add npm run benchmark script
6. Run baseline benchmarks and document results in docs/PERFORMANCE.md
7. Set performance regression thresholds for CI
