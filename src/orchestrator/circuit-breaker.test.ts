import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerTripReason,
  createCircuitBreaker,
} from './circuit-breaker.js';
import { EventBus } from '../events/event-bus.js';

// Mock the database client
vi.mock('../db/client.js', () => ({
  getClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })),
  })),
}));

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  let mockOnTrip: CircuitBreakerConfig['onTrip'];
  let mockSendSlackAlert: CircuitBreakerConfig['sendSlackAlert'];

  beforeEach(() => {
    mockOnTrip = vi.fn().mockResolvedValue(undefined) as CircuitBreakerConfig['onTrip'];
    mockSendSlackAlert = vi.fn().mockResolvedValue(undefined) as CircuitBreakerConfig['sendSlackAlert'];

    circuitBreaker = new CircuitBreaker({
      maxConsecutiveAgentErrors: 3,
      errorRateThreshold: 0.5,
      errorRateWindowSize: 10,
      hardBudgetLimit: 100,
      tokenLimitWithoutOutput: 100000,
      onTrip: mockOnTrip,
      sendSlackAlert: mockSendSlackAlert,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create an instance with default config', () => {
      const cb = new CircuitBreaker();
      expect(cb).toBeDefined();
      expect(cb.isTripped()).toBe(false);
    });

    it('should create an instance with partial config', () => {
      const cb = new CircuitBreaker({ maxConsecutiveAgentErrors: 5 });
      expect(cb).toBeDefined();
      expect(cb.isTripped()).toBe(false);
    });

    it('should create an instance with event bus', () => {
      const eventBus = new EventBus();
      const cb = new CircuitBreaker({}, eventBus);
      expect(cb).toBeDefined();
    });

    it('should use factory function to create instance', () => {
      const cb = createCircuitBreaker({ maxConsecutiveAgentErrors: 2 });
      expect(cb).toBeDefined();
      expect(cb.isTripped()).toBe(false);
    });
  });

  describe('recordSuccess', () => {
    it('should reset consecutive error count for agent on success', () => {
      const agentId = 'agent-1';

      // Record some errors first
      circuitBreaker.recordError(agentId, new Error('Error 1'));
      circuitBreaker.recordError(agentId, new Error('Error 2'));
      expect(circuitBreaker.getAgentErrorCount(agentId)).toBe(2);

      // Record success
      circuitBreaker.recordSuccess(agentId);
      expect(circuitBreaker.getAgentErrorCount(agentId)).toBe(0);
    });

    it('should track tokens and cost', () => {
      circuitBreaker.recordSuccess('agent-1', { tokensUsed: 1000, costUSD: 0.05 });
      circuitBreaker.recordSuccess('agent-2', { tokensUsed: 2000, costUSD: 0.10 });

      const status = circuitBreaker.getStatus();
      expect(status.totalTokensConsumed).toBe(3000);
      expect(status.totalSpend).toBeCloseTo(0.15);
    });

    it('should track meaningful outputs', () => {
      circuitBreaker.recordSuccess('agent-1', { hasMeaningfulOutput: true });
      circuitBreaker.recordSuccess('agent-2', { hasMeaningfulOutput: true });
      circuitBreaker.recordSuccess('agent-3', { hasMeaningfulOutput: false });

      const status = circuitBreaker.getStatus();
      expect(status.meaningfulOutputCount).toBe(2);
    });

    it('should add to recent operations', () => {
      circuitBreaker.recordSuccess('agent-1');
      circuitBreaker.recordSuccess('agent-2');

      const status = circuitBreaker.getStatus();
      expect(status.recentOperations.length).toBe(2);
      expect(status.recentOperations[0].success).toBe(true);
      expect(status.recentOperations[1].success).toBe(true);
    });

    it('should not record success when circuit breaker is tripped', () => {
      circuitBreaker.trip('manual', 'Manual trip for testing');

      circuitBreaker.recordSuccess('agent-1', { tokensUsed: 1000 });

      // Tokens should not be recorded
      const status = circuitBreaker.getStatus();
      expect(status.totalTokensConsumed).toBe(0);
    });
  });

  describe('recordError', () => {
    it('should increment consecutive error count for agent', () => {
      const agentId = 'agent-1';

      circuitBreaker.recordError(agentId, new Error('Error 1'));
      expect(circuitBreaker.getAgentErrorCount(agentId)).toBe(1);

      circuitBreaker.recordError(agentId, new Error('Error 2'));
      expect(circuitBreaker.getAgentErrorCount(agentId)).toBe(2);
    });

    it('should track errors per agent independently', () => {
      circuitBreaker.recordError('agent-1', new Error('Error'));
      circuitBreaker.recordError('agent-1', new Error('Error'));
      circuitBreaker.recordError('agent-2', new Error('Error'));

      expect(circuitBreaker.getAgentErrorCount('agent-1')).toBe(2);
      expect(circuitBreaker.getAgentErrorCount('agent-2')).toBe(1);
    });

    it('should track tokens and cost even for errors', () => {
      circuitBreaker.recordError('agent-1', new Error('Error'), { tokensUsed: 500, costUSD: 0.02 });

      const status = circuitBreaker.getStatus();
      expect(status.totalTokensConsumed).toBe(500);
      expect(status.totalSpend).toBe(0.02);
    });

    it('should add to recent operations', () => {
      circuitBreaker.recordError('agent-1', new Error('Test error'));

      const status = circuitBreaker.getStatus();
      expect(status.recentOperations.length).toBe(1);
      expect(status.recentOperations[0].success).toBe(false);
      expect(status.recentOperations[0].error?.message).toBe('Test error');
    });

    it('should not record error when circuit breaker is tripped', () => {
      circuitBreaker.trip('manual', 'Manual trip for testing');

      circuitBreaker.recordError('agent-1', new Error('Error'));

      const status = circuitBreaker.getStatus();
      expect(status.recentOperations.length).toBe(0);
      expect(circuitBreaker.getAgentErrorCount('agent-1')).toBe(0);
    });
  });

  describe('consecutive agent errors trigger', () => {
    it('should trip when agent has 3 consecutive errors', () => {
      const agentId = 'agent-1';

      circuitBreaker.recordError(agentId, new Error('Error 1'));
      expect(circuitBreaker.isTripped()).toBe(false);

      circuitBreaker.recordError(agentId, new Error('Error 2'));
      expect(circuitBreaker.isTripped()).toBe(false);

      circuitBreaker.recordError(agentId, new Error('Error 3'));
      expect(circuitBreaker.isTripped()).toBe(true);

      const status = circuitBreaker.getStatus();
      expect(status.tripReason).toBe('consecutive_agent_errors');
      expect(status.triggeringAgentId).toBe(agentId);
    });

    it('should trip when configured threshold is exceeded', () => {
      const cb = new CircuitBreaker({
        maxConsecutiveAgentErrors: 2,
        onTrip: mockOnTrip,
      });

      cb.recordError('agent-1', new Error('Error 1'));
      expect(cb.isTripped()).toBe(false);

      cb.recordError('agent-1', new Error('Error 2'));
      expect(cb.isTripped()).toBe(true);
    });

    it('should call onTrip callback with correct parameters', async () => {
      circuitBreaker.recordError('agent-1', new Error('Error 1'));
      circuitBreaker.recordError('agent-1', new Error('Error 2'));
      circuitBreaker.recordError('agent-1', new Error('Error 3'));

      // Wait for async callback
      await vi.waitFor(() => {
        expect(mockOnTrip).toHaveBeenCalledWith(
          'consecutive_agent_errors',
          expect.stringContaining('agent-1')
        );
      });
    });

    it('should send Slack alert when tripped', async () => {
      circuitBreaker.recordError('agent-1', new Error('Error 1'));
      circuitBreaker.recordError('agent-1', new Error('Error 2'));
      circuitBreaker.recordError('agent-1', new Error('Error 3'));

      await vi.waitFor(() => {
        expect(mockSendSlackAlert).toHaveBeenCalledWith(
          expect.stringContaining('CIRCUIT BREAKER TRIPPED'),
          'high'
        );
      });
    });

    it('should reset error count on success and not trip', () => {
      circuitBreaker.recordError('agent-1', new Error('Error 1'));
      circuitBreaker.recordError('agent-1', new Error('Error 2'));
      circuitBreaker.recordSuccess('agent-1');
      circuitBreaker.recordError('agent-1', new Error('Error 3'));
      circuitBreaker.recordError('agent-1', new Error('Error 4'));

      expect(circuitBreaker.isTripped()).toBe(false);
      expect(circuitBreaker.getAgentErrorCount('agent-1')).toBe(2);
    });
  });

  describe('global error rate trigger', () => {
    it('should trip when error rate exceeds 50% in last 10 operations', () => {
      // Fill window with 10 operations - 6 errors, 4 successes = 60% error rate
      for (let i = 0; i < 4; i++) {
        circuitBreaker.recordSuccess(`agent-${i}`);
      }
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordError(`agent-error-${i}`, new Error(`Error ${i}`));
      }

      expect(circuitBreaker.isTripped()).toBe(false);

      // One more error tips it over 50%
      circuitBreaker.recordError('agent-error-5', new Error('Error 5'));
      expect(circuitBreaker.isTripped()).toBe(true);

      const status = circuitBreaker.getStatus();
      expect(status.tripReason).toBe('global_error_rate');
    });

    it('should not trip if window is not full yet', () => {
      // Only 5 operations - all errors but window not full
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordError(`agent-${i}`, new Error(`Error ${i}`));
      }

      expect(circuitBreaker.isTripped()).toBe(false);
      expect(circuitBreaker.getErrorRate()).toBe(1.0); // 100% error rate
    });

    it('should calculate error rate correctly', () => {
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordSuccess(`agent-${i}`);
      }
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordError(`agent-error-${i}`, new Error(`Error ${i}`));
      }

      // 3 errors / 8 total = 37.5%
      expect(circuitBreaker.getErrorRate()).toBeCloseTo(0.375);
    });

    it('should use configurable threshold', () => {
      const cb = new CircuitBreaker({
        errorRateThreshold: 0.3, // 30%
        errorRateWindowSize: 10,
        maxConsecutiveAgentErrors: 10, // High to avoid consecutive trigger
        onTrip: mockOnTrip,
      });

      // 7 successes, 3 errors = 30% error rate (not over)
      for (let i = 0; i < 7; i++) {
        cb.recordSuccess(`agent-${i}`);
      }
      for (let i = 0; i < 3; i++) {
        cb.recordError(`agent-error-${i}`, new Error(`Error ${i}`));
      }

      expect(cb.isTripped()).toBe(false);

      // Add more to push over threshold
      for (let i = 0; i < 7; i++) {
        cb.recordSuccess(`agent-${i + 10}`);
      }
      // Now window is: 7 successes, 3 errors still in window
      // Actually the window slides, let's check the rate
      // After 17 operations with window of 10, we have last 10

      // Reset and test fresh
      const cb2 = new CircuitBreaker({
        errorRateThreshold: 0.3,
        errorRateWindowSize: 10,
        maxConsecutiveAgentErrors: 10,
        onTrip: mockOnTrip,
      });

      for (let i = 0; i < 6; i++) {
        cb2.recordSuccess(`agent-${i}`);
      }
      for (let i = 0; i < 4; i++) {
        cb2.recordError(`agent-error-${i}`, new Error(`Error ${i}`));
      }
      // 4/10 = 40% > 30%
      expect(cb2.isTripped()).toBe(true);
    });
  });

  describe('budget exceeded trigger', () => {
    it('should trip when total spend reaches hard budget limit', () => {
      const cb = new CircuitBreaker({
        hardBudgetLimit: 1.0,
        maxConsecutiveAgentErrors: 10,
        onTrip: mockOnTrip,
      });

      cb.recordSuccess('agent-1', { costUSD: 0.4 });
      expect(cb.isTripped()).toBe(false);

      cb.recordSuccess('agent-2', { costUSD: 0.4 });
      expect(cb.isTripped()).toBe(false);

      cb.recordSuccess('agent-3', { costUSD: 0.3 });
      // Total: 1.1 >= 1.0
      expect(cb.isTripped()).toBe(true);

      const status = cb.getStatus();
      expect(status.tripReason).toBe('budget_exceeded');
    });

    it('should include error costs in budget calculation', () => {
      const cb = new CircuitBreaker({
        hardBudgetLimit: 1.0,
        maxConsecutiveAgentErrors: 10,
        onTrip: mockOnTrip,
      });

      cb.recordSuccess('agent-1', { costUSD: 0.5 });
      cb.recordError('agent-2', new Error('Error'), { costUSD: 0.6 });
      // Total: 1.1 >= 1.0

      expect(cb.isTripped()).toBe(true);
      expect(cb.getStatus().tripReason).toBe('budget_exceeded');
    });
  });

  describe('token limit without meaningful output trigger', () => {
    it('should trip when tokens exceed limit without meaningful output', () => {
      const cb = new CircuitBreaker({
        tokenLimitWithoutOutput: 10000,
        maxConsecutiveAgentErrors: 10,
        onTrip: mockOnTrip,
      });

      cb.recordSuccess('agent-1', { tokensUsed: 5000, hasMeaningfulOutput: false });
      expect(cb.isTripped()).toBe(false);

      cb.recordSuccess('agent-2', { tokensUsed: 6000, hasMeaningfulOutput: false });
      // Total without output: 11000 >= 10000
      expect(cb.isTripped()).toBe(true);

      const status = cb.getStatus();
      expect(status.tripReason).toBe('token_limit_exceeded');
    });

    it('should reset token counter when meaningful output received', () => {
      const cb = new CircuitBreaker({
        tokenLimitWithoutOutput: 10000,
        maxConsecutiveAgentErrors: 10,
        onTrip: mockOnTrip,
      });

      cb.recordSuccess('agent-1', { tokensUsed: 5000, hasMeaningfulOutput: false });
      cb.recordSuccess('agent-2', { tokensUsed: 3000, hasMeaningfulOutput: true }); // Reset counter
      cb.recordSuccess('agent-3', { tokensUsed: 5000, hasMeaningfulOutput: false });
      cb.recordSuccess('agent-4', { tokensUsed: 4000, hasMeaningfulOutput: false });

      // Counter should be 9000 (5000 + 4000) since last meaningful output
      expect(cb.isTripped()).toBe(false);

      cb.recordSuccess('agent-5', { tokensUsed: 2000, hasMeaningfulOutput: false });
      // Now 11000 >= 10000
      expect(cb.isTripped()).toBe(true);
    });

    it('should count error tokens toward limit', () => {
      const cb = new CircuitBreaker({
        tokenLimitWithoutOutput: 10000,
        maxConsecutiveAgentErrors: 10,
        onTrip: mockOnTrip,
      });

      cb.recordSuccess('agent-1', { tokensUsed: 5000, hasMeaningfulOutput: false });
      cb.recordError('agent-2', new Error('Error'), { tokensUsed: 6000 });
      // Total without output: 11000 >= 10000

      expect(cb.isTripped()).toBe(true);
      expect(cb.getStatus().tripReason).toBe('token_limit_exceeded');
    });
  });

  describe('trip', () => {
    it('should manually trip the circuit breaker', () => {
      circuitBreaker.trip('manual', 'Manually tripped for testing');

      expect(circuitBreaker.isTripped()).toBe(true);
      const status = circuitBreaker.getStatus();
      expect(status.tripReason).toBe('manual');
      expect(status.tripMessage).toBe('Manually tripped for testing');
      expect(status.trippedAt).toBeDefined();
    });

    it('should ignore additional trips when already tripped', () => {
      circuitBreaker.trip('manual', 'First trip');
      circuitBreaker.trip('budget_exceeded', 'Second trip');

      const status = circuitBreaker.getStatus();
      expect(status.tripReason).toBe('manual');
      expect(status.tripMessage).toBe('First trip');
    });

    it('should call onTrip callback', async () => {
      circuitBreaker.trip('manual', 'Test trip');

      await vi.waitFor(() => {
        expect(mockOnTrip).toHaveBeenCalledWith('manual', 'Test trip');
      });
    });

    it('should emit event to event bus', async () => {
      const eventBus = new EventBus();
      const handler = vi.fn();
      eventBus.on('system:error', handler);

      const cb = new CircuitBreaker({}, eventBus);
      cb.trip('manual', 'Test trip');

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'system:error',
            payload: expect.objectContaining({
              component: 'circuit-breaker',
            }),
          })
        );
      });
    });

    it('should send formatted Slack alert', async () => {
      circuitBreaker.trip('budget_exceeded', 'Budget exceeded', 'agent-1');

      await vi.waitFor(() => {
        expect(mockSendSlackAlert).toHaveBeenCalledWith(
          expect.stringContaining('CIRCUIT BREAKER TRIPPED'),
          'high'
        );
        expect(mockSendSlackAlert).toHaveBeenCalledWith(
          expect.stringContaining('Budget Limit Exceeded'),
          'high'
        );
        expect(mockSendSlackAlert).toHaveBeenCalledWith(
          expect.stringContaining('/tc circuit-breaker reset'),
          'high'
        );
      });
    });
  });

  describe('reset', () => {
    it('should reset the circuit breaker', () => {
      circuitBreaker.trip('manual', 'Test trip');
      expect(circuitBreaker.isTripped()).toBe(true);

      circuitBreaker.reset();
      expect(circuitBreaker.isTripped()).toBe(false);
    });

    it('should clear all counters and state', () => {
      // Build up some state
      circuitBreaker.recordError('agent-1', new Error('Error 1'));
      circuitBreaker.recordError('agent-1', new Error('Error 2'));
      circuitBreaker.recordSuccess('agent-2', { tokensUsed: 5000, costUSD: 0.05 });
      circuitBreaker.trip('manual', 'Test trip');

      circuitBreaker.reset();

      const status = circuitBreaker.getStatus();
      expect(status.isTripped).toBe(false);
      expect(status.tripReason).toBeUndefined();
      expect(status.tripMessage).toBeUndefined();
      expect(status.trippedAt).toBeUndefined();
      expect(status.triggeringAgentId).toBeUndefined();
      expect(status.agentErrorCounts.size).toBe(0);
      expect(status.recentOperations.length).toBe(0);
      expect(status.totalTokensConsumed).toBe(0);
      expect(status.totalSpend).toBe(0);
      expect(status.meaningfulOutputCount).toBe(0);
    });

    it('should do nothing if not tripped', () => {
      expect(circuitBreaker.isTripped()).toBe(false);
      circuitBreaker.reset();
      expect(circuitBreaker.isTripped()).toBe(false);
    });

    it('should allow operations to resume after reset', () => {
      circuitBreaker.trip('manual', 'Test trip');
      expect(circuitBreaker.isTripped()).toBe(true);

      circuitBreaker.reset();

      // Should be able to record operations again
      circuitBreaker.recordSuccess('agent-1', { tokensUsed: 1000 });
      const status = circuitBreaker.getStatus();
      expect(status.totalTokensConsumed).toBe(1000);
    });
  });

  describe('getStatus', () => {
    it('should return current status', () => {
      const status = circuitBreaker.getStatus();

      expect(status.isTripped).toBe(false);
      expect(status.tripReason).toBeUndefined();
      expect(status.agentErrorCounts).toBeInstanceOf(Map);
      expect(status.recentOperations).toEqual([]);
      expect(status.totalTokensConsumed).toBe(0);
      expect(status.totalSpend).toBe(0);
      expect(status.meaningfulOutputCount).toBe(0);
    });

    it('should return tripped status', () => {
      circuitBreaker.trip('manual', 'Test trip', 'agent-1');

      const status = circuitBreaker.getStatus();
      expect(status.isTripped).toBe(true);
      expect(status.tripReason).toBe('manual');
      expect(status.tripMessage).toBe('Test trip');
      expect(status.trippedAt).toBeDefined();
      expect(status.triggeringAgentId).toBe('agent-1');
    });

    it('should return copy of data, not references', () => {
      circuitBreaker.recordError('agent-1', new Error('Error'));
      const status = circuitBreaker.getStatus();

      // Modifying returned data should not affect internal state
      status.agentErrorCounts.set('agent-1', 999);
      status.recentOperations.push({
        agentId: 'fake',
        success: true,
        timestamp: new Date(),
      });

      const newStatus = circuitBreaker.getStatus();
      expect(newStatus.agentErrorCounts.get('agent-1')).toBe(1);
      expect(newStatus.recentOperations.length).toBe(1);
    });
  });

  describe('getErrorRate', () => {
    it('should return 0 when no operations', () => {
      expect(circuitBreaker.getErrorRate()).toBe(0);
    });

    it('should return correct error rate', () => {
      circuitBreaker.recordSuccess('agent-1');
      circuitBreaker.recordSuccess('agent-2');
      circuitBreaker.recordError('agent-3', new Error('Error'));
      circuitBreaker.recordSuccess('agent-4');

      // 1 error / 4 total = 25%
      expect(circuitBreaker.getErrorRate()).toBe(0.25);
    });
  });

  describe('getAgentErrorCount', () => {
    it('should return 0 for unknown agent', () => {
      expect(circuitBreaker.getAgentErrorCount('unknown-agent')).toBe(0);
    });

    it('should return correct count for known agent', () => {
      circuitBreaker.recordError('agent-1', new Error('Error 1'));
      circuitBreaker.recordError('agent-1', new Error('Error 2'));

      expect(circuitBreaker.getAgentErrorCount('agent-1')).toBe(2);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      // Trip should require 5 errors now
      circuitBreaker.updateConfig({ maxConsecutiveAgentErrors: 5 });

      for (let i = 0; i < 4; i++) {
        circuitBreaker.recordError('agent-1', new Error(`Error ${i}`));
      }
      expect(circuitBreaker.isTripped()).toBe(false);

      circuitBreaker.recordError('agent-1', new Error('Error 5'));
      expect(circuitBreaker.isTripped()).toBe(true);
    });

    it('should allow partial config updates', () => {
      const original = circuitBreaker.getStatus();
      circuitBreaker.updateConfig({ hardBudgetLimit: 500 });

      // Should only update the specified field
      const cb = new CircuitBreaker({ hardBudgetLimit: 500 });
      circuitBreaker.recordSuccess('agent-1', { costUSD: 200 });
      expect(circuitBreaker.isTripped()).toBe(false);
    });
  });

  describe('sliding window', () => {
    it('should maintain window size', () => {
      const cb = new CircuitBreaker({ errorRateWindowSize: 5 });

      for (let i = 0; i < 10; i++) {
        cb.recordSuccess(`agent-${i}`);
      }

      const status = cb.getStatus();
      expect(status.recentOperations.length).toBe(5);
    });

    it('should remove oldest operations when window is exceeded', () => {
      const cb = new CircuitBreaker({ errorRateWindowSize: 3 });

      cb.recordSuccess('agent-1');
      cb.recordSuccess('agent-2');
      cb.recordSuccess('agent-3');
      cb.recordError('agent-4', new Error('Error'));

      const status = cb.getStatus();
      expect(status.recentOperations.length).toBe(3);
      expect(status.recentOperations[0].agentId).toBe('agent-2');
      expect(status.recentOperations[2].agentId).toBe('agent-4');
    });
  });

  describe('callback error handling', () => {
    it('should handle onTrip callback error gracefully', async () => {
      const failingOnTrip = vi.fn().mockRejectedValue(new Error('Callback failed'));
      const cb = new CircuitBreaker({ onTrip: failingOnTrip });

      // Should not throw
      expect(() => cb.trip('manual', 'Test')).not.toThrow();
      expect(cb.isTripped()).toBe(true);

      // Wait for async callback to be called
      await vi.waitFor(() => {
        expect(failingOnTrip).toHaveBeenCalled();
      });
    });

    it('should handle sendSlackAlert error gracefully', async () => {
      const failingAlert = vi.fn().mockRejectedValue(new Error('Slack failed'));
      const cb = new CircuitBreaker({ sendSlackAlert: failingAlert });

      expect(() => cb.trip('manual', 'Test')).not.toThrow();
      expect(cb.isTripped()).toBe(true);

      await vi.waitFor(() => {
        expect(failingAlert).toHaveBeenCalled();
      });
    });
  });

  describe('priority order of trip reasons', () => {
    it('should trip for consecutive errors before global error rate', () => {
      const cb = new CircuitBreaker({
        maxConsecutiveAgentErrors: 3,
        errorRateThreshold: 0.5,
        errorRateWindowSize: 10,
      });

      // Fill window with operations to make error rate calculable
      for (let i = 0; i < 7; i++) {
        cb.recordSuccess(`agent-${i}`);
      }

      // Now add 3 consecutive errors from same agent
      cb.recordError('target-agent', new Error('Error 1'));
      cb.recordError('target-agent', new Error('Error 2'));
      cb.recordError('target-agent', new Error('Error 3'));

      const status = cb.getStatus();
      expect(status.isTripped).toBe(true);
      expect(status.tripReason).toBe('consecutive_agent_errors');
      expect(status.triggeringAgentId).toBe('target-agent');
    });
  });

  describe('edge cases', () => {
    it('should handle zero token/cost values', () => {
      circuitBreaker.recordSuccess('agent-1', { tokensUsed: 0, costUSD: 0 });

      const status = circuitBreaker.getStatus();
      expect(status.totalTokensConsumed).toBe(0);
      expect(status.totalSpend).toBe(0);
    });

    it('should handle undefined options in recordSuccess', () => {
      circuitBreaker.recordSuccess('agent-1');
      circuitBreaker.recordSuccess('agent-2', {});

      const status = circuitBreaker.getStatus();
      expect(status.totalTokensConsumed).toBe(0);
      expect(status.totalSpend).toBe(0);
      expect(status.meaningfulOutputCount).toBe(2); // Default is true
    });

    it('should handle undefined options in recordError', () => {
      circuitBreaker.recordError('agent-1', new Error('Error'));
      circuitBreaker.recordError('agent-2', new Error('Error'), {});

      const status = circuitBreaker.getStatus();
      expect(status.totalTokensConsumed).toBe(0);
      expect(status.totalSpend).toBe(0);
    });

    it('should handle empty string agentId', () => {
      circuitBreaker.recordSuccess('');
      circuitBreaker.recordError('', new Error('Error'));

      expect(circuitBreaker.getAgentErrorCount('')).toBe(1);
    });
  });
});
