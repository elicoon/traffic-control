import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { PreFlightChecker, PreFlightConfig, PreFlightDependencies, DEFAULT_PREFLIGHT_CONFIG } from './pre-flight.js';
import { Task } from '../db/repositories/tasks.js';

// Helper to create mock tasks
const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: `task-${Math.random().toString(36).substr(2, 9)}`,
  project_id: 'project-1',
  title: 'Production Task',
  description: null,
  status: 'queued',
  priority: 50,
  complexity_estimate: null,
  estimated_sessions_opus: 1,
  estimated_sessions_sonnet: 2,
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
  priority_confirmed: true,
  priority_confirmed_at: null,
  priority_confirmed_by: null,
  started_at: null,
  completed_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// Mock Supabase client (minimal - we'll use injected deps)
const mockSupabaseClient = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
} as unknown as SupabaseClient;

// Create mock dependencies
const createMockDeps = (): PreFlightDependencies => ({
  taskRepository: {
    getQueued: vi.fn().mockResolvedValue([]),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    getByProject: vi.fn(),
    getByStatus: vi.fn(),
  } as any,
  costTracker: {
    estimateCost: vi.fn().mockResolvedValue({
      opusCost: 50.0,
      sonnetCost: 25.0,
      haikuCost: 0,
      totalCost: 75.0,
      breakdown: [
        { model: 'opus', sessions: 2, estimatedInputTokens: 100000, estimatedOutputTokens: 20000, cost: 50.0 },
        { model: 'sonnet', sessions: 3, estimatedInputTokens: 150000, estimatedOutputTokens: 30000, cost: 25.0 },
      ],
    }),
    getAllCurrentPricing: vi.fn().mockResolvedValue([]),
  } as any,
  sendMessage: vi.fn().mockResolvedValue('thread-123'),
});

describe('PreFlightChecker', () => {
  let checker: PreFlightChecker;
  let mockDeps: PreFlightDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeps = createMockDeps();
    checker = new PreFlightChecker(mockSupabaseClient, {
      skipSlack: true,
      slackChannelId: 'test-channel',
    }, mockDeps);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create checker with default config', () => {
      const c = new PreFlightChecker(mockSupabaseClient, undefined, mockDeps);
      expect(c).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const customConfig: Partial<PreFlightConfig> = {
        opusLimitWarningThreshold: 10,
      };
      const c = new PreFlightChecker(mockSupabaseClient, customConfig, mockDeps);
      expect(c).toBeDefined();
    });
  });

  describe('runChecks', () => {
    it('should return passed result when no tasks', async () => {
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);

      const result = await checker.runChecks();

      expect(result.passed).toBe(true);
      expect(result.queuedTaskCount).toBe(0);
      expect(result.tasks).toHaveLength(0);
    });

    it('should detect no tasks warning', async () => {
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);

      const result = await checker.runChecks();

      expect(result.warnings.some(w => w.type === 'no_tasks')).toBe(true);
    });

    it('should return queued tasks sorted by priority', async () => {
      const tasks = [
        createMockTask({ title: 'Low Priority', priority: 10 }),
        createMockTask({ title: 'High Priority', priority: 100 }),
        createMockTask({ title: 'Medium Priority', priority: 50 }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      const result = await checker.runChecks();

      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].priority).toBe(100);
      expect(result.tasks[1].priority).toBe(50);
      expect(result.tasks[2].priority).toBe(10);
    });

    it('should detect test data by title pattern', async () => {
      const tasks = [
        createMockTask({ title: 'Test feature implementation' }),
        createMockTask({ title: 'Real production task' }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      const result = await checker.runChecks();

      expect(result.testDataDetected).toBe(true);
      expect(result.warnings.some(w => w.type === 'test_data')).toBe(true);
    });

    it('should detect test data by description pattern', async () => {
      const tasks = [
        createMockTask({ title: 'Normal Task', description: 'This is a test description for testing' }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      const result = await checker.runChecks();

      expect(result.testDataDetected).toBe(true);
    });

    it('should detect test data by tags', async () => {
      const tasks = [
        createMockTask({ title: 'Normal Task', tags: ['test', 'experiment'] }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      const result = await checker.runChecks();

      expect(result.testDataDetected).toBe(true);
    });

    it('should detect various test patterns in title', async () => {
      const testTitles = [
        '[TEST] Some task',
        '[DEMO] Demo task',
        'Dummy implementation',
        'Mock service setup',
        'Fake data generator',
        'Sample configuration',
        'Example feature',
        'foo bar baz implementation',
      ];

      for (const title of testTitles) {
        vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([createMockTask({ title })]);
        const result = await checker.runChecks();
        expect(result.testDataDetected).toBe(true);
      }
    });

    it('should detect unconfirmed priority tasks', async () => {
      const tasks = [
        createMockTask({ title: 'Confirmed Task', priority_confirmed: true }),
        createMockTask({ title: 'Unconfirmed Task 1', priority_confirmed: false }),
        createMockTask({ title: 'Unconfirmed Task 2', priority_confirmed: false }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      const result = await checker.runChecks();

      expect(result.unconfirmedPriorityCount).toBe(2);
      expect(result.warnings.some(w => w.type === 'unconfirmed_priority')).toBe(true);
    });

    it('should detect tasks without session estimates', async () => {
      const tasks = [
        createMockTask({
          title: 'No estimates',
          estimated_sessions_opus: 0,
          estimated_sessions_sonnet: 0,
        }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      const result = await checker.runChecks();

      expect(result.warnings.some(w => w.type === 'missing_estimates')).toBe(true);
    });

    it('should warn about high opus limit', async () => {
      // Create checker with low threshold
      const lowThresholdChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: true,
        opusLimitWarningThreshold: 1,
      }, mockDeps);

      // Set environment variable for high limit
      const originalEnv = process.env.OPUS_SESSION_LIMIT;
      process.env.OPUS_SESSION_LIMIT = '5';

      try {
        vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);
        const result = await lowThresholdChecker.runChecks();
        expect(result.warnings.some(w => w.type === 'high_opus_limit')).toBe(true);
      } finally {
        if (originalEnv !== undefined) {
          process.env.OPUS_SESSION_LIMIT = originalEnv;
        } else {
          delete process.env.OPUS_SESSION_LIMIT;
        }
      }
    });

    it('should warn about high sonnet limit', async () => {
      // Create checker with low threshold
      const lowThresholdChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: true,
        sonnetLimitWarningThreshold: 3,
      }, mockDeps);

      // Set environment variable for high limit
      const originalEnv = process.env.SONNET_SESSION_LIMIT;
      process.env.SONNET_SESSION_LIMIT = '10';

      try {
        vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);
        const result = await lowThresholdChecker.runChecks();
        expect(result.warnings.some(w => w.type === 'high_sonnet_limit')).toBe(true);
      } finally {
        if (originalEnv !== undefined) {
          process.env.SONNET_SESSION_LIMIT = originalEnv;
        } else {
          delete process.env.SONNET_SESSION_LIMIT;
        }
      }
    });

    it('should calculate cost estimate', async () => {
      const tasks = [
        createMockTask({ estimated_sessions_opus: 2, estimated_sessions_sonnet: 3 }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      const result = await checker.runChecks();

      expect(result.costEstimate).not.toBeNull();
      expect(result.costEstimate?.totalCost).toBe(75.0);
    });

    it('should handle cost estimation failure gracefully', async () => {
      vi.mocked(mockDeps.costTracker.estimateCost).mockRejectedValueOnce(new Error('Pricing not found'));
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([
        createMockTask({ estimated_sessions_opus: 1 }),
      ]);

      const result = await checker.runChecks();

      // Should not throw, cost estimate should be null
      expect(result.costEstimate).toBeNull();
    });

    it('should throw if task repository fails', async () => {
      vi.mocked(mockDeps.taskRepository.getQueued).mockRejectedValue(new Error('Database error'));

      await expect(checker.runChecks()).rejects.toThrow('Failed to fetch queued tasks');
    });

    it('should include timestamp in result', async () => {
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);

      const before = new Date();
      const result = await checker.runChecks();
      const after = new Date();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should mark passed as true when no critical warnings', async () => {
      const tasks = [
        createMockTask({ priority_confirmed: true }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      const result = await checker.runChecks();

      expect(result.passed).toBe(true);
    });
  });

  describe('getWarnings', () => {
    it('should return empty array before running checks', () => {
      expect(checker.getWarnings()).toEqual([]);
    });

    it('should return warning messages after running checks', async () => {
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);

      await checker.runChecks();

      const warnings = checker.getWarnings();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some(w => w.includes('No queued tasks'))).toBe(true);
    });
  });

  describe('getLastResult', () => {
    it('should return null before running checks', () => {
      expect(checker.getLastResult()).toBeNull();
    });

    it('should return result after running checks', async () => {
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);

      await checker.runChecks();

      const result = checker.getLastResult();
      expect(result).not.toBeNull();
      expect(result?.queuedTaskCount).toBe(0);
    });
  });

  describe('sendSummaryToSlack', () => {
    it('should throw if checks not run first', async () => {
      await expect(checker.sendSummaryToSlack()).rejects.toThrow('Must run pre-flight checks before sending summary');
    });

    it('should skip if Slack is disabled', async () => {
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);
      await checker.runChecks();

      const result = await checker.sendSummaryToSlack();

      expect(result).toBeUndefined();
      expect(mockDeps.sendMessage).not.toHaveBeenCalled();
    });

    it('should send message to Slack when enabled', async () => {
      const slackChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: 'test-channel',
      }, mockDeps);
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([
        createMockTask({ title: 'Real Task' }),
      ]);

      await slackChecker.runChecks();
      const threadTs = await slackChecker.sendSummaryToSlack();

      expect(mockDeps.sendMessage).toHaveBeenCalledWith({
        channel: 'test-channel',
        text: expect.stringContaining('TrafficControl Pre-Flight Check'),
      });
      expect(threadTs).toBe('thread-123');
    });

    it('should skip if no channel configured', async () => {
      const noChannelChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: '',
      }, mockDeps);
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);

      await noChannelChecker.runChecks();
      const result = await noChannelChecker.sendSummaryToSlack();

      expect(result).toBeUndefined();
      expect(mockDeps.sendMessage).not.toHaveBeenCalled();
    });

    it('should format summary with task list', async () => {
      const slackChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: 'test-channel',
      }, mockDeps);
      const tasks = [
        createMockTask({ title: 'High Priority Task', priority: 100 }),
        createMockTask({ title: 'Low Priority Task', priority: 10 }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      await slackChecker.runChecks();
      await slackChecker.sendSummaryToSlack();

      expect(mockDeps.sendMessage).toHaveBeenCalledWith({
        channel: 'test-channel',
        text: expect.stringContaining('Task Queue'),
      });
    });

    it('should include warnings in summary', async () => {
      const slackChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: 'test-channel',
      }, mockDeps);
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([
        createMockTask({ title: 'Test task for testing', priority_confirmed: false }),
      ]);

      await slackChecker.runChecks();
      await slackChecker.sendSummaryToSlack();

      expect(mockDeps.sendMessage).toHaveBeenCalledWith({
        channel: 'test-channel',
        text: expect.stringContaining('Warnings'),
      });
    });

    it('should include cost estimate in summary', async () => {
      const slackChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: 'test-channel',
      }, mockDeps);
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([
        createMockTask({ estimated_sessions_opus: 2, estimated_sessions_sonnet: 3 }),
      ]);

      await slackChecker.runChecks();
      await slackChecker.sendSummaryToSlack();

      expect(mockDeps.sendMessage).toHaveBeenCalledWith({
        channel: 'test-channel',
        text: expect.stringContaining('Estimated Cost'),
      });
    });

    it('should include confirmation prompt', async () => {
      const slackChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: 'test-channel',
      }, mockDeps);
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);

      await slackChecker.runChecks();
      await slackChecker.sendSummaryToSlack();

      expect(mockDeps.sendMessage).toHaveBeenCalledWith({
        channel: 'test-channel',
        text: expect.stringContaining('confirm'),
      });
    });
  });

  describe('waitForConfirmation', () => {
    it('should auto-confirm when Slack is disabled', async () => {
      const result = await checker.waitForConfirmation();
      expect(result).toBe(true);
    });

    it('should wait for confirmation when Slack is enabled', async () => {
      vi.useFakeTimers();

      const slackChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: 'test-channel',
        confirmationTimeoutMs: 1000,
      }, mockDeps);

      const confirmPromise = slackChecker.waitForConfirmation();

      // Confirm externally
      setTimeout(() => slackChecker.confirm(true), 100);

      await vi.advanceTimersByTimeAsync(100);
      const result = await confirmPromise;

      expect(result).toBe(true);
    });

    it('should timeout if no confirmation received', async () => {
      vi.useFakeTimers();

      const slackChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: 'test-channel',
        confirmationTimeoutMs: 1000,
      }, mockDeps);

      const confirmPromise = slackChecker.waitForConfirmation();

      await vi.advanceTimersByTimeAsync(1001);
      const result = await confirmPromise;

      expect(result).toBe(false);
    });

    it('should return false when user rejects', async () => {
      vi.useFakeTimers();

      const slackChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: 'test-channel',
        confirmationTimeoutMs: 5000,
      }, mockDeps);

      const confirmPromise = slackChecker.waitForConfirmation();

      // Reject externally
      setTimeout(() => slackChecker.confirm(false), 100);

      await vi.advanceTimersByTimeAsync(100);
      const result = await confirmPromise;

      expect(result).toBe(false);
    });
  });

  describe('confirm', () => {
    it('should resolve waiting confirmation', async () => {
      vi.useFakeTimers();

      const slackChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: 'test-channel',
        confirmationTimeoutMs: 5000,
      }, mockDeps);

      const confirmPromise = slackChecker.waitForConfirmation();

      // Confirm immediately
      slackChecker.confirm(true);

      const result = await confirmPromise;
      expect(result).toBe(true);
    });

    it('should do nothing if no confirmation is pending', () => {
      // Should not throw
      checker.confirm(true);
    });
  });

  describe('getConfirmationThreadTs', () => {
    it('should return null before sending summary', () => {
      expect(checker.getConfirmationThreadTs()).toBeNull();
    });

    it('should return thread timestamp after sending summary', async () => {
      const slackChecker = new PreFlightChecker(mockSupabaseClient, {
        skipSlack: false,
        slackChannelId: 'test-channel',
      }, mockDeps);
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([]);

      await slackChecker.runChecks();
      await slackChecker.sendSummaryToSlack();

      expect(slackChecker.getConfirmationThreadTs()).toBe('thread-123');
    });
  });

  describe('dryRun', () => {
    it('should run checks without Slack interaction', async () => {
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([
        createMockTask({ title: 'Real Task', priority: 50 }),
      ]);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await checker.dryRun();

      expect(result).toBeDefined();
      expect(result.queuedTaskCount).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DRY RUN'));

      consoleSpy.mockRestore();
    });

    it('should print summary to console', async () => {
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([
        createMockTask({ title: 'Task 1', priority: 100 }),
        createMockTask({ title: 'Task 2', priority: 50 }),
      ]);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await checker.dryRun();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('PRE-FLIGHT CHECK RESULTS'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Queued Tasks: 2'));

      consoleSpy.mockRestore();
    });

    it('should print warnings in dry run', async () => {
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue([
        createMockTask({ title: 'Test task', priority_confirmed: false }),
      ]);

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await checker.dryRun();

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Warnings:'));

      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('integration scenarios', () => {
    it('should handle production-like task queue', async () => {
      const tasks = [
        createMockTask({
          title: 'Implement user authentication',
          priority: 100,
          priority_confirmed: true,
          estimated_sessions_opus: 2,
          estimated_sessions_sonnet: 1,
        }),
        createMockTask({
          title: 'Add dashboard analytics',
          priority: 80,
          priority_confirmed: true,
          estimated_sessions_opus: 1,
          estimated_sessions_sonnet: 2,
        }),
        createMockTask({
          title: 'Fix bug in payment flow',
          priority: 90,
          priority_confirmed: true,
          estimated_sessions_opus: 1,
          estimated_sessions_sonnet: 1,
        }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      const result = await checker.runChecks();

      expect(result.passed).toBe(true);
      expect(result.queuedTaskCount).toBe(3);
      expect(result.testDataDetected).toBe(false);
      expect(result.unconfirmedPriorityCount).toBe(0);
      expect(result.tasks[0].priority).toBe(100); // Highest priority first
    });

    it('should detect multiple issues', async () => {
      const tasks = [
        createMockTask({
          title: '[TEST] Some test task',
          priority_confirmed: false,
          estimated_sessions_opus: 0,
          estimated_sessions_sonnet: 0,
        }),
        createMockTask({
          title: 'Another task',
          priority_confirmed: false,
          tags: ['test'],
        }),
      ];
      vi.mocked(mockDeps.taskRepository.getQueued).mockResolvedValue(tasks);

      const result = await checker.runChecks();

      expect(result.testDataDetected).toBe(true);
      expect(result.unconfirmedPriorityCount).toBe(2);
      expect(result.warnings.some(w => w.type === 'test_data')).toBe(true);
      expect(result.warnings.some(w => w.type === 'unconfirmed_priority')).toBe(true);
      expect(result.warnings.some(w => w.type === 'missing_estimates')).toBe(true);
    });
  });
});

describe('DEFAULT_PREFLIGHT_CONFIG', () => {
  it('should have reasonable default values', () => {
    expect(DEFAULT_PREFLIGHT_CONFIG.opusLimitWarningThreshold).toBe(2);
    expect(DEFAULT_PREFLIGHT_CONFIG.sonnetLimitWarningThreshold).toBe(5);
    expect(DEFAULT_PREFLIGHT_CONFIG.skipSlack).toBe(false);
    expect(DEFAULT_PREFLIGHT_CONFIG.confirmationTimeoutMs).toBe(300000); // 5 minutes
  });
});
