import { describe, it, expect } from 'vitest';
import { RetrospectiveGenerator } from './retrospective-generator.js';
import type { GenerateRetrospectiveInput } from './types.js';

describe('RetrospectiveGenerator', () => {
  const generator = new RetrospectiveGenerator();

  describe('generate', () => {
    it('should generate retrospective for validation_failures trigger', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'validation_failures',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { validationFailureCount: 3 },
        taskTitle: 'Implement user authentication',
        validationMessages: [
          'TypeScript error: Property "user" does not exist',
          'ESLint: no-unused-vars',
          'Test failure: auth.test.ts'
        ]
      };

      const result = generator.generate(input);

      expect(result.title).toContain('validation');
      expect(result.whatHappened).toBeDefined();
      expect(result.whatHappened.length).toBeGreaterThan(0);
    });

    it('should generate retrospective for blocker trigger', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'blocker',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { blockerReason: 'Missing API key for external service' },
        taskTitle: 'Integrate payment gateway'
      };

      const result = generator.generate(input);

      expect(result.title).toContain('Blocked');
      expect(result.whatHappened).toContain('Missing API key');
    });

    it('should generate retrospective for review_rejected trigger', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'review_rejected',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { reviewFeedback: 'Button alignment is off by 10px' },
        taskTitle: 'Design login page',
        reviewFeedback: 'Button alignment is off by 10px'
      };

      const result = generator.generate(input);

      expect(result.title).toContain('Review');
      expect(result.whatHappened).toContain('Button alignment');
    });

    it('should generate retrospective for test_regression trigger', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'test_regression',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { testsFailedCount: 5, previousTestsPassedCount: 100 },
        taskTitle: 'Refactor database layer',
        errorLogs: [
          'FAIL src/db/queries.test.ts',
          'Expected: 200, Received: 500'
        ]
      };

      const result = generator.generate(input);

      expect(result.title).toContain('Test Regression');
      expect(result.whatHappened).toContain('5');
    });

    it('should generate retrospective for manual trigger', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'manual',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { manualReason: 'Architecture review needed' },
        taskTitle: 'Implement caching layer'
      };

      const result = generator.generate(input);

      expect(result.title).toContain('Manual');
      expect(result.whatHappened).toBeDefined();
    });

    it('should include error logs when provided', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'validation_failures',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { validationFailureCount: 3 },
        taskTitle: 'Fix bug',
        errorLogs: [
          'Error: Cannot read property of undefined',
          'at Function.process (/app/src/index.ts:42:10)'
        ]
      };

      const result = generator.generate(input);

      expect(result.whatHappened).toContain('Cannot read property');
    });

    it('should include validation messages when provided', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'validation_failures',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { validationFailureCount: 3 },
        taskTitle: 'Add feature',
        validationMessages: ['Missing semicolon at line 42', 'Unused import: lodash']
      };

      const result = generator.generate(input);

      expect(result.whatHappened).toContain('Missing semicolon');
    });
  });

  describe('generateTitle', () => {
    it('should generate appropriate title for each trigger type', () => {
      expect(generator.generateTitle('validation_failures', 'Auth Module')).toContain('validation');
      expect(generator.generateTitle('blocker', 'Payment Integration')).toContain('Blocked');
      expect(generator.generateTitle('review_rejected', 'UI Component')).toContain('Review');
      expect(generator.generateTitle('test_regression', 'Database Layer')).toContain('Test');
      expect(generator.generateTitle('manual', 'Architecture')).toContain('Manual');
    });

    it('should include task context in title', () => {
      const title = generator.generateTitle('validation_failures', 'User Authentication');
      expect(title).toContain('User Authentication');
    });
  });

  describe('extractSuggestedLearning', () => {
    it('should extract learning from validation failures', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'validation_failures',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { validationFailureCount: 3 },
        taskTitle: 'TypeScript migration',
        validationMessages: ['Type error: unknown is not assignable to string']
      };

      const result = generator.generate(input);

      expect(result.suggestedLearning).toBeDefined();
      expect(result.suggestedLearning?.category).toBeDefined();
      expect(result.suggestedLearning?.pattern).toBeDefined();
      expect(result.suggestedLearning?.rule).toBeDefined();
    });

    it('should extract learning from blocker', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'blocker',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { blockerReason: 'Environment variable not set' },
        taskTitle: 'Deploy to production'
      };

      const result = generator.generate(input);

      expect(result.suggestedLearning).toBeDefined();
      expect(result.suggestedLearning?.category).toBe('configuration');
    });

    it('should extract learning from test regression', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'test_regression',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { testsFailedCount: 10 },
        taskTitle: 'Refactoring'
      };

      const result = generator.generate(input);

      expect(result.suggestedLearning).toBeDefined();
      expect(result.suggestedLearning?.category).toBe('testing');
    });
  });

  describe('generateMarkdown', () => {
    it('should generate markdown document with all sections', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'validation_failures',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { validationFailureCount: 3 },
        taskTitle: 'Implement feature X',
        taskDescription: 'Add a new feature to the system',
        validationMessages: ['Error 1', 'Error 2'],
        errorLogs: ['Stack trace here']
      };

      const generated = generator.generate(input);
      const markdown = generator.generateMarkdown(input, generated);

      expect(markdown).toContain('# Retrospective:');
      expect(markdown).toContain('## What Happened');
      expect(markdown).toContain('## Context');
      expect(markdown).toContain('Task:');
      expect(markdown).toContain('Trigger:');
    });

    it('should include learning section when available', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'blocker',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { blockerReason: 'Test blocker' },
        taskTitle: 'Test task'
      };

      const generated = generator.generate(input);
      const markdown = generator.generateMarkdown(input, generated);

      if (generated.suggestedLearning) {
        expect(markdown).toContain('## Learning');
        expect(markdown).toContain('Category:');
        expect(markdown).toContain('Pattern:');
        expect(markdown).toContain('Rule:');
      }
    });

    it('should include root cause when available', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'test_regression',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { testsFailedCount: 5 },
        taskTitle: 'Test task'
      };

      const generated = generator.generate(input);
      const markdown = generator.generateMarkdown(input, generated);

      if (generated.rootCause) {
        expect(markdown).toContain('## Root Cause');
      }
    });

    it('should include correct approach when available', () => {
      const input: GenerateRetrospectiveInput = {
        triggerType: 'review_rejected',
        taskId: 'task-123',
        projectId: 'project-456',
        context: { reviewFeedback: 'Needs work' },
        taskTitle: 'Test task'
      };

      const generated = generator.generate(input);
      const markdown = generator.generateMarkdown(input, generated);

      if (generated.correctApproach) {
        expect(markdown).toContain('## Correct Approach');
      }
    });
  });
});
