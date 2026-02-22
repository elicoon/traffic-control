# TrafficControl Performance Baselines

> Last updated: 2026-02-21
> Run with: `npm run benchmark`

## Scheduler Performance (150 queued tasks)

| Metric | Value |
|--------|-------|
| Avg getNextForModel | 0.058ms |
| P95 getNextForModel | 0.103ms |
| Max getNextForModel | 0.314ms |
| Enqueue 200 tasks | 1.318ms |
| Dequeue 200 tasks | 7.524ms |

**Threshold:** P95 must stay under 10ms per call.

## Capacity Tracker (8 concurrent agents)

| Metric | Value |
|--------|-------|
| Reserve/release/verify cycle (8 agents) | 1.915ms |
| 1000 reserve/release cycles total | 21.212ms |
| Per-cycle avg | 0.0212ms |

**Threshold:** 8-agent cycle must stay under 50ms. 1000 cycles under 100ms.

## Throughput (50 tasks, mock agents)

| Metric | Value |
|--------|-------|
| Tasks scheduled | 50 |
| Total time | 7.838ms |
| Throughput | 382,763 tasks/minute |
| Avg per task | 0.157ms |

**Threshold:** Must exceed 1,000 tasks/minute with mock agents.

## MainLoop Tick Latency (100 event cycles)

| Metric | Value |
|--------|-------|
| Avg | 0.213ms |
| P50 | 0.166ms |
| P95 | 0.321ms |
| P99 | 1.715ms |

**Threshold:** P99 must stay under 1,000ms.

## Memory Usage (500 enqueue/dequeue cycles)

| Metric | Value |
|--------|-------|
| Heap baseline | 22.53MB |
| Heap after | 23.89MB |
| Growth | 1.36MB |
| RSS | 118.87MB |

**Threshold:** Heap growth must stay under 10MB for 500 cycles.

## Running Benchmarks

```bash
npm run benchmark
```

Results are printed to stdout. All benchmarks must pass their assertion thresholds.
