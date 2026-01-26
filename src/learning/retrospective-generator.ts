import type {
  GenerateRetrospectiveInput,
  GeneratedRetrospective,
  RetrospectiveTriggerType,
  Learning
} from './types.js';

/**
 * Generates structured retrospective content from trigger context.
 * Creates human-readable retrospectives and extracts machine-readable learnings.
 */
export class RetrospectiveGenerator {
  /**
   * Generates a complete retrospective from the input context
   */
  generate(input: GenerateRetrospectiveInput): GeneratedRetrospective {
    const title = this.generateTitle(input.triggerType, input.taskTitle);
    const whatHappened = this.generateWhatHappened(input);
    const rootCause = this.inferRootCause(input);
    const correctApproach = this.suggestCorrectApproach(input);
    const suggestedLearning = this.extractSuggestedLearning(input);

    return {
      title,
      whatHappened,
      rootCause,
      correctApproach,
      suggestedLearning
    };
  }

  /**
   * Generates an appropriate title based on trigger type and task context
   */
  generateTitle(triggerType: RetrospectiveTriggerType, taskTitle?: string): string {
    const taskContext = taskTitle ? `: ${taskTitle}` : '';

    switch (triggerType) {
      case 'validation_failures':
        return `Repeated validation failures${taskContext}`;
      case 'blocker':
        return `Blocked${taskContext}`;
      case 'review_rejected':
        return `Review Rejected${taskContext}`;
      case 'test_regression':
        return `Test Regression${taskContext}`;
      case 'manual':
        return `Manual Retrospective${taskContext}`;
      default:
        return `Retrospective${taskContext}`;
    }
  }

  /**
   * Generates the "what happened" narrative from context
   */
  private generateWhatHappened(input: GenerateRetrospectiveInput): string {
    const parts: string[] = [];

    // Add trigger-specific context
    switch (input.triggerType) {
      case 'validation_failures':
        parts.push(
          `Task "${input.taskTitle ?? 'Unknown'}" failed validation ${input.context.validationFailureCount ?? 'multiple'} times.`
        );
        break;
      case 'blocker':
        parts.push(
          `Agent was blocked while working on "${input.taskTitle ?? 'Unknown'}". Reason: ${input.context.blockerReason ?? 'Not specified'}`
        );
        break;
      case 'review_rejected':
        parts.push(
          `Visual review was rejected for "${input.taskTitle ?? 'Unknown'}". Feedback: ${input.reviewFeedback ?? input.context.reviewFeedback ?? 'Not specified'}`
        );
        break;
      case 'test_regression':
        parts.push(
          `Test regression detected while working on "${input.taskTitle ?? 'Unknown'}". ${input.context.testsFailedCount ?? 0} tests now failing (previously ${input.context.previousTestsPassedCount ?? 'unknown'} were passing).`
        );
        break;
      case 'manual':
        parts.push(
          `Manual retrospective requested for "${input.taskTitle ?? 'Unknown'}". Reason: ${input.context.manualReason ?? 'Not specified'}`
        );
        break;
    }

    // Add task description if available
    if (input.taskDescription) {
      parts.push(`\nTask description: ${input.taskDescription}`);
    }

    // Add validation messages if available
    if (input.validationMessages && input.validationMessages.length > 0) {
      parts.push('\nValidation messages:');
      input.validationMessages.forEach((msg, i) => {
        parts.push(`${i + 1}. ${msg}`);
      });
    }

    // Add error logs if available
    if (input.errorLogs && input.errorLogs.length > 0) {
      parts.push('\nError logs:');
      input.errorLogs.forEach(log => {
        parts.push(`- ${log}`);
      });
    }

    return parts.join('\n');
  }

  /**
   * Attempts to infer the root cause from available context
   */
  private inferRootCause(input: GenerateRetrospectiveInput): string | null {
    switch (input.triggerType) {
      case 'validation_failures':
        if (input.validationMessages?.some(m => m.toLowerCase().includes('type'))) {
          return 'TypeScript type errors indicate potential type mismatches or incorrect type annotations.';
        }
        if (input.validationMessages?.some(m => m.toLowerCase().includes('eslint'))) {
          return 'Linting errors indicate code style or potential bug pattern violations.';
        }
        if (input.validationMessages?.some(m => m.toLowerCase().includes('test'))) {
          return 'Test failures indicate functional regressions or unmet acceptance criteria.';
        }
        return 'Multiple validation failures suggest a systematic issue with the approach.';

      case 'blocker':
        if (
          input.context.blockerReason?.toString().toLowerCase().includes('env') ||
          input.context.blockerReason?.toString().toLowerCase().includes('key')
        ) {
          return 'Missing environment configuration or credentials prevented task completion.';
        }
        if (input.context.blockerReason?.toString().toLowerCase().includes('permission')) {
          return 'Insufficient permissions prevented required actions.';
        }
        return 'Agent encountered an obstacle that requires human intervention.';

      case 'review_rejected':
        return 'Visual implementation did not meet design specifications or quality standards.';

      case 'test_regression':
        return 'Recent changes broke existing functionality that was previously working.';

      case 'manual':
        return null; // Manual retrospectives should have root cause filled in by user
    }
  }

  /**
   * Suggests a correct approach based on the failure type
   */
  private suggestCorrectApproach(input: GenerateRetrospectiveInput): string | null {
    switch (input.triggerType) {
      case 'validation_failures':
        return 'Run validation checks locally before submitting. Ensure TypeScript compiles cleanly and all tests pass.';

      case 'blocker':
        if (
          input.context.blockerReason?.toString().toLowerCase().includes('env') ||
          input.context.blockerReason?.toString().toLowerCase().includes('key')
        ) {
          return 'Verify all required environment variables and credentials are available before starting tasks that depend on external services.';
        }
        return 'Break down the task into smaller steps and identify dependencies early. Request clarification before proceeding when blocked.';

      case 'review_rejected':
        return 'Compare implementation against design specifications more carefully. Take screenshots and verify visual alignment before submitting for review.';

      case 'test_regression':
        return 'Run the full test suite before and after making changes. Use TDD to prevent regressions. Consider adding integration tests for affected areas.';

      case 'manual':
        return null; // Manual retrospectives should have correct approach filled in by user
    }
  }

  /**
   * Extracts a suggested learning from the retrospective context
   */
  extractSuggestedLearning(input: GenerateRetrospectiveInput): Learning | null {
    switch (input.triggerType) {
      case 'validation_failures':
        return {
          category: this.categorizeLearning(input),
          pattern: 'repeated_validation_failure',
          rule: 'Always run the full validation suite (tsc, lint, test) before marking a task as complete.',
          appliesTo: this.extractAppliesTo(input)
        };

      case 'blocker':
        return {
          category: 'configuration',
          pattern: 'missing_prerequisites',
          rule: 'Verify all required environment variables, credentials, and dependencies exist before starting work on a task.',
          appliesTo: this.extractAppliesTo(input)
        };

      case 'review_rejected':
        return {
          category: 'quality',
          pattern: 'visual_mismatch',
          rule: 'Take screenshots and compare against design specifications before submitting visual work for review.',
          appliesTo: ['ui-tasks', 'frontend']
        };

      case 'test_regression':
        return {
          category: 'testing',
          pattern: 'regression_introduced',
          rule: 'Run the complete test suite before and after making changes. Investigate any new failures immediately.',
          appliesTo: this.extractAppliesTo(input)
        };

      case 'manual':
        // Manual retrospectives should have learning filled in by user
        return null;
    }
  }

  /**
   * Categorizes the learning based on validation messages and context
   */
  private categorizeLearning(input: GenerateRetrospectiveInput): string {
    if (input.validationMessages?.some(m => m.toLowerCase().includes('type'))) {
      return 'typescript';
    }
    if (input.validationMessages?.some(m => m.toLowerCase().includes('test'))) {
      return 'testing';
    }
    if (input.validationMessages?.some(m => m.toLowerCase().includes('lint'))) {
      return 'code_style';
    }
    return 'validation';
  }

  /**
   * Extracts applicable contexts from the input
   */
  private extractAppliesTo(input: GenerateRetrospectiveInput): string[] {
    const appliesTo: string[] = [];

    // Extract from task title/description
    const textToAnalyze = `${input.taskTitle ?? ''} ${input.taskDescription ?? ''}`.toLowerCase();

    if (textToAnalyze.includes('api') || textToAnalyze.includes('backend')) {
      appliesTo.push('api-tasks');
    }
    if (textToAnalyze.includes('ui') || textToAnalyze.includes('frontend') || textToAnalyze.includes('component')) {
      appliesTo.push('frontend');
    }
    if (textToAnalyze.includes('database') || textToAnalyze.includes('db') || textToAnalyze.includes('sql')) {
      appliesTo.push('database');
    }
    if (textToAnalyze.includes('test')) {
      appliesTo.push('testing');
    }

    return appliesTo.length > 0 ? appliesTo : ['general'];
  }

  /**
   * Generates a markdown document for the retrospective
   */
  generateMarkdown(
    input: GenerateRetrospectiveInput,
    generated: GeneratedRetrospective
  ): string {
    const lines: string[] = [];

    // Title
    lines.push(`# Retrospective: ${generated.title}`);
    lines.push('');

    // Metadata
    lines.push('## Context');
    lines.push(`- **Task:** ${input.taskTitle ?? 'Unknown'}`);
    lines.push(`- **Task ID:** ${input.taskId}`);
    lines.push(`- **Project ID:** ${input.projectId}`);
    if (input.sessionId) {
      lines.push(`- **Session ID:** ${input.sessionId}`);
    }
    lines.push(`- **Trigger:** ${input.triggerType}`);
    lines.push(`- **Date:** ${new Date().toISOString()}`);
    lines.push('');

    // What Happened
    lines.push('## What Happened');
    lines.push(generated.whatHappened);
    lines.push('');

    // Root Cause (if available)
    if (generated.rootCause) {
      lines.push('## Root Cause');
      lines.push(generated.rootCause);
      lines.push('');
    }

    // Correct Approach (if available)
    if (generated.correctApproach) {
      lines.push('## Correct Approach');
      lines.push(generated.correctApproach);
      lines.push('');
    }

    // Learning (if available)
    if (generated.suggestedLearning) {
      lines.push('## Learning');
      lines.push(`- **Category:** ${generated.suggestedLearning.category}`);
      lines.push(`- **Pattern:** ${generated.suggestedLearning.pattern}`);
      lines.push(`- **Rule:** ${generated.suggestedLearning.rule}`);
      if (generated.suggestedLearning.appliesTo && generated.suggestedLearning.appliesTo.length > 0) {
        lines.push(`- **Applies To:** ${generated.suggestedLearning.appliesTo.join(', ')}`);
      }
      lines.push('');
    }

    // Resolution status
    lines.push('## Status');
    lines.push('- [ ] Root cause confirmed');
    lines.push('- [ ] Correct approach verified');
    lines.push('- [ ] Learning extracted and stored');
    lines.push('- [ ] Resolved');
    lines.push('');

    return lines.join('\n');
  }
}
