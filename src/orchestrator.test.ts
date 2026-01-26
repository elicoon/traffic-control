import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import { ContextBudgetManager } from './orchestrator/index.js';

// Mock dependencies
vi.mock('./db/client.js', () => ({
  createSupabaseClient: vi.fn(() => ({}))
}));

vi.mock('./slack/bot.js', () => ({
  createSlackBot: vi.fn(() => ({ start: vi.fn() })),
  sendMessage: vi.fn(),
  formatQuestion: vi.fn((p, q) => `Question from ${p}: ${q}`),
  formatBlocker: vi.fn((p, b) => `Blocker from ${p}: ${b}`),
  startBot: vi.fn()
}));

vi.mock('./slack/handlers.js', () => ({
  setMessageHandler: vi.fn(),
  setReactionHandler: vi.fn(),
  setCommandHandler: vi.fn(),
  setupHandlers: vi.fn()
}));

vi.mock('./db/repositories/projects.js', () => ({
  ProjectRepository: class MockProjectRepository {
    getById = vi.fn();
    listActive = vi.fn();
  }
}));

vi.mock('./db/repositories/tasks.js', () => ({
  TaskRepository: class MockTaskRepository {
    getById = vi.fn();
    getQueued = vi.fn().mockResolvedValue([]);
    assignAgent = vi.fn();
  }
}));

vi.mock('./agent/manager.js', () => ({
  AgentManager: class MockAgentManager {
    onEvent = vi.fn();
    getActiveSessions = vi.fn().mockReturnValue([]);
    getSession = vi.fn();
    spawnAgent = vi.fn();
    injectMessage = vi.fn();
  }
}));

vi.mock('./scheduler/index.js', () => ({
  Scheduler: class MockScheduler {
    addTask = vi.fn();
    removeTask = vi.fn();
    canSchedule = vi.fn().mockReturnValue(false);
    scheduleAll = vi.fn().mockResolvedValue([]);
    scheduleNext = vi.fn().mockResolvedValue({ status: 'idle', scheduled: 0 });
    releaseCapacity = vi.fn();
    syncCapacity = vi.fn();
    getStats = vi.fn().mockReturnValue({
      queuedTasks: 0,
      capacity: {
        opus: { current: 0, limit: 5, available: 5, utilization: 0 },
        sonnet: { current: 0, limit: 10, available: 10, utilization: 0 }
      }
    });
  }
}));

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    vi.stubEnv('SLACK_CHANNEL', 'test-channel');
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-key');
    vi.clearAllMocks();
    orchestrator = new Orchestrator();
  });

  it('should create an instance', () => {
    expect(orchestrator).toBeDefined();
  });

  it('should not be running initially', () => {
    expect(orchestrator.isRunning()).toBe(false);
  });

  it('should track pending questions', () => {
    expect(orchestrator.getPendingQuestions()).toEqual([]);
  });

  it('should use default channel if SLACK_CHANNEL not set', () => {
    vi.unstubAllEnvs();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-key');

    const newOrchestrator = new Orchestrator();
    expect(newOrchestrator).toBeDefined();
  });

  it('should expose scheduler stats', () => {
    const stats = orchestrator.getSchedulerStats();
    expect(stats).toBeDefined();
    expect(stats.queuedTasks).toBe(0);
    expect(stats.capacity.opus).toBeDefined();
    expect(stats.capacity.sonnet).toBeDefined();
  });

  describe('start and stop', () => {
    it('should set running to true when started', async () => {
      // Don't actually run the loop - just test the state change
      const startPromise = orchestrator.start();

      // Give it a moment to start
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(orchestrator.isRunning()).toBe(true);

      // Stop it
      await orchestrator.stop();
      expect(orchestrator.isRunning()).toBe(false);
    });

    it('should not start twice if already running', async () => {
      const startPromise1 = orchestrator.start();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Try to start again
      await orchestrator.start();

      // Should still be running normally
      expect(orchestrator.isRunning()).toBe(true);

      await orchestrator.stop();
    });
  });
});

describe('Context Compression', () => {
  describe('ContextBudgetManager updateEntry', () => {
    let manager: ContextBudgetManager;

    beforeEach(() => {
      manager = new ContextBudgetManager({
        maxTokens: 1000,
        targetUtilization: 0.5, // 500 tokens threshold
      });
    });

    it('should compress task entries to single line summary', () => {
      // Add a task entry with realistic content
      manager.addEntry({
        category: 'task',
        content: 'This is a detailed task description with lots of context about what needs to be done including specifications and requirements...',
        compressible: true,
        referenceId: 'task-123',
      });

      const entries = manager.getAllEntries();
      const entryId = entries[0].id;
      const originalTokens = entries[0].tokens;

      // Simulate compression by updating with summarized content
      const summary = `Task task-123: delegated`;
      manager.updateEntry(entryId, summary);

      const updatedEntry = manager.getEntry(entryId);
      expect(updatedEntry?.tokens).toBeLessThan(originalTokens);
    });
  });

  describe('Compression triggers and behavior', () => {
    let manager: ContextBudgetManager;

    beforeEach(() => {
      manager = new ContextBudgetManager({
        maxTokens: 1000,
        targetUtilization: 0.5, // 500 tokens threshold
        warningThreshold: 0.4, // 400 tokens warning
      });
    });

    it('should identify when compression is needed (over 50%)', () => {
      // Add entries to exceed 50% threshold
      manager.addEntry({ category: 'system', tokens: 100, compressible: false });
      manager.addEntry({ category: 'task', tokens: 200, compressible: true, referenceId: 'task-1' });
      manager.addEntry({ category: 'task', tokens: 250, compressible: true, referenceId: 'task-2' });

      // Total: 550 tokens, over 500 threshold
      expect(manager.isWithinBudget()).toBe(false);
      expect(manager.getCompressibleEntries().length).toBe(2);
    });

    it('should bring budget under 50% after compression', () => {
      // Add entries to exceed threshold
      manager.addEntry({ category: 'system', tokens: 100, compressible: false });
      manager.addEntry({ category: 'task', tokens: 200, compressible: true, referenceId: 'task-1' });
      manager.addEntry({ category: 'task', tokens: 200, compressible: true, referenceId: 'task-2' });
      manager.addEntry({ category: 'history', tokens: 100, compressible: true, referenceId: 'history-1' });

      // Total: 600 tokens, over 500 threshold
      expect(manager.isWithinBudget()).toBe(false);

      // Simulate compression: process oldest compressible entries
      const compressible = manager.getCompressibleEntries();

      // Process entries until within budget
      for (const entry of compressible) {
        if (manager.isWithinBudget()) break;

        if (entry.category === 'task') {
          // Summarize task to single line (~6 tokens)
          manager.updateEntry(entry.id, `Task ${entry.referenceId}: delegated`);
        } else {
          // Remove history/response entries
          manager.removeEntry(entry.id);
        }
      }

      // Should now be within budget
      expect(manager.isWithinBudget()).toBe(true);
      expect(manager.getBudget().currentEstimate).toBeLessThan(500);
    });

    it('should process oldest entries first during compression', async () => {
      // Add entries with time gaps
      manager.addEntry({ category: 'task', tokens: 150, compressible: true, referenceId: 'oldest' });
      await new Promise(resolve => setTimeout(resolve, 10));
      manager.addEntry({ category: 'task', tokens: 150, compressible: true, referenceId: 'middle' });
      await new Promise(resolve => setTimeout(resolve, 10));
      manager.addEntry({ category: 'task', tokens: 150, compressible: true, referenceId: 'newest' });
      manager.addEntry({ category: 'system', tokens: 100, compressible: false });

      // Total: 550 tokens, over 500 threshold
      const compressible = manager.getCompressibleEntries();

      // Verify oldest first ordering
      expect(compressible[0].referenceId).toBe('oldest');
      expect(compressible[1].referenceId).toBe('middle');
      expect(compressible[2].referenceId).toBe('newest');

      // Compress oldest entry
      manager.updateEntry(compressible[0].id, `Task oldest: delegated`);

      // Should now be within budget after compressing oldest
      expect(manager.isWithinBudget()).toBe(true);
    });

    it('should handle case with no compressible entries', () => {
      // Add only non-compressible entries
      manager.addEntry({ category: 'system', tokens: 600, compressible: false });

      // Over budget but nothing to compress
      expect(manager.isWithinBudget()).toBe(false);
      expect(manager.getCompressibleEntries().length).toBe(0);
    });

    it('should remove history entries entirely during compression', () => {
      manager.addEntry({ category: 'system', tokens: 100, compressible: false });
      manager.addEntry({ category: 'history', tokens: 200, compressible: true, referenceId: 'h1' });
      manager.addEntry({ category: 'history', tokens: 200, compressible: true, referenceId: 'h2' });
      manager.addEntry({ category: 'task', tokens: 100, compressible: true, referenceId: 't1' });

      // Total: 600 tokens, need to get under 500
      const compressible = manager.getCompressibleEntries();

      // Process all entries based on their category (simulating summarizeEntry logic)
      for (const entry of compressible) {
        if (manager.isWithinBudget()) break;

        if (entry.category === 'history') {
          // History entries are removed entirely
          manager.removeEntry(entry.id);
        } else if (entry.category === 'task') {
          // Task entries are summarized
          manager.updateEntry(entry.id, `Task ${entry.referenceId}: delegated`);
        }
      }

      // After compression, we should be within budget
      expect(manager.isWithinBudget()).toBe(true);
      // Verify at least one history entry was removed (the oldest one at minimum)
      const remainingHistoryEntries = manager.getAllEntries().filter(e => e.category === 'history');
      expect(remainingHistoryEntries.length).toBeLessThan(2);
    });
  });
});
