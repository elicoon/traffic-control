import { describe, it, expect, beforeEach } from 'vitest';
import {
  DelegationMetricsManager,
  DelegationMetrics,
  DelegationOutcome,
} from './delegation-metrics.js';

describe('DelegationMetricsManager', () => {
  let manager: DelegationMetricsManager;

  beforeEach(() => {
    manager = new DelegationMetricsManager();
  });

  describe('constructor', () => {
    it('should create an instance with default config', () => {
      expect(manager).toBeDefined();
      const config = manager.getConfig();
      expect(config.maxRetainedDelegations).toBe(1000);
      expect(config.autoCleanup).toBe(true);
    });

    it('should create an instance with custom config', () => {
      const customManager = new DelegationMetricsManager({
        maxRetainedDelegations: 500,
        autoCleanup: false,
      });

      const config = customManager.getConfig();
      expect(config.maxRetainedDelegations).toBe(500);
      expect(config.autoCleanup).toBe(false);
    });

    it('should merge partial custom config with defaults', () => {
      const customManager = new DelegationMetricsManager({
        maxRetainedDelegations: 250,
      });

      const config = customManager.getConfig();
      expect(config.maxRetainedDelegations).toBe(250);
      expect(config.autoCleanup).toBe(true); // default
    });
  });

  describe('recordDelegation', () => {
    it('should record a new delegation with provided data', () => {
      const delegation = manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      expect(delegation.id).toBeDefined();
      expect(delegation.taskId).toBe('task-123');
      expect(delegation.sessionId).toBe('session-456');
      expect(delegation.model).toBe('opus');
      expect(delegation.contextTokens).toBe(5000);
      expect(delegation.status).toBe('active');
      expect(delegation.outcome).toBeNull();
      expect(delegation.askedQuestions).toBe(false);
      expect(delegation.questionCount).toBe(0);
      expect(delegation.startedAt).toBeInstanceOf(Date);
      expect(delegation.completedAt).toBeNull();
      expect(delegation.durationMs).toBeNull();
    });

    it('should generate unique IDs for each delegation', () => {
      const d1 = manager.recordDelegation({
        taskId: 'task-1',
        sessionId: 'session-1',
        model: 'opus',
        contextTokens: 1000,
      });

      const d2 = manager.recordDelegation({
        taskId: 'task-2',
        sessionId: 'session-2',
        model: 'sonnet',
        contextTokens: 2000,
      });

      expect(d1.id).not.toBe(d2.id);
    });

    it('should record different model types', () => {
      const opus = manager.recordDelegation({
        taskId: 'task-1',
        sessionId: 'session-1',
        model: 'opus',
        contextTokens: 1000,
      });

      const sonnet = manager.recordDelegation({
        taskId: 'task-2',
        sessionId: 'session-2',
        model: 'sonnet',
        contextTokens: 1000,
      });

      const haiku = manager.recordDelegation({
        taskId: 'task-3',
        sessionId: 'session-3',
        model: 'haiku',
        contextTokens: 1000,
      });

      expect(opus.model).toBe('opus');
      expect(sonnet.model).toBe('sonnet');
      expect(haiku.model).toBe('haiku');
    });
  });

  describe('recordQuestion', () => {
    it('should mark delegation as having asked questions', () => {
      const delegation = manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      expect(delegation.askedQuestions).toBe(false);
      expect(delegation.questionCount).toBe(0);

      manager.recordQuestion('session-456');

      const updated = manager.getBySessionId('session-456');
      expect(updated?.askedQuestions).toBe(true);
      expect(updated?.questionCount).toBe(1);
    });

    it('should increment question count for multiple questions', () => {
      manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      manager.recordQuestion('session-456');
      manager.recordQuestion('session-456');
      manager.recordQuestion('session-456');

      const delegation = manager.getBySessionId('session-456');
      expect(delegation?.questionCount).toBe(3);
    });

    it('should not throw for unknown session ID', () => {
      expect(() => manager.recordQuestion('unknown-session')).not.toThrow();
    });
  });

  describe('completeDelegation', () => {
    it('should complete delegation with success outcome', () => {
      manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      const completed = manager.completeDelegation('session-456', {
        outcome: 'success',
      });

      expect(completed).toBeDefined();
      expect(completed?.status).toBe('completed');
      expect(completed?.outcome).toBe('success');
      expect(completed?.completedAt).toBeInstanceOf(Date);
      expect(completed?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should complete delegation with failure outcome', () => {
      manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      const completed = manager.completeDelegation('session-456', {
        outcome: 'failure',
        errorMessage: 'Task failed due to error',
      });

      expect(completed?.status).toBe('failed');
      expect(completed?.outcome).toBe('failure');
      expect(completed?.errorMessage).toBe('Task failed due to error');
    });

    it('should complete delegation with timeout outcome', () => {
      manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      const completed = manager.completeDelegation('session-456', {
        outcome: 'timeout',
      });

      expect(completed?.status).toBe('failed');
      expect(completed?.outcome).toBe('timeout');
    });

    it('should complete delegation with cancelled outcome', () => {
      manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      const completed = manager.completeDelegation('session-456', {
        outcome: 'cancelled',
      });

      expect(completed?.status).toBe('failed');
      expect(completed?.outcome).toBe('cancelled');
    });

    it('should return undefined for unknown session ID', () => {
      const result = manager.completeDelegation('unknown-session', {
        outcome: 'success',
      });

      expect(result).toBeUndefined();
    });

    it('should calculate correct duration', async () => {
      manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      // Wait a bit to ensure measurable duration
      await new Promise(resolve => setTimeout(resolve, 50));

      const completed = manager.completeDelegation('session-456', {
        outcome: 'success',
      });

      expect(completed?.durationMs).toBeGreaterThanOrEqual(40);
    });
  });

  describe('getDelegation', () => {
    it('should return delegation by ID', () => {
      const created = manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      const retrieved = manager.getDelegation(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return undefined for unknown ID', () => {
      expect(manager.getDelegation('unknown-id')).toBeUndefined();
    });
  });

  describe('getBySessionId', () => {
    it('should return delegation by session ID', () => {
      manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      const retrieved = manager.getBySessionId('session-456');
      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe('session-456');
    });

    it('should return undefined for unknown session ID', () => {
      expect(manager.getBySessionId('unknown-session')).toBeUndefined();
    });
  });

  describe('getByTaskId', () => {
    it('should return delegation by task ID', () => {
      manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      const retrieved = manager.getByTaskId('task-123');
      expect(retrieved).toBeDefined();
      expect(retrieved?.taskId).toBe('task-123');
    });

    it('should return undefined for unknown task ID', () => {
      expect(manager.getByTaskId('unknown-task')).toBeUndefined();
    });
  });

  describe('getActiveDelegations', () => {
    it('should return only active delegations', () => {
      manager.recordDelegation({
        taskId: 'task-1',
        sessionId: 'session-1',
        model: 'opus',
        contextTokens: 1000,
      });

      manager.recordDelegation({
        taskId: 'task-2',
        sessionId: 'session-2',
        model: 'sonnet',
        contextTokens: 2000,
      });

      manager.completeDelegation('session-1', { outcome: 'success' });

      const active = manager.getActiveDelegations();
      expect(active).toHaveLength(1);
      expect(active[0].sessionId).toBe('session-2');
    });

    it('should return empty array when no active delegations', () => {
      manager.recordDelegation({
        taskId: 'task-1',
        sessionId: 'session-1',
        model: 'opus',
        contextTokens: 1000,
      });

      manager.completeDelegation('session-1', { outcome: 'success' });

      expect(manager.getActiveDelegations()).toHaveLength(0);
    });
  });

  describe('getCompletedDelegations', () => {
    it('should return only completed delegations', () => {
      manager.recordDelegation({
        taskId: 'task-1',
        sessionId: 'session-1',
        model: 'opus',
        contextTokens: 1000,
      });

      manager.recordDelegation({
        taskId: 'task-2',
        sessionId: 'session-2',
        model: 'sonnet',
        contextTokens: 2000,
      });

      manager.completeDelegation('session-1', { outcome: 'success' });

      const completed = manager.getCompletedDelegations();
      expect(completed).toHaveLength(1);
      expect(completed[0].sessionId).toBe('session-1');
    });

    it('should include both successful and failed delegations', () => {
      manager.recordDelegation({
        taskId: 'task-1',
        sessionId: 'session-1',
        model: 'opus',
        contextTokens: 1000,
      });

      manager.recordDelegation({
        taskId: 'task-2',
        sessionId: 'session-2',
        model: 'sonnet',
        contextTokens: 2000,
      });

      manager.completeDelegation('session-1', { outcome: 'success' });
      manager.completeDelegation('session-2', { outcome: 'failure' });

      const completed = manager.getCompletedDelegations();
      expect(completed).toHaveLength(2);
    });
  });

  describe('getAllDelegations', () => {
    it('should return all delegations', () => {
      manager.recordDelegation({
        taskId: 'task-1',
        sessionId: 'session-1',
        model: 'opus',
        contextTokens: 1000,
      });

      manager.recordDelegation({
        taskId: 'task-2',
        sessionId: 'session-2',
        model: 'sonnet',
        contextTokens: 2000,
      });

      manager.completeDelegation('session-1', { outcome: 'success' });

      const all = manager.getAllDelegations();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no delegations', () => {
      expect(manager.getAllDelegations()).toHaveLength(0);
    });
  });

  describe('getSummary', () => {
    it('should return correct summary for empty manager', () => {
      const summary = manager.getSummary();

      expect(summary.totalDelegations).toBe(0);
      expect(summary.activeDelegations).toBe(0);
      expect(summary.completedDelegations).toBe(0);
      expect(summary.successfulDelegations).toBe(0);
      expect(summary.failedDelegations).toBe(0);
      expect(summary.successRate).toBe(0);
      expect(summary.totalQuestionsAsked).toBe(0);
      expect(summary.questionRate).toBe(0);
      expect(summary.avgDurationMs).toBe(0);
      expect(summary.avgContextTokens).toBe(0);
    });

    it('should calculate correct statistics', () => {
      // Create multiple delegations
      manager.recordDelegation({
        taskId: 'task-1',
        sessionId: 'session-1',
        model: 'opus',
        contextTokens: 1000,
      });

      manager.recordDelegation({
        taskId: 'task-2',
        sessionId: 'session-2',
        model: 'sonnet',
        contextTokens: 2000,
      });

      manager.recordDelegation({
        taskId: 'task-3',
        sessionId: 'session-3',
        model: 'sonnet',
        contextTokens: 3000,
      });

      // Record some questions
      manager.recordQuestion('session-1');
      manager.recordQuestion('session-1');
      manager.recordQuestion('session-2');

      // Complete some
      manager.completeDelegation('session-1', { outcome: 'success' });
      manager.completeDelegation('session-2', { outcome: 'failure' });

      const summary = manager.getSummary();

      expect(summary.totalDelegations).toBe(3);
      expect(summary.activeDelegations).toBe(1);
      expect(summary.completedDelegations).toBe(2);
      expect(summary.successfulDelegations).toBe(1);
      expect(summary.failedDelegations).toBe(1);
      expect(summary.successRate).toBe(0.5);
      expect(summary.totalQuestionsAsked).toBe(3);
      expect(summary.questionRate).toBeCloseTo(2 / 3, 5); // 2 out of 3 asked questions
      expect(summary.avgContextTokens).toBe(2000); // (1000 + 2000 + 3000) / 3
    });

    it('should calculate correct model-specific statistics', () => {
      manager.recordDelegation({
        taskId: 'task-1',
        sessionId: 'session-1',
        model: 'opus',
        contextTokens: 5000,
      });

      manager.recordDelegation({
        taskId: 'task-2',
        sessionId: 'session-2',
        model: 'sonnet',
        contextTokens: 2000,
      });

      manager.recordDelegation({
        taskId: 'task-3',
        sessionId: 'session-3',
        model: 'sonnet',
        contextTokens: 3000,
      });

      manager.completeDelegation('session-1', { outcome: 'success' });
      manager.completeDelegation('session-2', { outcome: 'success' });
      manager.completeDelegation('session-3', { outcome: 'failure' });

      const summary = manager.getSummary();

      // Opus stats
      expect(summary.byModel.opus.total).toBe(1);
      expect(summary.byModel.opus.successful).toBe(1);
      expect(summary.byModel.opus.failed).toBe(0);
      expect(summary.byModel.opus.successRate).toBe(1);
      expect(summary.byModel.opus.avgContextTokens).toBe(5000);

      // Sonnet stats
      expect(summary.byModel.sonnet.total).toBe(2);
      expect(summary.byModel.sonnet.successful).toBe(1);
      expect(summary.byModel.sonnet.failed).toBe(1);
      expect(summary.byModel.sonnet.successRate).toBe(0.5);
      expect(summary.byModel.sonnet.avgContextTokens).toBe(2500); // (2000 + 3000) / 2

      // Haiku stats (none used)
      expect(summary.byModel.haiku.total).toBe(0);
      expect(summary.byModel.haiku.successful).toBe(0);
      expect(summary.byModel.haiku.successRate).toBe(0);
    });
  });

  describe('removeDelegation', () => {
    it('should remove delegation by ID', () => {
      const delegation = manager.recordDelegation({
        taskId: 'task-123',
        sessionId: 'session-456',
        model: 'opus',
        contextTokens: 5000,
      });

      manager.removeDelegation(delegation.id);

      expect(manager.getDelegation(delegation.id)).toBeUndefined();
      expect(manager.getAllDelegations()).toHaveLength(0);
    });

    it('should not throw when removing non-existent delegation', () => {
      expect(() => manager.removeDelegation('non-existent-id')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all delegations', () => {
      manager.recordDelegation({
        taskId: 'task-1',
        sessionId: 'session-1',
        model: 'opus',
        contextTokens: 1000,
      });

      manager.recordDelegation({
        taskId: 'task-2',
        sessionId: 'session-2',
        model: 'sonnet',
        contextTokens: 2000,
      });

      manager.clear();

      expect(manager.getAllDelegations()).toHaveLength(0);
    });
  });

  describe('auto cleanup', () => {
    it('should clean up old completed delegations when exceeding limit', () => {
      const customManager = new DelegationMetricsManager({
        maxRetainedDelegations: 3,
        autoCleanup: true,
      });

      // Create and complete 5 delegations
      for (let i = 1; i <= 5; i++) {
        customManager.recordDelegation({
          taskId: `task-${i}`,
          sessionId: `session-${i}`,
          model: 'opus',
          contextTokens: 1000,
        });
        customManager.completeDelegation(`session-${i}`, { outcome: 'success' });
      }

      // Should have cleaned up to only retain 3
      const completed = customManager.getCompletedDelegations();
      expect(completed.length).toBeLessThanOrEqual(3);
    });

    it('should not clean up active delegations', () => {
      const customManager = new DelegationMetricsManager({
        maxRetainedDelegations: 2,
        autoCleanup: true,
      });

      // Create 3 completed delegations
      for (let i = 1; i <= 3; i++) {
        customManager.recordDelegation({
          taskId: `task-${i}`,
          sessionId: `session-${i}`,
          model: 'opus',
          contextTokens: 1000,
        });
        customManager.completeDelegation(`session-${i}`, { outcome: 'success' });
      }

      // Create 2 active delegations
      customManager.recordDelegation({
        taskId: 'task-active-1',
        sessionId: 'session-active-1',
        model: 'opus',
        contextTokens: 1000,
      });

      customManager.recordDelegation({
        taskId: 'task-active-2',
        sessionId: 'session-active-2',
        model: 'opus',
        contextTokens: 1000,
      });

      // Active delegations should not be affected
      const active = customManager.getActiveDelegations();
      expect(active).toHaveLength(2);
    });

    it('should respect autoCleanup=false', () => {
      const customManager = new DelegationMetricsManager({
        maxRetainedDelegations: 2,
        autoCleanup: false,
      });

      // Create and complete 5 delegations
      for (let i = 1; i <= 5; i++) {
        customManager.recordDelegation({
          taskId: `task-${i}`,
          sessionId: `session-${i}`,
          model: 'opus',
          contextTokens: 1000,
        });
        customManager.completeDelegation(`session-${i}`, { outcome: 'success' });
      }

      // All should be retained
      expect(customManager.getCompletedDelegations()).toHaveLength(5);
    });
  });

  describe('integration scenarios', () => {
    it('should handle typical orchestrator workflow', () => {
      // 1. Start a delegation
      const delegation = manager.recordDelegation({
        taskId: 'feature-task-1',
        sessionId: 'agent-session-1',
        model: 'opus',
        contextTokens: 8500,
      });

      expect(delegation.status).toBe('active');

      // 2. Agent asks a question
      manager.recordQuestion('agent-session-1');

      const afterQuestion = manager.getBySessionId('agent-session-1');
      expect(afterQuestion?.askedQuestions).toBe(true);
      expect(afterQuestion?.questionCount).toBe(1);

      // 3. Agent asks another question
      manager.recordQuestion('agent-session-1');
      expect(manager.getBySessionId('agent-session-1')?.questionCount).toBe(2);

      // 4. Task completes successfully
      const completed = manager.completeDelegation('agent-session-1', {
        outcome: 'success',
      });

      expect(completed?.status).toBe('completed');
      expect(completed?.outcome).toBe('success');
      expect(completed?.durationMs).toBeGreaterThanOrEqual(0);

      // 5. Check summary
      const summary = manager.getSummary();
      expect(summary.totalDelegations).toBe(1);
      expect(summary.successfulDelegations).toBe(1);
      expect(summary.totalQuestionsAsked).toBe(2);
      expect(summary.questionRate).toBe(1); // 100% asked questions
    });

    it('should handle mixed success/failure delegations', () => {
      // Create multiple delegations with different outcomes
      const tasks = [
        { taskId: 'task-1', sessionId: 'session-1', model: 'opus' as const, outcome: 'success' as DelegationOutcome },
        { taskId: 'task-2', sessionId: 'session-2', model: 'sonnet' as const, outcome: 'failure' as DelegationOutcome },
        { taskId: 'task-3', sessionId: 'session-3', model: 'sonnet' as const, outcome: 'success' as DelegationOutcome },
        { taskId: 'task-4', sessionId: 'session-4', model: 'haiku' as const, outcome: 'timeout' as DelegationOutcome },
      ];

      for (const task of tasks) {
        manager.recordDelegation({
          taskId: task.taskId,
          sessionId: task.sessionId,
          model: task.model,
          contextTokens: 2000,
        });
        manager.completeDelegation(task.sessionId, { outcome: task.outcome });
      }

      const summary = manager.getSummary();
      expect(summary.totalDelegations).toBe(4);
      expect(summary.successfulDelegations).toBe(2);
      expect(summary.failedDelegations).toBe(2);
      expect(summary.successRate).toBe(0.5);
    });

    it('should track delegation with questions and failure', () => {
      manager.recordDelegation({
        taskId: 'complex-task',
        sessionId: 'agent-1',
        model: 'opus',
        contextTokens: 15000,
      });

      // Agent asks several questions before failing
      manager.recordQuestion('agent-1');
      manager.recordQuestion('agent-1');
      manager.recordQuestion('agent-1');

      manager.completeDelegation('agent-1', {
        outcome: 'failure',
        errorMessage: 'Agent ran into unrecoverable error',
      });

      const delegation = manager.getBySessionId('agent-1');
      expect(delegation?.status).toBe('failed');
      expect(delegation?.askedQuestions).toBe(true);
      expect(delegation?.questionCount).toBe(3);
      expect(delegation?.errorMessage).toBe('Agent ran into unrecoverable error');
    });
  });
});
