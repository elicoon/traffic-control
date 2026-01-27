import { describe, it, expect } from 'vitest';
import {
  isTestTask,
  isTestTitle,
  TEST_PREFIX,
} from './test-cleanup.js';
import { Task } from './repositories/tasks.js';

// Create a minimal mock task for testing
function createMockTask(overrides: Partial<Task>): Task {
  return {
    id: 'test-id',
    project_id: 'test-project',
    title: 'Regular Task',
    description: null,
    status: 'queued',
    priority: 0,
    complexity_estimate: null,
    estimated_sessions_opus: 0,
    estimated_sessions_sonnet: 0,
    actual_tokens_opus: 0,
    actual_tokens_sonnet: 0,
    actual_sessions_opus: 0,
    actual_sessions_sonnet: 0,
    assigned_agent_id: null,
    requires_visual_review: false,
    parent_task_id: null,
    tags: [],
    acceptance_criteria: null,
    source: 'user',
    blocked_by_task_id: null,
    eta: null,
    priority_confirmed: false,
    priority_confirmed_at: null,
    priority_confirmed_by: null,
    started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Test Cleanup Utilities', () => {
  describe('TEST_PREFIX', () => {
    it('should be TEST_', () => {
      expect(TEST_PREFIX).toBe('TEST_');
    });
  });

  describe('isTestTitle', () => {
    it('should identify titles starting with TEST_', () => {
      expect(isTestTitle('TEST_My Feature')).toBe(true);
      expect(isTestTitle('test_something')).toBe(true);
    });

    it('should identify "test task" variations', () => {
      expect(isTestTitle('Test Task')).toBe(true);
      expect(isTestTitle('test task')).toBe(true);
      expect(isTestTitle('My Test Task')).toBe(true);
      expect(isTestTitle('Test Task for Integration')).toBe(true);
    });

    it('should identify calibration test patterns', () => {
      expect(isTestTitle('Calibration Test Task')).toBe(true);
      expect(isTestTitle('Calibration Test - low')).toBe(true);
    });

    it('should identify generic test names', () => {
      expect(isTestTitle('Queued Task')).toBe(true);
      expect(isTestTitle('Completed Task')).toBe(true);
      expect(isTestTitle('Normal Task')).toBe(true);
      expect(isTestTitle('High Priority Task')).toBe(true);
      expect(isTestTitle('Low Priority Task')).toBe(true);
    });

    it('should identify test project names', () => {
      expect(isTestTitle('My Test Project')).toBe(true);
      expect(isTestTitle('Integration Test Project')).toBe(true);
    });

    it('should identify threshold test patterns', () => {
      expect(isTestTitle('Test Task Below Threshold 0')).toBe(true);
      expect(isTestTitle('Test Task At Threshold 1')).toBe(true);
    });

    it('should NOT identify legitimate tasks', () => {
      expect(isTestTitle('Implement user authentication')).toBe(false);
      expect(isTestTitle('Fix bug in dashboard')).toBe(false);
      expect(isTestTitle('Add API endpoint')).toBe(false);
      expect(isTestTitle('Update documentation')).toBe(false);
      expect(isTestTitle('Write integration tests')).toBe(false); // "tests" is different from "test task"
    });
  });

  describe('isTestTask', () => {
    it('should identify tasks with test source', () => {
      const task = createMockTask({ source: 'test' as any });
      expect(isTestTask(task)).toBe(true);
    });

    it('should identify tasks with test title patterns', () => {
      expect(isTestTask(createMockTask({ title: 'Test Task' }))).toBe(true);
      expect(isTestTask(createMockTask({ title: 'TEST_Feature' }))).toBe(true);
      expect(isTestTask(createMockTask({ title: 'Queued Task' }))).toBe(true);
    });

    it('should NOT identify legitimate tasks', () => {
      expect(isTestTask(createMockTask({ title: 'Implement feature X' }))).toBe(false);
      expect(isTestTask(createMockTask({ title: 'Fix production bug' }))).toBe(false);
    });

    it('should identify tasks for visual review testing', () => {
      expect(isTestTask(createMockTask({ title: 'Visual Review Test Task' }))).toBe(true);
    });

    it('should identify tasks for retrospective testing', () => {
      expect(isTestTask(createMockTask({ title: 'Task for Retrospective' }))).toBe(true);
    });

    it('should identify tasks for estimates testing', () => {
      expect(isTestTask(createMockTask({ title: 'Task for Estimates' }))).toBe(true);
    });

    it('should identify tasks for integration testing', () => {
      expect(isTestTask(createMockTask({ title: 'Task for integration' }))).toBe(true);
    });
  });
});
