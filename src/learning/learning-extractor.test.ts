import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LearningExtractor } from './learning-extractor.js';
import type { Retrospective, LearningCategory, CreateExtendedLearningInput } from './types.js';

describe('LearningExtractor', () => {
  let extractor: LearningExtractor;

  beforeEach(() => {
    extractor = new LearningExtractor();
  });

  describe('extractLearning', () => {
    it('should create an instance', () => {
      expect(extractor).toBeDefined();
    });

    it('should extract learning from a retrospective with a learning', () => {
      const retrospective: Retrospective = {
        id: 'retro-123',
        taskId: 'task-456',
        sessionId: 'session-789',
        projectId: 'project-001',
        title: 'Test failure due to async race condition',
        triggerType: 'test_regression',
        whatHappened: 'Tests started failing intermittently after adding async operations',
        rootCause: 'Shared state between tests was not properly isolated',
        correctApproach: 'Use beforeEach/afterEach hooks to reset state between tests',
        learning: {
          category: 'testing',
          pattern: 'async-race-condition',
          rule: 'Always use proper test isolation and cleanup in afterEach'
        },
        createdAt: new Date('2026-01-26'),
        resolvedAt: null
      };

      const result = extractor.extractLearning(retrospective);

      expect(result.learnings).toHaveLength(1);
      expect(result.confidence).toBeGreaterThan(0.5);

      const learning = result.learnings[0];
      expect(learning.category).toBe('testing');
      expect(learning.pattern).toBe('async-race-condition');
      expect(learning.rule).toBe('Always use proper test isolation and cleanup in afterEach');
      expect(learning.sourceRetrospective).toBe('retro-123');
    });

    it('should return empty learnings for retrospective without learning', () => {
      const retrospective: Retrospective = {
        id: 'retro-123',
        taskId: 'task-456',
        sessionId: 'session-789',
        projectId: 'project-001',
        title: 'Something went wrong',
        triggerType: 'manual',
        whatHappened: 'An error occurred',
        rootCause: null,
        correctApproach: null,
        learning: null,
        createdAt: new Date('2026-01-26'),
        resolvedAt: null
      };

      const result = extractor.extractLearning(retrospective);

      expect(result.learnings).toHaveLength(0);
      expect(result.confidence).toBe(0);
    });

    it('should infer subcategory from pattern', () => {
      const retrospective: Retrospective = {
        id: 'retro-123',
        taskId: 'task-456',
        sessionId: null,
        projectId: 'project-001',
        title: 'Memory leak in component',
        triggerType: 'validation_failures',
        whatHappened: 'Component was not cleaning up event listeners',
        rootCause: 'Missing cleanup in useEffect',
        correctApproach: 'Return cleanup function from useEffect',
        learning: {
          category: 'architecture',
          pattern: 'memory-leak-cleanup',
          rule: 'Always return cleanup functions from useEffect hooks'
        },
        createdAt: new Date('2026-01-26'),
        resolvedAt: null
      };

      const result = extractor.extractLearning(retrospective);

      expect(result.learnings).toHaveLength(1);
      expect(result.learnings[0].subcategory).toBe('memory-leak-cleanup');
    });

    it('should extract trigger from whatHappened or rootCause', () => {
      const retrospective: Retrospective = {
        id: 'retro-456',
        taskId: 'task-789',
        sessionId: null,
        projectId: 'project-002',
        title: 'Build failure',
        triggerType: 'blocker',
        whatHappened: 'Build failed when importing ESM modules',
        rootCause: 'tsconfig was using CommonJS module resolution',
        correctApproach: 'Set module to NodeNext in tsconfig',
        learning: {
          category: 'tooling',
          pattern: 'esm-import-error',
          rule: 'Use NodeNext module resolution for ESM projects'
        },
        createdAt: new Date('2026-01-26'),
        resolvedAt: null
      };

      const result = extractor.extractLearning(retrospective);

      expect(result.learnings).toHaveLength(1);
      // Trigger is lowercased and prefixed with "when"
      expect(result.learnings[0].trigger.toLowerCase()).toContain('build failed');
    });

    it('should preserve appliesTo from original learning', () => {
      const retrospective: Retrospective = {
        id: 'retro-789',
        taskId: null,
        sessionId: null,
        projectId: 'project-003',
        title: 'Type error in React component',
        triggerType: 'validation_failures',
        whatHappened: 'TypeScript compiler error on JSX props',
        rootCause: 'Missing generic type parameter',
        correctApproach: 'Explicitly specify generic types',
        learning: {
          category: 'testing',
          pattern: 'typescript-generic-inference',
          rule: 'Explicitly type generic parameters to avoid inference issues',
          appliesTo: ['typescript', 'react']
        },
        createdAt: new Date('2026-01-26'),
        resolvedAt: null
      };

      const result = extractor.extractLearning(retrospective);

      expect(result.learnings[0].appliesTo).toEqual(['typescript', 'react']);
    });

    it('should map category strings to LearningCategory', () => {
      const categories = ['testing', 'architecture', 'tooling', 'communication'];

      for (const category of categories) {
        const retrospective: Retrospective = {
          id: `retro-${category}`,
          taskId: null,
          sessionId: null,
          projectId: 'project-001',
          title: 'Test',
          triggerType: 'manual',
          whatHappened: 'Test',
          rootCause: null,
          correctApproach: null,
          learning: {
            category,
            pattern: 'test-pattern',
            rule: 'Test rule'
          },
          createdAt: new Date('2026-01-26'),
          resolvedAt: null
        };

        const result = extractor.extractLearning(retrospective);
        expect(result.learnings[0].category).toBe(category as LearningCategory);
      }
    });

    it('should default unknown categories to project-specific', () => {
      const retrospective: Retrospective = {
        id: 'retro-unknown',
        taskId: null,
        sessionId: null,
        projectId: 'project-001',
        title: 'Test',
        triggerType: 'manual',
        whatHappened: 'Test',
        rootCause: null,
        correctApproach: null,
        learning: {
          category: 'some-unknown-category',
          pattern: 'test-pattern',
          rule: 'Test rule'
        },
        createdAt: new Date('2026-01-26'),
        resolvedAt: null
      };

      const result = extractor.extractLearning(retrospective);
      expect(result.learnings[0].category).toBe('project-specific');
    });

    it('should provide reasoning in the result', () => {
      const retrospective: Retrospective = {
        id: 'retro-123',
        taskId: 'task-456',
        sessionId: null,
        projectId: 'project-001',
        title: 'Test',
        triggerType: 'test_regression',
        whatHappened: 'Test failed',
        rootCause: 'Bad code',
        correctApproach: 'Good code',
        learning: {
          category: 'testing',
          pattern: 'test-pattern',
          rule: 'Test rule'
        },
        createdAt: new Date('2026-01-26'),
        resolvedAt: null
      };

      const result = extractor.extractLearning(retrospective);
      expect(result.reasoning).toBeDefined();
      expect(result.reasoning.length).toBeGreaterThan(0);
    });

    it('should calculate confidence based on completeness', () => {
      // High confidence: all fields present
      const completeRetro: Retrospective = {
        id: 'retro-complete',
        taskId: 'task-123',
        sessionId: 'session-456',
        projectId: 'project-001',
        title: 'Complete retrospective',
        triggerType: 'test_regression',
        whatHappened: 'Detailed description of what happened',
        rootCause: 'Clear root cause identified',
        correctApproach: 'Specific approach to fix',
        learning: {
          category: 'testing',
          pattern: 'detailed-pattern',
          rule: 'Detailed actionable rule',
          appliesTo: ['typescript', 'vitest']
        },
        createdAt: new Date('2026-01-26'),
        resolvedAt: new Date('2026-01-26')
      };

      const completeResult = extractor.extractLearning(completeRetro);

      // Minimal fields
      const minimalRetro: Retrospective = {
        id: 'retro-minimal',
        taskId: null,
        sessionId: null,
        projectId: 'project-001',
        title: 'Minimal',
        triggerType: 'manual',
        whatHappened: 'Error',
        rootCause: null,
        correctApproach: null,
        learning: {
          category: 'testing',
          pattern: 'p',
          rule: 'r'
        },
        createdAt: new Date('2026-01-26'),
        resolvedAt: null
      };

      const minimalResult = extractor.extractLearning(minimalRetro);

      expect(completeResult.confidence).toBeGreaterThan(minimalResult.confidence);
    });
  });

  describe('normalizeCategory', () => {
    it('should normalize valid categories', () => {
      expect(extractor.normalizeCategory('testing')).toBe('testing');
      expect(extractor.normalizeCategory('TESTING')).toBe('testing');
      expect(extractor.normalizeCategory('Testing')).toBe('testing');
      expect(extractor.normalizeCategory('architecture')).toBe('architecture');
      expect(extractor.normalizeCategory('tooling')).toBe('tooling');
      expect(extractor.normalizeCategory('communication')).toBe('communication');
    });

    it('should map alternative names to standard categories', () => {
      expect(extractor.normalizeCategory('test')).toBe('testing');
      expect(extractor.normalizeCategory('tests')).toBe('testing');
      expect(extractor.normalizeCategory('arch')).toBe('architecture');
      expect(extractor.normalizeCategory('design')).toBe('architecture');
      expect(extractor.normalizeCategory('tools')).toBe('tooling');
      expect(extractor.normalizeCategory('build')).toBe('tooling');
      expect(extractor.normalizeCategory('ci')).toBe('tooling');
      expect(extractor.normalizeCategory('comm')).toBe('communication');
    });

    it('should return project-specific for unknown categories', () => {
      expect(extractor.normalizeCategory('unknown')).toBe('project-specific');
      expect(extractor.normalizeCategory('random')).toBe('project-specific');
      expect(extractor.normalizeCategory('')).toBe('project-specific');
    });
  });

  describe('generateTrigger', () => {
    it('should generate trigger from whatHappened if short enough', () => {
      const trigger = extractor.generateTrigger(
        'Tests fail intermittently',
        null,
        'async-issue'
      );
      // Trigger lowercases first char and adds "when" prefix
      expect(trigger.toLowerCase()).toContain('tests fail');
    });

    it('should use rootCause if whatHappened is too long', () => {
      const longWhatHappened = 'A'.repeat(200);
      const trigger = extractor.generateTrigger(
        longWhatHappened,
        'Missing cleanup function',
        'memory-leak'
      );
      // Trigger lowercases first char and adds "when" prefix
      expect(trigger.toLowerCase()).toContain('missing cleanup');
    });

    it('should fallback to pattern-based trigger', () => {
      const trigger = extractor.generateTrigger(
        'A'.repeat(200),
        'B'.repeat(200),
        'async-race-condition'
      );
      // Pattern is converted to words: "async race condition"
      expect(trigger.toLowerCase()).toContain('async race condition');
    });
  });
});
