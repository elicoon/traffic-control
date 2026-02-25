import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SlackCommandHandler, SlackCommandHandlerDeps } from './command-handler.js';

describe('SlackCommandHandler', () => {
  let handler: SlackCommandHandler;
  let mockDeps: SlackCommandHandlerDeps;

  beforeEach(() => {
    // Create mock dependencies
    mockDeps = {
      // Mock orchestrator methods
      getStatus: vi.fn().mockResolvedValue({
        isRunning: true,
        activeAgents: 2,
        pendingTasks: 5,
        pausedProjects: []
      }),
      pause: vi.fn().mockResolvedValue(true),
      resume: vi.fn().mockResolvedValue(true),
      pauseProject: vi.fn().mockResolvedValue(true),
      resumeProject: vi.fn().mockResolvedValue(true),

      // Mock backlog manager methods
      addTask: vi.fn().mockResolvedValue({ id: 'task-123', title: 'New task' }),
      getBacklogSummary: vi.fn().mockResolvedValue({
        totalQueued: 10,
        totalInProgress: 3,
        totalBlocked: 1,
        totalPendingProposals: 2,
        isBacklogLow: false,
        threshold: 5
      }),
      prioritizeProject: vi.fn().mockResolvedValue(true),

      // Mock reporter methods
      generateReport: vi.fn().mockResolvedValue({
        metrics: {
          projectMetrics: [],
          systemMetrics: {
            totalProjects: 1,
            totalTasksQueued: 5,
            totalTasksInProgress: 2,
            totalTasksBlocked: 1,
            totalTasksCompletedToday: 3,
            totalTasksCompletedThisWeek: 10,
            totalTokensOpus: 5000,
            totalTokensSonnet: 3000,
            totalSessions: 5,
            opusUtilization: 50,
            sonnetUtilization: 60
          }
        },
        recommendations: {
          projectRecommendations: new Map(),
          systemRecommendations: [],
          actionItems: []
        },
        timestamp: new Date()
      }),

      // Mock notification manager methods
      setDnd: vi.fn(),
      disableDnd: vi.fn(),
      getDndRemainingMs: vi.fn().mockReturnValue(0)
    };

    handler = new SlackCommandHandler(mockDeps);
  });

  describe('status command', () => {
    it('should return current status', async () => {
      const result = await handler.handleCommand('status', [], 'user-1');

      expect(mockDeps.getStatus).toHaveBeenCalled();
      expect(result).toContain('Running');
      expect(result).toContain('2'); // active agents
    });

    it('should show paused projects in status', async () => {
      mockDeps.getStatus = vi.fn().mockResolvedValue({
        isRunning: true,
        activeAgents: 1,
        pendingTasks: 3,
        pausedProjects: ['ProjectA', 'ProjectB']
      });

      const result = await handler.handleCommand('status', [], 'user-1');

      expect(result).toContain('Paused');
      expect(result).toContain('ProjectA');
    });
  });

  describe('pause command', () => {
    it('should pause all agents when no project specified', async () => {
      const result = await handler.handleCommand('pause', [], 'user-1');

      expect(mockDeps.pause).toHaveBeenCalled();
      expect(result).toContain('Paused');
    });

    it('should pause specific project when specified', async () => {
      const result = await handler.handleCommand('pause', ['ProjectA'], 'user-1');

      expect(mockDeps.pauseProject).toHaveBeenCalledWith('ProjectA');
      expect(result).toContain('ProjectA');
      expect(result).toContain('paused');
    });

    it('should return error if project not found', async () => {
      mockDeps.pauseProject = vi.fn().mockResolvedValue(false);

      const result = await handler.handleCommand('pause', ['NonExistent'], 'user-1');

      expect(result).toContain('not found');
    });
  });

  describe('resume command', () => {
    it('should resume all agents when no project specified', async () => {
      const result = await handler.handleCommand('resume', [], 'user-1');

      expect(mockDeps.resume).toHaveBeenCalled();
      expect(result).toContain('Resumed');
    });

    it('should resume specific project when specified', async () => {
      const result = await handler.handleCommand('resume', ['ProjectA'], 'user-1');

      expect(mockDeps.resumeProject).toHaveBeenCalledWith('ProjectA');
      expect(result).toContain('ProjectA');
      expect(result).toContain('resumed');
    });

    it('should return error if project not found', async () => {
      mockDeps.resumeProject = vi.fn().mockResolvedValue(false);

      const result = await handler.handleCommand('resume', ['NonExistent'], 'user-1');

      expect(result).toContain('not found');
    });
  });

  describe('add task command', () => {
    it('should add task with description', async () => {
      const result = await handler.handleCommand('add', ['task:', 'Fix', 'the', 'login', 'bug'], 'user-1');

      expect(mockDeps.addTask).toHaveBeenCalledWith('Fix the login bug');
      expect(result).toContain('Added');
      expect(result).toContain('task-123');
    });

    it('should handle task description without colon prefix', async () => {
      const result = await handler.handleCommand('add', ['Implement', 'new', 'feature'], 'user-1');

      expect(mockDeps.addTask).toHaveBeenCalledWith('Implement new feature');
    });

    it('should return error if no description provided', async () => {
      const result = await handler.handleCommand('add', [], 'user-1');

      expect(mockDeps.addTask).not.toHaveBeenCalled();
      expect(result).toContain('description');
    });

    it('should handle add with task: prefix', async () => {
      // The full command would be "add task: description here"
      const result = await handler.handleCommand('add', ['task:', 'description', 'here'], 'user-1');

      expect(mockDeps.addTask).toHaveBeenCalledWith('description here');
    });
  });

  describe('prioritize command', () => {
    it('should prioritize specified project', async () => {
      const result = await handler.handleCommand('prioritize', ['ProjectA'], 'user-1');

      expect(mockDeps.prioritizeProject).toHaveBeenCalledWith('ProjectA');
      expect(result).toContain('ProjectA');
      expect(result).toContain('prioritized');
    });

    it('should return error if no project specified', async () => {
      const result = await handler.handleCommand('prioritize', [], 'user-1');

      expect(mockDeps.prioritizeProject).not.toHaveBeenCalled();
      expect(result).toContain('project name');
    });

    it('should return error if project not found', async () => {
      mockDeps.prioritizeProject = vi.fn().mockResolvedValue(false);

      const result = await handler.handleCommand('prioritize', ['NonExistent'], 'user-1');

      expect(result).toContain('not found');
    });
  });

  describe('report command', () => {
    it('should generate and return status report', async () => {
      const result = await handler.handleCommand('report', [], 'user-1');

      expect(mockDeps.generateReport).toHaveBeenCalled();
      expect(result).toContain('Report');
    });
  });

  describe('dnd command', () => {
    it('should enable DND with specified duration', async () => {
      const result = await handler.handleCommand('dnd', ['30m'], 'user-1');

      expect(mockDeps.setDnd).toHaveBeenCalledWith(30 * 60 * 1000);
      expect(result).toContain('Do Not Disturb');
      expect(result).toContain('30');
    });

    it('should parse hours duration', async () => {
      const result = await handler.handleCommand('dnd', ['2h'], 'user-1');

      expect(mockDeps.setDnd).toHaveBeenCalledWith(2 * 60 * 60 * 1000);
    });

    it('should default to 30 minutes if no duration specified', async () => {
      const result = await handler.handleCommand('dnd', [], 'user-1');

      expect(mockDeps.setDnd).toHaveBeenCalledWith(30 * 60 * 1000);
    });

    it('should disable DND with "off" argument', async () => {
      const result = await handler.handleCommand('dnd', ['off'], 'user-1');

      expect(mockDeps.disableDnd).toHaveBeenCalled();
      expect(result).toContain('disabled');
    });

    it('should show remaining DND time when already active', async () => {
      mockDeps.getDndRemainingMs = vi.fn().mockReturnValue(15 * 60 * 1000); // 15 minutes

      const result = await handler.handleCommand('dnd', [], 'user-1');

      // Should extend DND, not show error
      expect(mockDeps.setDnd).toHaveBeenCalled();
    });
  });

  describe('dnd validation', () => {
    it('should reject duration exceeding 24 hours', async () => {
      const result = await handler.handleCommand('dnd', ['25h'], 'user-1');

      expect(mockDeps.setDnd).not.toHaveBeenCalled();
      expect(result).toContain('between 1 minute and 24 hours');
    });

    it('should reject duration shorter than 1 minute', async () => {
      // "0" is parsed as 0 minutes = 0ms, which is below the 1-minute minimum
      const result = await handler.handleCommand('dnd', ['0'], 'user-1');

      expect(mockDeps.setDnd).not.toHaveBeenCalled();
      expect(result).toContain('between 1 minute and 24 hours');
    });

    it('should reject negative duration', async () => {
      const result = await handler.handleCommand('dnd', ['-30m'], 'user-1');

      expect(mockDeps.setDnd).not.toHaveBeenCalled();
      expect(result).toContain('Invalid duration');
    });

    it('should reject non-numeric duration', async () => {
      const result = await handler.handleCommand('dnd', ['abc'], 'user-1');

      expect(mockDeps.setDnd).not.toHaveBeenCalled();
      expect(result).toContain('Invalid duration');
    });

    it('should accept valid duration within bounds', async () => {
      const result = await handler.handleCommand('dnd', ['2h'], 'user-1');

      expect(mockDeps.setDnd).toHaveBeenCalledWith(2 * 60 * 60 * 1000);
      expect(result).toContain('Do Not Disturb enabled');
    });

    it('should accept exactly 24 hours', async () => {
      const result = await handler.handleCommand('dnd', ['24h'], 'user-1');

      expect(mockDeps.setDnd).toHaveBeenCalledWith(24 * 60 * 60 * 1000);
      expect(result).toContain('Do Not Disturb enabled');
    });

    it('should accept exactly 1 minute', async () => {
      const result = await handler.handleCommand('dnd', ['1m'], 'user-1');

      expect(mockDeps.setDnd).toHaveBeenCalledWith(60 * 1000);
      expect(result).toContain('Do Not Disturb enabled');
    });

    it('should still allow dnd off when validation is active', async () => {
      const result = await handler.handleCommand('dnd', ['off'], 'user-1');

      expect(mockDeps.disableDnd).toHaveBeenCalled();
      expect(result).toContain('disabled');
    });
  });

  describe('validateDndDuration', () => {
    it('should return null for valid duration', () => {
      expect(SlackCommandHandler.validateDndDuration(30 * 60 * 1000)).toBeNull();
    });

    it('should return error for duration below minimum', () => {
      expect(SlackCommandHandler.validateDndDuration(30 * 1000)).toContain('between 1 minute and 24 hours');
    });

    it('should return error for duration above maximum', () => {
      expect(SlackCommandHandler.validateDndDuration(25 * 60 * 60 * 1000)).toContain('between 1 minute and 24 hours');
    });

    it('should return null for exact minimum (1 minute)', () => {
      expect(SlackCommandHandler.validateDndDuration(60 * 1000)).toBeNull();
    });

    it('should return null for exact maximum (24 hours)', () => {
      expect(SlackCommandHandler.validateDndDuration(24 * 60 * 60 * 1000)).toBeNull();
    });
  });

  describe('help command', () => {
    it('should return help text', async () => {
      const result = await handler.handleCommand('help', [], 'user-1');

      expect(result).toContain('status');
      expect(result).toContain('pause');
      expect(result).toContain('resume');
      expect(result).toContain('add');
      expect(result).toContain('dnd');
    });
  });

  describe('unknown command', () => {
    it('should return error for unknown command', async () => {
      const result = await handler.handleCommand('unknown', [], 'user-1');

      expect(result).toContain('Unknown command');
      expect(result).toContain('help');
    });
  });

  describe('error handling', () => {
    it('should return error message on failure', async () => {
      const errorDeps = {
        ...mockDeps,
        getStatus: vi.fn().mockRejectedValue(new Error('Connection failed'))
      };
      const errorHandler = new SlackCommandHandler(errorDeps);

      const result = await errorHandler.handleCommand('status', [], 'user-1');

      expect(result).toContain('Error');
      expect(result).toContain('Connection failed');
    });
  });

  describe('command parsing', () => {
    it('should handle case-insensitive commands', async () => {
      const result = await handler.handleCommand('STATUS', [], 'user-1');

      expect(mockDeps.getStatus).toHaveBeenCalled();
    });

    it('should trim whitespace from arguments', async () => {
      const result = await handler.handleCommand('pause', ['  ProjectA  '], 'user-1');

      expect(mockDeps.pauseProject).toHaveBeenCalledWith('ProjectA');
    });
  });

  describe('duration parsing', () => {
    it('should parse minutes', () => {
      const ms = SlackCommandHandler.parseDuration('30m');
      expect(ms).toBe(30 * 60 * 1000);
    });

    it('should parse hours', () => {
      const ms = SlackCommandHandler.parseDuration('2h');
      expect(ms).toBe(2 * 60 * 60 * 1000);
    });

    it('should parse numeric minutes as default', () => {
      const ms = SlackCommandHandler.parseDuration('45');
      expect(ms).toBe(45 * 60 * 1000);
    });

    it('should return null for invalid duration', () => {
      const ms = SlackCommandHandler.parseDuration('invalid');
      expect(ms).toBeNull();
    });

    it('should return null for negative duration', () => {
      const ms = SlackCommandHandler.parseDuration('-30m');
      expect(ms).toBeNull();
    });
  });

  describe('formatDuration', () => {
    it('should format minutes', () => {
      const str = SlackCommandHandler.formatDuration(30 * 60 * 1000);
      expect(str).toContain('30');
      expect(str).toContain('minute');
    });

    it('should format hours and minutes', () => {
      const str = SlackCommandHandler.formatDuration(90 * 60 * 1000);
      expect(str).toContain('1');
      expect(str).toContain('hour');
      expect(str).toContain('30');
      expect(str).toContain('minute');
    });

    it('should handle exact hours', () => {
      const str = SlackCommandHandler.formatDuration(2 * 60 * 60 * 1000);
      expect(str).toContain('2');
      expect(str).toContain('hour');
    });
  });
});
