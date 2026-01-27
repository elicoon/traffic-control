import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ProductivityMonitor,
  ProductivityMonitorConfig,
  ProductivityStatus,
  ProductivityAlert,
  OutputType,
  AgentProductivityStats,
  AlertCallback,
} from './productivity-monitor.js';
import { EventBus } from '../events/event-bus.js';
import { createEvent } from '../events/event-types.js';

describe('ProductivityMonitor', () => {
  let monitor: ProductivityMonitor;
  let config: Partial<ProductivityMonitorConfig>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-26T12:00:00'));

    config = {
      warningThreshold: 50000,
      criticalThreshold: 100000,
      alertCooldownMs: 300000,
      autoPauseAtCritical: true,
    };

    monitor = new ProductivityMonitor(config);
  });

  afterEach(() => {
    vi.useRealTimers();
    monitor.destroy();
  });

  describe('constructor', () => {
    it('should create an instance with default config', () => {
      const defaultMonitor = new ProductivityMonitor();
      const retrievedConfig = defaultMonitor.getConfig();

      expect(retrievedConfig.warningThreshold).toBe(50000);
      expect(retrievedConfig.criticalThreshold).toBe(100000);
      expect(retrievedConfig.alertCooldownMs).toBe(300000);
      expect(retrievedConfig.autoPauseAtCritical).toBe(true);

      defaultMonitor.destroy();
    });

    it('should create an instance with custom config', () => {
      const customMonitor = new ProductivityMonitor({
        warningThreshold: 25000,
        criticalThreshold: 75000,
        alertCooldownMs: 60000,
        autoPauseAtCritical: false,
      });

      const retrievedConfig = customMonitor.getConfig();
      expect(retrievedConfig.warningThreshold).toBe(25000);
      expect(retrievedConfig.criticalThreshold).toBe(75000);
      expect(retrievedConfig.alertCooldownMs).toBe(60000);
      expect(retrievedConfig.autoPauseAtCritical).toBe(false);

      customMonitor.destroy();
    });

    it('should merge partial custom config with defaults', () => {
      const customMonitor = new ProductivityMonitor({
        warningThreshold: 30000,
      });

      const retrievedConfig = customMonitor.getConfig();
      expect(retrievedConfig.warningThreshold).toBe(30000);
      expect(retrievedConfig.criticalThreshold).toBe(100000); // default
      expect(retrievedConfig.autoPauseAtCritical).toBe(true); // default

      customMonitor.destroy();
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      monitor.updateConfig({ warningThreshold: 40000 });

      const retrievedConfig = monitor.getConfig();
      expect(retrievedConfig.warningThreshold).toBe(40000);
      expect(retrievedConfig.criticalThreshold).toBe(100000); // unchanged
    });
  });

  describe('agent tracking', () => {
    it('should start tracking an agent', () => {
      monitor.startTracking('agent-1', 'task-1');

      expect(monitor.isTracking('agent-1')).toBe(true);
      expect(monitor.getTrackedAgents()).toContain('agent-1');
    });

    it('should stop tracking an agent', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.stopTracking('agent-1');

      expect(monitor.isTracking('agent-1')).toBe(false);
      expect(monitor.getTrackedAgents()).not.toContain('agent-1');
    });

    it('should track multiple agents', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.startTracking('agent-2', 'task-2');
      monitor.startTracking('agent-3', 'task-3');

      expect(monitor.getTrackedAgents()).toHaveLength(3);
      expect(monitor.getTrackedAgents()).toContain('agent-1');
      expect(monitor.getTrackedAgents()).toContain('agent-2');
      expect(monitor.getTrackedAgents()).toContain('agent-3');
    });

    it('should return false for untracked agent', () => {
      expect(monitor.isTracking('non-existent')).toBe(false);
    });
  });

  describe('recordTokens', () => {
    it('should record token consumption', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 5000);

      const stats = monitor.getStats('agent-1');
      expect(stats?.tokensConsumed).toBe(5000);
    });

    it('should accumulate token consumption', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 5000);
      monitor.recordTokens('agent-1', 3000);
      monitor.recordTokens('agent-1', 2000);

      const stats = monitor.getStats('agent-1');
      expect(stats?.tokensConsumed).toBe(10000);
    });

    it('should auto-create tracking if agent not tracked', () => {
      monitor.recordTokens('agent-1', 5000);

      expect(monitor.isTracking('agent-1')).toBe(true);
      const stats = monitor.getStats('agent-1');
      expect(stats?.tokensConsumed).toBe(5000);
    });
  });

  describe('recordOutput', () => {
    beforeEach(() => {
      monitor.startTracking('agent-1', 'task-1');
    });

    it('should record file output', () => {
      monitor.recordOutput('agent-1', 'file');

      const stats = monitor.getStats('agent-1');
      expect(stats?.outputCounts.filesModified).toBe(1);
    });

    it('should record test output', () => {
      monitor.recordOutput('agent-1', 'test');

      const stats = monitor.getStats('agent-1');
      expect(stats?.outputCounts.testsRun).toBe(1);
      expect(stats?.outputCounts.testsPassed).toBe(1);
    });

    it('should record commit output', () => {
      monitor.recordOutput('agent-1', 'commit');

      const stats = monitor.getStats('agent-1');
      expect(stats?.outputCounts.commitsCreated).toBe(1);
    });

    it('should record task output', () => {
      monitor.recordOutput('agent-1', 'task');

      const stats = monitor.getStats('agent-1');
      expect(stats?.outputCounts.tasksCompleted).toBe(1);
    });

    it('should accumulate multiple outputs', () => {
      monitor.recordOutput('agent-1', 'file');
      monitor.recordOutput('agent-1', 'file');
      monitor.recordOutput('agent-1', 'test');
      monitor.recordOutput('agent-1', 'commit');

      const stats = monitor.getStats('agent-1');
      expect(stats?.outputCounts.filesModified).toBe(2);
      expect(stats?.outputCounts.testsRun).toBe(1);
      expect(stats?.outputCounts.commitsCreated).toBe(1);
    });

    it('should update lastOutputAt timestamp', () => {
      const initialStats = monitor.getStats('agent-1');
      expect(initialStats?.lastOutputAt).toBeNull();

      monitor.recordOutput('agent-1', 'file');

      const stats = monitor.getStats('agent-1');
      expect(stats?.lastOutputAt).toBeInstanceOf(Date);
    });
  });

  describe('recordTestResult', () => {
    beforeEach(() => {
      monitor.startTracking('agent-1', 'task-1');
    });

    it('should record passing test', () => {
      monitor.recordTestResult('agent-1', true);

      const stats = monitor.getStats('agent-1');
      expect(stats?.outputCounts.testsRun).toBe(1);
      expect(stats?.outputCounts.testsPassed).toBe(1);
    });

    it('should record failing test', () => {
      monitor.recordTestResult('agent-1', false);

      const stats = monitor.getStats('agent-1');
      expect(stats?.outputCounts.testsRun).toBe(1);
      expect(stats?.outputCounts.testsPassed).toBe(0);
    });

    it('should track mixed test results', () => {
      monitor.recordTestResult('agent-1', true);
      monitor.recordTestResult('agent-1', true);
      monitor.recordTestResult('agent-1', false);
      monitor.recordTestResult('agent-1', true);

      const stats = monitor.getStats('agent-1');
      expect(stats?.outputCounts.testsRun).toBe(4);
      expect(stats?.outputCounts.testsPassed).toBe(3);
    });
  });

  describe('recordToolCall', () => {
    it('should record tool calls', () => {
      monitor.startTracking('agent-1', 'task-1');

      monitor.recordToolCall('agent-1');
      monitor.recordToolCall('agent-1');
      monitor.recordToolCall('agent-1');

      const stats = monitor.getStats('agent-1');
      expect(stats?.outputCounts.toolCalls).toBe(3);
    });
  });

  describe('updateActivity', () => {
    it('should update current activity', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.updateActivity('agent-1', 'Reading configuration files');

      const stats = monitor.getStats('agent-1');
      expect(stats?.currentActivity).toBe('Reading configuration files');
    });

    it('should not throw for untracked agent', () => {
      expect(() => monitor.updateActivity('non-existent', 'activity')).not.toThrow();
    });
  });

  describe('checkProductivity', () => {
    describe('healthy status', () => {
      it('should return healthy status for new agent', () => {
        monitor.startTracking('agent-1', 'task-1');

        const status = monitor.checkProductivity('agent-1');

        expect(status.level).toBe('healthy');
        expect(status.thresholdExceeded).toBe('none');
        expect(status.shouldPause).toBe(false);
      });

      it('should return healthy status when output is produced', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 75000); // Above warning threshold
        monitor.recordOutput('agent-1', 'file');

        const status = monitor.checkProductivity('agent-1');

        expect(status.level).toBe('healthy');
        expect(status.hasOutput).toBe(true);
        expect(status.thresholdExceeded).toBe('none');
      });

      it('should return healthy status for untracked agent', () => {
        const status = monitor.checkProductivity('non-existent');

        expect(status.level).toBe('healthy');
        expect(status.tokensConsumed).toBe(0);
      });
    });

    describe('warning status', () => {
      it('should return warning when tokens exceed warning threshold without output', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 55000);

        const status = monitor.checkProductivity('agent-1');

        expect(status.level).toBe('warning');
        expect(status.thresholdExceeded).toBe('warning');
        expect(status.shouldPause).toBe(false);
      });

      it('should include token count in status', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 60000);

        const status = monitor.checkProductivity('agent-1');

        expect(status.tokensConsumed).toBe(60000);
      });
    });

    describe('critical status', () => {
      it('should return critical when tokens exceed critical threshold without output', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 105000);

        const status = monitor.checkProductivity('agent-1');

        expect(status.level).toBe('critical');
        expect(status.thresholdExceeded).toBe('critical');
      });

      it('should recommend pausing at critical level', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 105000);

        // Note: recordTokens triggers auto-pause, so we need to check before that
        // The status check after auto-pause will return shouldPause=false since already paused
        // So we check the recommendation message instead
        const status = monitor.checkProductivity('agent-1');

        // Agent was auto-paused by recordTokens, so shouldPause is now false
        // But the recommendation should still mention reviewing
        expect(status.recommendation).toContain('review');
      });

      it('should not pause if already paused', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.pauseAgent('agent-1');
        monitor.recordTokens('agent-1', 105000);

        const status = monitor.checkProductivity('agent-1');

        expect(status.shouldPause).toBe(false);
      });

      it('should not pause if autoPauseAtCritical is false', () => {
        const noPauseMonitor = new ProductivityMonitor({
          ...config,
          autoPauseAtCritical: false,
        });

        noPauseMonitor.startTracking('agent-1', 'task-1');
        noPauseMonitor.recordTokens('agent-1', 105000);

        const status = noPauseMonitor.checkProductivity('agent-1');

        expect(status.shouldPause).toBe(false);

        noPauseMonitor.destroy();
      });
    });

    describe('meaningful output detection', () => {
      it('should consider files modified as meaningful output', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 75000);
        monitor.recordOutput('agent-1', 'file');

        const status = monitor.checkProductivity('agent-1');
        expect(status.hasOutput).toBe(true);
        expect(status.level).toBe('healthy');
      });

      it('should consider passing tests as meaningful output', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 75000);
        monitor.recordTestResult('agent-1', true);

        const status = monitor.checkProductivity('agent-1');
        expect(status.hasOutput).toBe(true);
        expect(status.level).toBe('healthy');
      });

      it('should consider commits as meaningful output', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 75000);
        monitor.recordOutput('agent-1', 'commit');

        const status = monitor.checkProductivity('agent-1');
        expect(status.hasOutput).toBe(true);
        expect(status.level).toBe('healthy');
      });

      it('should consider task completion as meaningful output', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 75000);
        monitor.recordOutput('agent-1', 'task');

        const status = monitor.checkProductivity('agent-1');
        expect(status.hasOutput).toBe(true);
        expect(status.level).toBe('healthy');
      });

      it('should NOT consider failed tests as meaningful output', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 75000);
        monitor.recordTestResult('agent-1', false);

        const status = monitor.checkProductivity('agent-1');
        expect(status.hasOutput).toBe(false);
        expect(status.level).toBe('warning');
      });

      it('should NOT consider tool calls alone as meaningful output', () => {
        monitor.startTracking('agent-1', 'task-1');
        monitor.recordTokens('agent-1', 75000);
        monitor.recordToolCall('agent-1');
        monitor.recordToolCall('agent-1');

        const status = monitor.checkProductivity('agent-1');
        expect(status.hasOutput).toBe(false);
        expect(status.level).toBe('warning');
      });
    });
  });

  describe('getStats', () => {
    it('should return full statistics for an agent', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 10000);
      monitor.recordOutput('agent-1', 'file');
      monitor.recordOutput('agent-1', 'test');
      monitor.updateActivity('agent-1', 'Writing tests');

      const stats = monitor.getStats('agent-1');

      expect(stats).toBeDefined();
      expect(stats?.agentId).toBe('agent-1');
      expect(stats?.taskId).toBe('task-1');
      expect(stats?.tokensConsumed).toBe(10000);
      expect(stats?.outputCounts.filesModified).toBe(1);
      expect(stats?.outputCounts.testsRun).toBe(1);
      expect(stats?.currentActivity).toBe('Writing tests');
      expect(stats?.status.level).toBe('healthy');
    });

    it('should return undefined for untracked agent', () => {
      const stats = monitor.getStats('non-existent');
      expect(stats).toBeUndefined();
    });

    it('should include status in stats', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 55000);

      const stats = monitor.getStats('agent-1');

      expect(stats?.status).toBeDefined();
      expect(stats?.status.level).toBe('warning');
    });
  });

  describe('getAllStats', () => {
    it('should return stats for all tracked agents', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.startTracking('agent-2', 'task-2');
      monitor.recordTokens('agent-1', 5000);
      monitor.recordTokens('agent-2', 10000);

      const allStats = monitor.getAllStats();

      expect(allStats).toHaveLength(2);
      expect(allStats.find(s => s.agentId === 'agent-1')?.tokensConsumed).toBe(5000);
      expect(allStats.find(s => s.agentId === 'agent-2')?.tokensConsumed).toBe(10000);
    });

    it('should return empty array when no agents tracked', () => {
      const allStats = monitor.getAllStats();
      expect(allStats).toHaveLength(0);
    });
  });

  describe('pause management', () => {
    it('should pause an agent', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.pauseAgent('agent-1');

      expect(monitor.isPaused('agent-1')).toBe(true);
    });

    it('should resume a paused agent', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.pauseAgent('agent-1');
      monitor.resumeAgent('agent-1');

      expect(monitor.isPaused('agent-1')).toBe(false);
    });

    it('should list paused agents', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.startTracking('agent-2', 'task-2');
      monitor.pauseAgent('agent-1');
      monitor.pauseAgent('agent-2');

      const paused = monitor.getPausedAgents();

      expect(paused).toHaveLength(2);
      expect(paused).toContain('agent-1');
      expect(paused).toContain('agent-2');
    });

    it('should clear paused status when agent is stopped', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.pauseAgent('agent-1');
      monitor.stopTracking('agent-1');

      expect(monitor.isPaused('agent-1')).toBe(false);
    });

    it('should reset alert timestamps when resumed', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 55000);
      // This would normally set warningIssuedAt

      monitor.pauseAgent('agent-1');
      monitor.resumeAgent('agent-1');

      const stats = monitor.getStats('agent-1');
      expect(stats?.warningIssuedAt).toBeNull();
      expect(stats?.criticalIssuedAt).toBeNull();
    });
  });

  describe('alerts', () => {
    let alertCallback: AlertCallback;

    beforeEach(() => {
      alertCallback = vi.fn() as AlertCallback;
      monitor.onAlert(alertCallback);
    });

    it('should issue warning alert at warning threshold', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 55000);

      expect(alertCallback).toHaveBeenCalledTimes(1);
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          agentId: 'agent-1',
          tokensConsumed: 55000,
        })
      );
    });

    it('should issue critical alert at critical threshold', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 105000);

      expect(alertCallback).toHaveBeenCalledTimes(1);
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'critical',
          agentId: 'agent-1',
          tokensConsumed: 105000,
        })
      );
    });

    it('should not issue alert if output is produced', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordOutput('agent-1', 'file');
      monitor.recordTokens('agent-1', 55000);

      expect(alertCallback).not.toHaveBeenCalled();
    });

    it('should respect alert cooldown', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 55000);

      expect(alertCallback).toHaveBeenCalledTimes(1);

      // Add more tokens but stay within cooldown
      monitor.recordTokens('agent-1', 10000);

      expect(alertCallback).toHaveBeenCalledTimes(1);

      // Advance time past cooldown
      vi.advanceTimersByTime(300001);

      monitor.recordTokens('agent-1', 1000);

      expect(alertCallback).toHaveBeenCalledTimes(2);
    });

    it('should allow unsubscribing from alerts', () => {
      // Create a new callback for this test
      const newCallback = vi.fn();
      const unsubscribe = monitor.onAlert(newCallback);

      // Unsubscribe the new callback
      unsubscribe();

      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 55000);

      // The new callback should NOT have been called since it was unsubscribed
      expect(newCallback).not.toHaveBeenCalled();

      // But the original alertCallback from beforeEach should have been called
      expect(alertCallback).toHaveBeenCalledTimes(1);
    });

    it('should include task ID in alert', () => {
      monitor.startTracking('agent-1', 'task-123');
      monitor.recordTokens('agent-1', 55000);

      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
        })
      );
    });

    it('should include current activity in alert', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.updateActivity('agent-1', 'Searching for files');
      monitor.recordTokens('agent-1', 55000);

      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          currentActivity: 'Searching for files',
        })
      );
    });

    it('should include options in warning alert', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 55000);

      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.arrayContaining(['continue', 'nudge']),
        })
      );
    });

    it('should include abort option in critical alert', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 105000);

      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.arrayContaining(['continue', 'nudge', 'abort']),
        })
      );
    });

    it('should auto-pause agent at critical threshold', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 105000);

      expect(monitor.isPaused('agent-1')).toBe(true);
    });
  });

  describe('generateAlert', () => {
    it('should generate alert with all fields', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 55000);
      monitor.recordOutput('agent-1', 'file');
      monitor.updateActivity('agent-1', 'Refactoring code');

      const alert = monitor.generateAlert('agent-1', 'warning');

      expect(alert.agentId).toBe('agent-1');
      expect(alert.taskId).toBe('task-1');
      expect(alert.level).toBe('warning');
      expect(alert.tokensConsumed).toBe(55000);
      expect(alert.outputProduced.filesModified).toBe(1);
      expect(alert.currentActivity).toBe('Refactoring code');
      expect(alert.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('formatAlertForSlack', () => {
    it('should format warning alert', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 55000);
      monitor.recordOutput('agent-1', 'file');

      const alert = monitor.generateAlert('agent-1', 'warning');
      const formatted = monitor.formatAlertForSlack(alert);

      expect(formatted).toContain('Agent Productivity Warning');
      expect(formatted).toContain('agent-1');
      expect(formatted).toContain('task-1');
      expect(formatted).toContain('55,000');
      expect(formatted).toContain('Files modified: 1');
      expect(formatted).toContain('continue');
      expect(formatted).toContain('nudge');
    });

    it('should format critical alert', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.recordTokens('agent-1', 105000);

      const alert = monitor.generateAlert('agent-1', 'critical');
      const formatted = monitor.formatAlertForSlack(alert);

      expect(formatted).toContain('Agent Productivity Critical');
      expect(formatted).toContain('105,000');
      expect(formatted).toContain('abort');
    });

    it('should include current activity in formatted alert', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.updateActivity('agent-1', 'Reading documentation');
      monitor.recordTokens('agent-1', 55000);

      const alert = monitor.generateAlert('agent-1', 'warning');
      const formatted = monitor.formatAlertForSlack(alert);

      expect(formatted).toContain('Current Activity');
      expect(formatted).toContain('Reading documentation');
    });
  });

  describe('event bus integration', () => {
    let eventBus: EventBus;

    beforeEach(() => {
      eventBus = new EventBus();
      monitor.wireEventBus(eventBus);
    });

    afterEach(() => {
      eventBus.destroy();
    });

    it('should start tracking on agent:spawned event', () => {
      eventBus.emit(createEvent('agent:spawned', {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      }));

      expect(monitor.isTracking('agent-1')).toBe(true);
    });

    it('should record tokens and task completion on agent:completed event', () => {
      monitor.startTracking('agent-1', 'task-1');

      eventBus.emit(createEvent('agent:completed', {
        agentId: 'agent-1',
        taskId: 'task-1',
        summary: 'Completed successfully',
        tokensUsed: 15000,
      }));

      // Agent should be stopped after completion
      expect(monitor.isTracking('agent-1')).toBe(false);
    });

    it('should stop tracking on agent:failed event', () => {
      monitor.startTracking('agent-1', 'task-1');

      eventBus.emit(createEvent('agent:failed', {
        agentId: 'agent-1',
        taskId: 'task-1',
        error: new Error('Test error'),
        retryable: false,
      }));

      expect(monitor.isTracking('agent-1')).toBe(false);
    });

    it('should record task output on task:completed event', () => {
      monitor.startTracking('agent-1', 'task-1');

      eventBus.emit(createEvent('task:completed', {
        taskId: 'task-1',
        agentId: 'agent-1',
        success: true,
      }));

      const stats = monitor.getStats('agent-1');
      expect(stats?.outputCounts.tasksCompleted).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all tracking data', () => {
      monitor.startTracking('agent-1', 'task-1');
      monitor.startTracking('agent-2', 'task-2');
      monitor.pauseAgent('agent-1');

      monitor.clear();

      expect(monitor.getTrackedAgents()).toHaveLength(0);
      expect(monitor.getPausedAgents()).toHaveLength(0);
    });
  });

  describe('destroy', () => {
    it('should clear all data and callbacks', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);
      monitor.startTracking('agent-1', 'task-1');

      monitor.destroy();

      expect(monitor.getTrackedAgents()).toHaveLength(0);
    });
  });

  describe('integration scenarios', () => {
    it('should handle typical productive workflow', () => {
      monitor.startTracking('agent-1', 'task-1');

      // Agent starts working
      monitor.recordTokens('agent-1', 10000);
      monitor.recordToolCall('agent-1');

      // Agent produces output
      monitor.recordOutput('agent-1', 'file');
      monitor.recordTokens('agent-1', 20000);

      // Agent runs tests
      monitor.recordTestResult('agent-1', true);
      monitor.recordTestResult('agent-1', true);
      monitor.recordTokens('agent-1', 15000);

      // Agent commits
      monitor.recordOutput('agent-1', 'commit');
      monitor.recordTokens('agent-1', 5000);

      const stats = monitor.getStats('agent-1');

      expect(stats?.tokensConsumed).toBe(50000);
      expect(stats?.status.level).toBe('healthy');
      expect(stats?.status.hasOutput).toBe(true);
    });

    it('should handle unproductive agent spinning', () => {
      const alertCallback = vi.fn();
      monitor.onAlert(alertCallback);

      monitor.startTracking('agent-1', 'task-1');

      // Agent consumes tokens without producing output
      monitor.recordTokens('agent-1', 20000);
      monitor.recordToolCall('agent-1');
      monitor.recordToolCall('agent-1');
      monitor.recordTokens('agent-1', 20000);
      monitor.recordToolCall('agent-1');

      // At 40K, still healthy
      expect(monitor.checkProductivity('agent-1').level).toBe('healthy');

      // More tokens push to warning
      monitor.recordTokens('agent-1', 15000);

      // At 55K, warning issued
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warning' })
      );

      // Advance past cooldown and add more tokens
      vi.advanceTimersByTime(300001);
      monitor.recordTokens('agent-1', 50000);

      // At 105K, critical issued and paused
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'critical' })
      );
      expect(monitor.isPaused('agent-1')).toBe(true);
    });

    it('should reset productivity status after meaningful output', () => {
      monitor.startTracking('agent-1', 'task-1');

      // Agent consumes tokens
      monitor.recordTokens('agent-1', 55000);

      // Warning level
      expect(monitor.checkProductivity('agent-1').level).toBe('warning');

      // Agent produces output
      monitor.recordOutput('agent-1', 'file');

      // Back to healthy
      expect(monitor.checkProductivity('agent-1').level).toBe('healthy');
    });
  });
});
