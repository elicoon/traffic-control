import { describe, it, expect } from 'vitest';
import { RetrospectiveTrigger } from './retrospective-trigger.js';
import type { TriggerContext } from './types.js';

describe('RetrospectiveTrigger', () => {
  const trigger = new RetrospectiveTrigger();

  describe('checkTrigger', () => {
    it('should not trigger when no conditions are met', () => {
      const context: TriggerContext = {
        taskId: 'task-123',
        projectId: 'project-123'
      };

      const result = trigger.checkTrigger(context);

      expect(result.shouldTrigger).toBe(false);
      expect(result.triggerType).toBeNull();
      expect(result.reason).toBeNull();
    });

    describe('validation_failures trigger', () => {
      it('should trigger when validation failures reach threshold (3)', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          validationFailureCount: 3
        };

        const result = trigger.checkTrigger(context);

        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerType).toBe('validation_failures');
        expect(result.reason).toContain('3');
      });

      it('should trigger when validation failures exceed threshold', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          validationFailureCount: 5
        };

        const result = trigger.checkTrigger(context);

        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerType).toBe('validation_failures');
      });

      it('should not trigger when validation failures below threshold', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          validationFailureCount: 2
        };

        const result = trigger.checkTrigger(context);

        expect(result.shouldTrigger).toBe(false);
      });
    });

    describe('blocker trigger', () => {
      it('should trigger when agent is explicitly blocked', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          isBlocked: true,
          blockerReason: 'Missing API credentials'
        };

        const result = trigger.checkTrigger(context);

        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerType).toBe('blocker');
        expect(result.reason).toContain('blocked');
        expect(result.context.blockerReason).toBe('Missing API credentials');
      });

      it('should not trigger when not blocked', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          isBlocked: false
        };

        const result = trigger.checkTrigger(context);

        expect(result.shouldTrigger).toBe(false);
      });
    });

    describe('review_rejected trigger', () => {
      it('should trigger when visual review is rejected', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          reviewRejected: true,
          reviewFeedback: 'Button alignment is off'
        };

        const result = trigger.checkTrigger(context);

        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerType).toBe('review_rejected');
        expect(result.context.reviewFeedback).toBe('Button alignment is off');
      });

      it('should not trigger when review passes', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          reviewRejected: false
        };

        const result = trigger.checkTrigger(context);

        expect(result.shouldTrigger).toBe(false);
      });
    });

    describe('test_regression trigger', () => {
      it('should trigger when tests fail that previously passed', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          testsFailing: true,
          testsFailedCount: 5,
          previousTestsPassedCount: 100
        };

        const result = trigger.checkTrigger(context);

        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerType).toBe('test_regression');
        expect(result.context.testsFailedCount).toBe(5);
      });

      it('should not trigger when tests are passing', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          testsFailing: false
        };

        const result = trigger.checkTrigger(context);

        expect(result.shouldTrigger).toBe(false);
      });
    });

    describe('trigger priority', () => {
      it('should prioritize blocker over validation failures', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          validationFailureCount: 5,
          isBlocked: true,
          blockerReason: 'Critical error'
        };

        const result = trigger.checkTrigger(context);

        expect(result.triggerType).toBe('blocker');
      });

      it('should prioritize test regression over validation failures', () => {
        const context: TriggerContext = {
          taskId: 'task-123',
          projectId: 'project-123',
          validationFailureCount: 5,
          testsFailing: true,
          testsFailedCount: 10
        };

        const result = trigger.checkTrigger(context);

        expect(result.triggerType).toBe('test_regression');
      });
    });
  });

  describe('shouldTriggerForValidationFailures', () => {
    it('should return true at default threshold of 3', () => {
      expect(trigger.shouldTriggerForValidationFailures(3)).toBe(true);
    });

    it('should return false below threshold', () => {
      expect(trigger.shouldTriggerForValidationFailures(2)).toBe(false);
    });

    it('should respect custom threshold', () => {
      const customTrigger = new RetrospectiveTrigger({ validationFailureThreshold: 5 });
      expect(customTrigger.shouldTriggerForValidationFailures(4)).toBe(false);
      expect(customTrigger.shouldTriggerForValidationFailures(5)).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should allow disabling specific triggers', () => {
      const customTrigger = new RetrospectiveTrigger({
        enabledTriggers: ['validation_failures', 'blocker'] // test_regression disabled
      });

      const context: TriggerContext = {
        taskId: 'task-123',
        projectId: 'project-123',
        testsFailing: true,
        testsFailedCount: 10
      };

      const result = customTrigger.checkTrigger(context);

      expect(result.shouldTrigger).toBe(false);
    });

    it('should trigger when enabled trigger condition is met', () => {
      const customTrigger = new RetrospectiveTrigger({
        enabledTriggers: ['validation_failures']
      });

      const context: TriggerContext = {
        taskId: 'task-123',
        projectId: 'project-123',
        validationFailureCount: 3
      };

      const result = customTrigger.checkTrigger(context);

      expect(result.shouldTrigger).toBe(true);
      expect(result.triggerType).toBe('validation_failures');
    });
  });

  describe('createManualTrigger', () => {
    it('should create a manual trigger result when manual triggers are enabled', () => {
      const result = trigger.createManualTrigger(
        'task-123',
        'project-456',
        'Need to review deployment process'
      );

      expect(result.shouldTrigger).toBe(true);
      expect(result.triggerType).toBe('manual');
      expect(result.reason).toContain('Need to review deployment process');
      expect(result.context.taskId).toBe('task-123');
      expect(result.context.projectId).toBe('project-456');
      expect(result.context.manualReason).toBe('Need to review deployment process');
    });

    it('should include sessionId in context when provided', () => {
      const result = trigger.createManualTrigger(
        'task-123',
        'project-456',
        'Review needed',
        'session-789'
      );

      expect(result.shouldTrigger).toBe(true);
      expect(result.context.sessionId).toBe('session-789');
    });

    it('should return shouldTrigger false when manual triggers are disabled', () => {
      const noManualTrigger = new RetrospectiveTrigger({
        enabledTriggers: ['validation_failures', 'blocker']
      });

      const result = noManualTrigger.createManualTrigger(
        'task-123',
        'project-456',
        'This should be rejected'
      );

      expect(result.shouldTrigger).toBe(false);
      expect(result.triggerType).toBeNull();
      expect(result.reason).toBe('Manual triggers are disabled');
    });
  });

  describe('isTriggerEnabled', () => {
    it('should return true for enabled triggers', () => {
      expect(trigger.isTriggerEnabled('blocker')).toBe(true);
      expect(trigger.isTriggerEnabled('validation_failures')).toBe(true);
      expect(trigger.isTriggerEnabled('manual')).toBe(true);
      expect(trigger.isTriggerEnabled('test_regression')).toBe(true);
      expect(trigger.isTriggerEnabled('review_rejected')).toBe(true);
    });

    it('should return false for disabled triggers', () => {
      const limited = new RetrospectiveTrigger({
        enabledTriggers: ['blocker']
      });

      expect(limited.isTriggerEnabled('blocker')).toBe(true);
      expect(limited.isTriggerEnabled('manual')).toBe(false);
      expect(limited.isTriggerEnabled('validation_failures')).toBe(false);
    });
  });

  describe('getValidationFailureThreshold', () => {
    it('should return default threshold of 3', () => {
      expect(trigger.getValidationFailureThreshold()).toBe(3);
    });

    it('should return custom threshold when configured', () => {
      const custom = new RetrospectiveTrigger({ validationFailureThreshold: 10 });
      expect(custom.getValidationFailureThreshold()).toBe(10);
    });
  });
});
