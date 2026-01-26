import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { StateManager, OrchestrationState, AgentState } from './state-manager.js';

// Mock fs module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
}));

describe('StateManager', () => {
  let stateManager: StateManager;
  const testStatePath = '/tmp/test-state.json';

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager({ stateFilePath: testStatePath });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create StateManager with default config', () => {
      const manager = new StateManager();
      expect(manager).toBeDefined();
    });

    it('should create StateManager with custom config', () => {
      const manager = new StateManager({
        stateFilePath: '/custom/path/state.json',
        autoSaveIntervalMs: 5000,
      });
      expect(manager).toBeDefined();
    });
  });

  describe('getState', () => {
    it('should return initial state when no state loaded', () => {
      const state = stateManager.getState();

      expect(state.isRunning).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.activeAgents).toBeInstanceOf(Map);
      expect(state.activeAgents.size).toBe(0);
      expect(state.pendingTasks).toEqual([]);
    });
  });

  describe('updateState', () => {
    it('should update isRunning state', () => {
      stateManager.updateState({ isRunning: true });

      const state = stateManager.getState();
      expect(state.isRunning).toBe(true);
    });

    it('should update isPaused state', () => {
      stateManager.updateState({ isPaused: true });

      const state = stateManager.getState();
      expect(state.isPaused).toBe(true);
    });

    it('should update pendingTasks', () => {
      stateManager.updateState({ pendingTasks: ['task-1', 'task-2'] });

      const state = stateManager.getState();
      expect(state.pendingTasks).toEqual(['task-1', 'task-2']);
    });

    it('should update lastCheckpoint', () => {
      const now = new Date();
      stateManager.updateState({ lastCheckpoint: now });

      const state = stateManager.getState();
      expect(state.lastCheckpoint).toEqual(now);
    });
  });

  describe('addAgent', () => {
    it('should add an agent to active agents', () => {
      const agentState: AgentState = {
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      };

      stateManager.addAgent(agentState);

      const state = stateManager.getState();
      expect(state.activeAgents.size).toBe(1);
      expect(state.activeAgents.get('session-1')).toEqual(agentState);
    });

    it('should allow adding multiple agents', () => {
      const agent1: AgentState = {
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      };

      const agent2: AgentState = {
        sessionId: 'session-2',
        taskId: 'task-2',
        model: 'sonnet',
        status: 'running',
        startedAt: new Date(),
      };

      stateManager.addAgent(agent1);
      stateManager.addAgent(agent2);

      const state = stateManager.getState();
      expect(state.activeAgents.size).toBe(2);
    });
  });

  describe('updateAgent', () => {
    it('should update an existing agent', () => {
      const agentState: AgentState = {
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      };

      stateManager.addAgent(agentState);
      stateManager.updateAgent('session-1', { status: 'blocked' });

      const state = stateManager.getState();
      expect(state.activeAgents.get('session-1')?.status).toBe('blocked');
    });

    it('should throw if agent not found', () => {
      expect(() => {
        stateManager.updateAgent('non-existent', { status: 'blocked' });
      }).toThrow('Agent non-existent not found');
    });
  });

  describe('removeAgent', () => {
    it('should remove an agent from active agents', () => {
      const agentState: AgentState = {
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      };

      stateManager.addAgent(agentState);
      stateManager.removeAgent('session-1');

      const state = stateManager.getState();
      expect(state.activeAgents.size).toBe(0);
    });

    it('should not throw if agent not found', () => {
      expect(() => {
        stateManager.removeAgent('non-existent');
      }).not.toThrow();
    });
  });

  describe('saveState', () => {
    it('should save state to file', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await stateManager.saveState();

      expect(fs.writeFile).toHaveBeenCalled();
      const [filePath, content] = vi.mocked(fs.writeFile).mock.calls[0];
      expect(filePath).toBe(testStatePath);

      const savedState = JSON.parse(content as string);
      expect(savedState).toHaveProperty('isRunning');
      expect(savedState).toHaveProperty('isPaused');
      expect(savedState).toHaveProperty('activeAgents');
      expect(savedState).toHaveProperty('pendingTasks');
      expect(savedState).toHaveProperty('lastCheckpoint');
    });

    it('should update lastCheckpoint when saving', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const beforeSave = new Date();
      await stateManager.saveState();
      const afterSave = new Date();

      const state = stateManager.getState();
      expect(state.lastCheckpoint.getTime()).toBeGreaterThanOrEqual(beforeSave.getTime());
      expect(state.lastCheckpoint.getTime()).toBeLessThanOrEqual(afterSave.getTime());
    });

    it('should serialize Map to array for JSON', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const agentState: AgentState = {
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      };

      stateManager.addAgent(agentState);
      await stateManager.saveState();

      const [, content] = vi.mocked(fs.writeFile).mock.calls[0];
      const savedState = JSON.parse(content as string);
      expect(Array.isArray(savedState.activeAgents)).toBe(true);
      expect(savedState.activeAgents.length).toBe(1);
    });
  });

  describe('loadState', () => {
    it('should load state from file', async () => {
      const savedState = {
        isRunning: true,
        isPaused: false,
        activeAgents: [
          {
            sessionId: 'session-1',
            taskId: 'task-1',
            model: 'opus',
            status: 'running',
            startedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        pendingTasks: ['task-2'],
        lastCheckpoint: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(savedState));

      await stateManager.loadState();

      const state = stateManager.getState();
      expect(state.isRunning).toBe(true);
      expect(state.activeAgents.size).toBe(1);
      expect(state.activeAgents.get('session-1')?.taskId).toBe('task-1');
      expect(state.pendingTasks).toEqual(['task-2']);
    });

    it('should return false if file does not exist', async () => {
      const error = new Error('ENOENT');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const loaded = await stateManager.loadState();

      expect(loaded).toBe(false);
    });

    it('should throw for other file errors', async () => {
      const error = new Error('Permission denied');
      (error as NodeJS.ErrnoException).code = 'EACCES';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      await expect(stateManager.loadState()).rejects.toThrow('Permission denied');
    });

    it('should throw for invalid JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('not valid json');

      await expect(stateManager.loadState()).rejects.toThrow();
    });
  });

  describe('clearState', () => {
    it('should reset state to initial values', () => {
      const agentState: AgentState = {
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      };

      stateManager.addAgent(agentState);
      stateManager.updateState({ isRunning: true, pendingTasks: ['task-1'] });

      stateManager.clearState();

      const state = stateManager.getState();
      expect(state.isRunning).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.activeAgents.size).toBe(0);
      expect(state.pendingTasks).toEqual([]);
    });
  });

  describe('hasActiveAgents', () => {
    it('should return false when no agents', () => {
      expect(stateManager.hasActiveAgents()).toBe(false);
    });

    it('should return true when agents exist', () => {
      const agentState: AgentState = {
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      };

      stateManager.addAgent(agentState);

      expect(stateManager.hasActiveAgents()).toBe(true);
    });
  });

  describe('getAgentsByStatus', () => {
    it('should return agents filtered by status', () => {
      const runningAgent: AgentState = {
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      };

      const blockedAgent: AgentState = {
        sessionId: 'session-2',
        taskId: 'task-2',
        model: 'sonnet',
        status: 'blocked',
        startedAt: new Date(),
      };

      stateManager.addAgent(runningAgent);
      stateManager.addAgent(blockedAgent);

      const runningAgents = stateManager.getAgentsByStatus('running');
      const blockedAgents = stateManager.getAgentsByStatus('blocked');

      expect(runningAgents.length).toBe(1);
      expect(runningAgents[0].sessionId).toBe('session-1');
      expect(blockedAgents.length).toBe(1);
      expect(blockedAgents[0].sessionId).toBe('session-2');
    });
  });

  describe('auto-save', () => {
    it('should start auto-save when enabled', async () => {
      vi.useFakeTimers();
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const manager = new StateManager({
        stateFilePath: testStatePath,
        autoSaveIntervalMs: 1000,
      });

      manager.startAutoSave();

      // Advance timer
      await vi.advanceTimersByTimeAsync(1000);

      expect(fs.writeFile).toHaveBeenCalled();

      manager.stopAutoSave();
      vi.useRealTimers();
    });

    it('should stop auto-save', async () => {
      vi.useFakeTimers();
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const manager = new StateManager({
        stateFilePath: testStatePath,
        autoSaveIntervalMs: 1000,
      });

      manager.startAutoSave();
      manager.stopAutoSave();

      // Advance timer - should not save
      await vi.advanceTimersByTimeAsync(2000);

      expect(fs.writeFile).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
