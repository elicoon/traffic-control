import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from './event-bus.js';
import { createEvent, AgentSpawnedPayload } from './event-types.js';

/**
 * Helper to create a minimal agent:spawned event for load testing.
 */
function makeTestEvent(i: number) {
  const payload: AgentSpawnedPayload = {
    agentId: `agent-${i}`,
    taskId: `task-${i}`,
    model: 'opus',
    context: [],
  };
  return createEvent('agent:spawned', payload);
}

describe('EventBus stress tests', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ historySize: 100, logErrors: false });
  });

  afterEach(() => {
    bus.destroy();
  });

  describe('throughput benchmark', () => {
    it('should emit 5000 events with handlers and exceed 100 events/ms throughput', () => {
      const EVENT_COUNT = 5000;
      let received = 0;
      bus.on('agent:spawned', () => { received++; });

      const start = performance.now();
      for (let i = 0; i < EVENT_COUNT; i++) {
        bus.emit(makeTestEvent(i));
      }
      const elapsed = performance.now() - start;
      const throughput = EVENT_COUNT / elapsed;

      expect(received).toBe(EVENT_COUNT);
      expect(throughput).toBeGreaterThan(100); // >100 events/ms = >100k events/sec
      console.log(`Throughput: ${throughput.toFixed(1)} events/ms (${EVENT_COUNT} events in ${elapsed.toFixed(1)}ms)`);
    });

    it('should emit 5000 events with multiple handlers and exceed 50 events/ms throughput', () => {
      const EVENT_COUNT = 5000;
      const HANDLER_COUNT = 5;
      const counts: number[] = Array(HANDLER_COUNT).fill(0);

      for (let h = 0; h < HANDLER_COUNT; h++) {
        const idx = h;
        bus.on('agent:spawned', () => { counts[idx]++; });
      }

      const start = performance.now();
      for (let i = 0; i < EVENT_COUNT; i++) {
        bus.emit(makeTestEvent(i));
      }
      const elapsed = performance.now() - start;
      const throughput = EVENT_COUNT / elapsed;

      for (const c of counts) {
        expect(c).toBe(EVENT_COUNT);
      }
      expect(throughput).toBeGreaterThan(50); // Lower threshold with 5 handlers
      console.log(`Multi-handler throughput: ${throughput.toFixed(1)} events/ms (${HANDLER_COUNT} handlers, ${EVENT_COUNT} events in ${elapsed.toFixed(1)}ms)`);
    });
  });

  describe('memory stability', () => {
    it('should not grow heap unboundedly when emitting 10000 events', () => {
      const EVENT_COUNT = 10_000;
      let received = 0;
      bus.on('agent:spawned', () => { received++; });

      // Force GC if available, take baseline
      if (global.gc) global.gc();
      const heapBefore = process.memoryUsage().heapUsed;

      for (let i = 0; i < EVENT_COUNT; i++) {
        bus.emit(makeTestEvent(i));
      }

      if (global.gc) global.gc();
      const heapAfter = process.memoryUsage().heapUsed;

      expect(received).toBe(EVENT_COUNT);

      // History is bounded at 100 (config), so heap growth should be modest.
      // Allow up to 20MB growth to account for V8 internals and test framework overhead.
      const growthMB = (heapAfter - heapBefore) / (1024 * 1024);
      expect(growthMB).toBeLessThan(20);
      console.log(`Memory growth: ${growthMB.toFixed(2)}MB after ${EVENT_COUNT} events`);
    });

    it('should keep history buffer bounded at configured size', () => {
      const HISTORY_SIZE = 100;
      const EVENT_COUNT = 10_000;

      for (let i = 0; i < EVENT_COUNT; i++) {
        bus.emit(makeTestEvent(i));
      }

      const history = bus.getHistory();
      expect(history).toHaveLength(HISTORY_SIZE);
      // Most recent event should be the last emitted
      expect((history[history.length - 1].payload as AgentSpawnedPayload).agentId).toBe(`agent-${EVENT_COUNT - 1}`);
    });
  });

  describe('latency distribution', () => {
    it('should have p99 emit latency under 1ms for 1000 events', () => {
      const EVENT_COUNT = 1000;
      const latencies: number[] = [];

      bus.on('agent:spawned', () => {
        // Handler does minimal work — we're measuring emit() overhead
      });

      for (let i = 0; i < EVENT_COUNT; i++) {
        const start = performance.now();
        bus.emit(makeTestEvent(i));
        latencies.push(performance.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(EVENT_COUNT * 0.5)];
      const p95 = latencies[Math.floor(EVENT_COUNT * 0.95)];
      const p99 = latencies[Math.floor(EVENT_COUNT * 0.99)];

      // Conservative thresholds — should be well under these on any modern machine
      expect(p99).toBeLessThan(1); // p99 < 1ms
      expect(p95).toBeLessThan(0.5); // p95 < 0.5ms

      console.log(`Latency distribution (${EVENT_COUNT} events): p50=${p50.toFixed(4)}ms, p95=${p95.toFixed(4)}ms, p99=${p99.toFixed(4)}ms`);
    });

    it('should maintain stable latency with pattern handlers under load', () => {
      const EVENT_COUNT = 1000;
      const latencies: number[] = [];

      // Add both type handler and pattern handler
      bus.on('agent:spawned', () => {});
      bus.onPattern(/^agent:/, () => {});
      bus.onPattern(/.*/, () => {});

      for (let i = 0; i < EVENT_COUNT; i++) {
        const start = performance.now();
        bus.emit(makeTestEvent(i));
        latencies.push(performance.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(EVENT_COUNT * 0.5)];
      const p95 = latencies[Math.floor(EVENT_COUNT * 0.95)];
      const p99 = latencies[Math.floor(EVENT_COUNT * 0.99)];

      // Slightly higher thresholds with pattern matching overhead
      expect(p99).toBeLessThan(2); // p99 < 2ms
      expect(p95).toBeLessThan(1); // p95 < 1ms

      console.log(`Pattern latency (${EVENT_COUNT} events, 3 handlers): p50=${p50.toFixed(4)}ms, p95=${p95.toFixed(4)}ms, p99=${p99.toFixed(4)}ms`);
    });
  });

  describe('resource cleanup', () => {
    it('should have zero handlers after destroy following heavy load', () => {
      const EVENT_COUNT = 5000;
      const HANDLER_COUNT = 10;

      for (let h = 0; h < HANDLER_COUNT; h++) {
        bus.on('agent:spawned', () => {});
      }
      bus.onPattern(/^agent:/, () => {});
      bus.onPattern(/.*/, () => {});

      for (let i = 0; i < EVENT_COUNT; i++) {
        bus.emit(makeTestEvent(i));
      }

      // Verify handlers are registered
      expect(bus.listenerCount('agent:spawned')).toBe(HANDLER_COUNT);

      bus.destroy();

      // After destroy, everything should be cleaned up
      expect(bus.listenerCount('agent:spawned')).toBe(0);
      expect(bus.getHistory()).toHaveLength(0);
    });

    it('should properly unsubscribe all handlers after load', () => {
      const EVENT_COUNT = 1000;
      const unsubscribers: (() => void)[] = [];

      // Register many handlers
      for (let h = 0; h < 20; h++) {
        unsubscribers.push(bus.on('agent:spawned', () => {}));
      }

      // Emit under load
      for (let i = 0; i < EVENT_COUNT; i++) {
        bus.emit(makeTestEvent(i));
      }

      expect(bus.listenerCount('agent:spawned')).toBe(20);

      // Unsubscribe all via returned functions
      for (const unsub of unsubscribers) {
        unsub();
      }

      expect(bus.listenerCount('agent:spawned')).toBe(0);

      // Emit again — no handlers should fire
      let postUnsubCount = 0;
      bus.on('agent:spawned', () => { postUnsubCount++; });
      bus.emit(makeTestEvent(0));
      expect(postUnsubCount).toBe(1); // Only the new handler
    });

    it('should handle rapid subscribe/unsubscribe cycles under load', () => {
      const CYCLES = 1000;

      for (let i = 0; i < CYCLES; i++) {
        const unsub = bus.on('agent:spawned', () => {});
        bus.emit(makeTestEvent(i));
        unsub();
      }

      // After all cycles, no lingering handlers
      expect(bus.listenerCount('agent:spawned')).toBe(0);
      // History should still be bounded
      expect(bus.getHistory().length).toBeLessThanOrEqual(100);
    });
  });
});
