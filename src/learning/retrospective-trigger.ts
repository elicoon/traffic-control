import type { TriggerContext, TriggerResult, RetrospectiveTriggerType } from './types.js';

/**
 * Configuration options for the RetrospectiveTrigger
 */
export interface RetrospectiveTriggerConfig {
  /** Number of validation failures before triggering retrospective (default: 3) */
  validationFailureThreshold?: number;
  /** Which trigger types are enabled (default: all) */
  enabledTriggers?: RetrospectiveTriggerType[];
}

/**
 * Detects conditions that require retrospectives.
 * Evaluates task/session context to determine if a retrospective should be generated.
 */
export class RetrospectiveTrigger {
  private readonly validationFailureThreshold: number;
  private readonly enabledTriggers: Set<RetrospectiveTriggerType>;

  constructor(config: RetrospectiveTriggerConfig = {}) {
    this.validationFailureThreshold = config.validationFailureThreshold ?? 3;
    const defaultTriggers: RetrospectiveTriggerType[] = [
      'validation_failures',
      'blocker',
      'review_rejected',
      'test_regression',
      'manual'
    ];
    this.enabledTriggers = new Set<RetrospectiveTriggerType>(
      config.enabledTriggers ?? defaultTriggers
    );
  }

  /**
   * Checks if a retrospective should be triggered based on the given context.
   * Evaluates multiple conditions in priority order.
   */
  checkTrigger(context: TriggerContext): TriggerResult {
    // Check triggers in priority order (most critical first)

    // 1. Blocker - highest priority, agent is stuck
    if (this.enabledTriggers.has('blocker') && context.isBlocked) {
      return {
        shouldTrigger: true,
        triggerType: 'blocker',
        reason: `Agent explicitly blocked: ${context.blockerReason ?? 'No reason provided'}`,
        context: {
          taskId: context.taskId,
          projectId: context.projectId,
          sessionId: context.sessionId,
          blockerReason: context.blockerReason
        }
      };
    }

    // 2. Test regression - tests that were passing now fail
    if (this.enabledTriggers.has('test_regression') && context.testsFailing) {
      return {
        shouldTrigger: true,
        triggerType: 'test_regression',
        reason: `Test suite regression: ${context.testsFailedCount ?? 0} tests failing (previously ${context.previousTestsPassedCount ?? 'unknown'} passed)`,
        context: {
          taskId: context.taskId,
          projectId: context.projectId,
          sessionId: context.sessionId,
          testsFailedCount: context.testsFailedCount,
          previousTestsPassedCount: context.previousTestsPassedCount
        }
      };
    }

    // 3. Review rejected - visual review failed
    if (this.enabledTriggers.has('review_rejected') && context.reviewRejected) {
      return {
        shouldTrigger: true,
        triggerType: 'review_rejected',
        reason: `Visual review rejected: ${context.reviewFeedback ?? 'No feedback provided'}`,
        context: {
          taskId: context.taskId,
          projectId: context.projectId,
          sessionId: context.sessionId,
          reviewFeedback: context.reviewFeedback
        }
      };
    }

    // 4. Validation failures - repeated failures indicate a pattern
    if (
      this.enabledTriggers.has('validation_failures') &&
      this.shouldTriggerForValidationFailures(context.validationFailureCount ?? 0)
    ) {
      return {
        shouldTrigger: true,
        triggerType: 'validation_failures',
        reason: `Task failed validation ${context.validationFailureCount} times (threshold: ${this.validationFailureThreshold})`,
        context: {
          taskId: context.taskId,
          projectId: context.projectId,
          sessionId: context.sessionId,
          validationFailureCount: context.validationFailureCount
        }
      };
    }

    // No trigger conditions met
    return {
      shouldTrigger: false,
      triggerType: null,
      reason: null,
      context: {}
    };
  }

  /**
   * Checks if validation failure count has reached the threshold
   */
  shouldTriggerForValidationFailures(failureCount: number): boolean {
    return failureCount >= this.validationFailureThreshold;
  }

  /**
   * Creates a manual trigger result
   */
  createManualTrigger(
    taskId: string,
    projectId: string,
    reason: string,
    sessionId?: string
  ): TriggerResult {
    if (!this.enabledTriggers.has('manual')) {
      return {
        shouldTrigger: false,
        triggerType: null,
        reason: 'Manual triggers are disabled',
        context: {}
      };
    }

    return {
      shouldTrigger: true,
      triggerType: 'manual',
      reason: `Manual retrospective requested: ${reason}`,
      context: {
        taskId,
        projectId,
        sessionId,
        manualReason: reason
      }
    };
  }

  /**
   * Checks if a specific trigger type is enabled
   */
  isTriggerEnabled(triggerType: RetrospectiveTriggerType): boolean {
    return this.enabledTriggers.has(triggerType);
  }

  /**
   * Gets the current validation failure threshold
   */
  getValidationFailureThreshold(): number {
    return this.validationFailureThreshold;
  }
}
