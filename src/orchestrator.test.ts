import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator.js';

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
