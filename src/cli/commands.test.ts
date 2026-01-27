import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Commands,
  CommandContext,
  CommandResult,
  StartCommandOptions,
  TaskAddOptions,
  TaskListOptions,
  ReportOptions,
} from './commands.js';

// Mock dependencies
const mockMainLoop = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn().mockReturnValue({
    isRunning: false,
    activeAgents: new Map(),
    pendingTasks: [],
    lastCheckpoint: new Date(),
  }),
};

const mockBacklogManager = {
  addTask: vi.fn().mockResolvedValue({ id: 'task-123', title: 'New Task' }),
  getTasks: vi.fn().mockResolvedValue([]),
  cancelTask: vi.fn().mockResolvedValue(true),
};

const mockProjectRepository = {
  findAll: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn().mockResolvedValue(null),
};

const mockReporter = {
  generateReport: vi.fn().mockResolvedValue({ summary: 'Test report' }),
};

const mockConfigLoader = {
  load: vi.fn().mockReturnValue({
    supabaseUrl: 'https://test.supabase.co',
    supabaseKey: 'test-key',
    slackToken: 'xoxb-test',
    slackChannelId: 'C12345',
    maxConcurrentAgents: 5,
    pollIntervalMs: 5000,
  }),
  validate: vi.fn().mockReturnValue({
    supabaseUrl: 'https://test.supabase.co',
    supabaseKey: 'test-key',
    slackToken: 'xoxb-test',
    slackChannelId: 'C12345',
  }),
  toDisplayString: vi.fn().mockReturnValue('{ "config": "display" }'),
};

function createMockContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    mainLoop: mockMainLoop as any,
    backlogManager: mockBacklogManager as any,
    projectRepository: mockProjectRepository as any,
    reporter: mockReporter as any,
    configLoader: mockConfigLoader as any,
    config: {
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
      slackToken: 'xoxb-test',
      slackChannelId: 'C12345',
      maxConcurrentAgents: 5,
      opusSessionLimit: 1,
      sonnetSessionLimit: 2,
      pollIntervalMs: 5000,
      reportIntervalMs: 43200000,
      learningsPath: './learnings',
      retrospectivesPath: './retrospectives',
      agentsPath: './agents.md',
      quietHoursStart: 0,
      quietHoursEnd: 7,
      batchIntervalMs: 1800000,
      logLevel: 'info',
    },
    ...overrides,
  };
}

describe('Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('should start the orchestrator', async () => {
      const context = createMockContext();

      const result = await Commands.start(context, {});

      expect(result.success).toBe(true);
      expect(mockMainLoop.start).toHaveBeenCalled();
      expect(result.message).toContain('started');
    });

    it('should return error if orchestrator is already running', async () => {
      mockMainLoop.getState.mockReturnValueOnce({
        isRunning: true,
        activeAgents: new Map(),
        pendingTasks: [],
        lastCheckpoint: new Date(),
      });

      const context = createMockContext();
      const result = await Commands.start(context, {});

      expect(result.success).toBe(false);
      expect(result.message).toContain('already running');
      expect(mockMainLoop.start).not.toHaveBeenCalled();
    });

    it('should handle start failure', async () => {
      mockMainLoop.start.mockRejectedValueOnce(new Error('Start failed'));

      const context = createMockContext();
      const result = await Commands.start(context, {});

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to start');
    });
  });

  describe('stop', () => {
    it('should stop the orchestrator', async () => {
      mockMainLoop.getState.mockReturnValueOnce({
        isRunning: true,
        activeAgents: new Map(),
        pendingTasks: [],
        lastCheckpoint: new Date(),
      });

      const context = createMockContext();
      const result = await Commands.stop(context);

      expect(result.success).toBe(true);
      expect(mockMainLoop.stop).toHaveBeenCalled();
      expect(result.message).toContain('stopped');
    });

    it('should return error if orchestrator is not running', async () => {
      const context = createMockContext();
      const result = await Commands.stop(context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not running');
    });

    it('should handle stop failure', async () => {
      mockMainLoop.getState.mockReturnValueOnce({
        isRunning: true,
        activeAgents: new Map(),
        pendingTasks: [],
        lastCheckpoint: new Date(),
      });
      mockMainLoop.stop.mockRejectedValueOnce(new Error('Stop failed'));

      const context = createMockContext();
      const result = await Commands.stop(context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to stop');
    });
  });

  describe('status', () => {
    it('should return status when running', async () => {
      const agents = new Map([
        ['agent-1', { taskId: 'task-1', status: 'running' }],
        ['agent-2', { taskId: 'task-2', status: 'running' }],
      ]);

      mockMainLoop.getState.mockReturnValueOnce({
        isRunning: true,
        activeAgents: agents,
        pendingTasks: ['task-3', 'task-4'],
        lastCheckpoint: new Date(),
      });

      const context = createMockContext();
      const result = await Commands.status(context);

      expect(result.success).toBe(true);
      expect(result.data?.isRunning).toBe(true);
      expect(result.data?.activeAgents).toBe(2);
      expect(result.data?.pendingTasks).toBe(2);
    });

    it('should return status when not running', async () => {
      const context = createMockContext();
      const result = await Commands.status(context);

      expect(result.success).toBe(true);
      expect(result.data?.isRunning).toBe(false);
    });
  });

  describe('taskAdd', () => {
    it('should add a task to the backlog', async () => {
      mockBacklogManager.addTask.mockResolvedValueOnce({
        id: 'task-456',
        title: 'Test Task',
        project_id: 'project-1',
        priority: 5,
      });

      const context = createMockContext();
      const options: TaskAddOptions = {
        description: 'Test Task',
        projectId: 'project-1',
        priority: 5,
      };

      const result = await Commands.taskAdd(context, options);

      expect(result.success).toBe(true);
      expect(mockBacklogManager.addTask).toHaveBeenCalledWith({
        title: 'Test Task',
        project_id: 'project-1',
        priority: 5,
      });
      expect(result.data?.taskId).toBe('task-456');
    });

    it('should validate priority is between 1-10', async () => {
      const context = createMockContext();
      const options: TaskAddOptions = {
        description: 'Test Task',
        projectId: 'project-1',
        priority: 15,
      };

      const result = await Commands.taskAdd(context, options);

      expect(result.success).toBe(false);
      expect(result.message).toContain('priority');
    });

    it('should require description', async () => {
      const context = createMockContext();
      const options: TaskAddOptions = {
        description: '',
        projectId: 'project-1',
        priority: 5,
      };

      const result = await Commands.taskAdd(context, options);

      expect(result.success).toBe(false);
      expect(result.message).toContain('description');
    });

    it('should require projectId', async () => {
      const context = createMockContext();
      const options: TaskAddOptions = {
        description: 'Test Task',
        projectId: '',
        priority: 5,
      };

      const result = await Commands.taskAdd(context, options);

      expect(result.success).toBe(false);
      expect(result.message.toLowerCase()).toContain('project');
    });
  });

  describe('taskList', () => {
    it('should list all tasks by default', async () => {
      mockBacklogManager.getTasks.mockResolvedValueOnce([
        { id: 'task-1', title: 'Task 1', status: 'queued' },
        { id: 'task-2', title: 'Task 2', status: 'in_progress' },
      ]);

      const context = createMockContext();
      const result = await Commands.taskList(context, {});

      expect(result.success).toBe(true);
      expect(result.data?.tasks).toHaveLength(2);
    });

    it('should filter tasks by status', async () => {
      mockBacklogManager.getTasks.mockResolvedValueOnce([
        { id: 'task-1', title: 'Task 1', status: 'queued' },
      ]);

      const context = createMockContext();
      const options: TaskListOptions = { status: 'queued' };
      const result = await Commands.taskList(context, options);

      expect(result.success).toBe(true);
      expect(mockBacklogManager.getTasks).toHaveBeenCalledWith({ status: 'queued' });
    });
  });

  describe('taskCancel', () => {
    it('should cancel a task', async () => {
      mockBacklogManager.cancelTask.mockResolvedValueOnce(true);

      const context = createMockContext();
      const result = await Commands.taskCancel(context, 'task-123');

      expect(result.success).toBe(true);
      expect(mockBacklogManager.cancelTask).toHaveBeenCalledWith('task-123');
    });

    it('should return error if task not found', async () => {
      mockBacklogManager.cancelTask.mockResolvedValueOnce(false);

      const context = createMockContext();
      const result = await Commands.taskCancel(context, 'task-unknown');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should require task ID', async () => {
      const context = createMockContext();
      const result = await Commands.taskCancel(context, '');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Task ID');
    });
  });

  describe('projectList', () => {
    it('should list all projects', async () => {
      mockProjectRepository.findAll.mockResolvedValueOnce([
        { id: 'project-1', name: 'Project 1', status: 'active' },
        { id: 'project-2', name: 'Project 2', status: 'paused' },
      ]);

      const context = createMockContext();
      const result = await Commands.projectList(context);

      expect(result.success).toBe(true);
      expect(result.data?.projects).toHaveLength(2);
    });
  });

  describe('projectPause', () => {
    it('should pause a project', async () => {
      mockProjectRepository.findById.mockResolvedValueOnce({
        id: 'project-1',
        name: 'Project 1',
        status: 'active',
      });

      const context = createMockContext();
      const result = await Commands.projectPause(context, 'project-1');

      expect(result.success).toBe(true);
      expect(mockProjectRepository.update).toHaveBeenCalledWith('project-1', { status: 'paused' });
    });

    it('should return error if project not found', async () => {
      mockProjectRepository.findById.mockResolvedValueOnce(null);

      const context = createMockContext();
      const result = await Commands.projectPause(context, 'unknown');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should return error if project already paused', async () => {
      mockProjectRepository.findById.mockResolvedValueOnce({
        id: 'project-1',
        name: 'Project 1',
        status: 'paused',
      });

      const context = createMockContext();
      const result = await Commands.projectPause(context, 'project-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('already paused');
    });
  });

  describe('projectResume', () => {
    it('should resume a paused project', async () => {
      mockProjectRepository.findById.mockResolvedValueOnce({
        id: 'project-1',
        name: 'Project 1',
        status: 'paused',
      });

      const context = createMockContext();
      const result = await Commands.projectResume(context, 'project-1');

      expect(result.success).toBe(true);
      expect(mockProjectRepository.update).toHaveBeenCalledWith('project-1', { status: 'active' });
    });

    it('should return error if project not paused', async () => {
      mockProjectRepository.findById.mockResolvedValueOnce({
        id: 'project-1',
        name: 'Project 1',
        status: 'active',
      });

      const context = createMockContext();
      const result = await Commands.projectResume(context, 'project-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not paused');
    });
  });

  describe('report', () => {
    it('should generate a text report by default', async () => {
      mockReporter.generateReport.mockResolvedValueOnce({
        summary: 'Test Summary',
        activeAgents: 2,
        completedTasks: 5,
      });

      const context = createMockContext();
      const result = await Commands.report(context, {});

      expect(result.success).toBe(true);
      expect(mockReporter.generateReport).toHaveBeenCalled();
    });

    it('should generate JSON report when format is json', async () => {
      mockReporter.generateReport.mockResolvedValueOnce({
        summary: 'Test Summary',
        activeAgents: 2,
        completedTasks: 5,
      });

      const context = createMockContext();
      const options: ReportOptions = { format: 'json' };
      const result = await Commands.report(context, options);

      expect(result.success).toBe(true);
      expect(result.data?.format).toBe('json');
    });
  });

  describe('configShow', () => {
    it('should display current configuration', async () => {
      const context = createMockContext();
      const result = await Commands.configShow(context);

      expect(result.success).toBe(true);
      expect(mockConfigLoader.toDisplayString).toHaveBeenCalled();
    });
  });

  describe('configValidate', () => {
    it('should validate a config file', async () => {
      const context = createMockContext();
      const result = await Commands.configValidate(context, './config.json');

      expect(result.success).toBe(true);
      expect(mockConfigLoader.load).toHaveBeenCalledWith('./config.json');
    });

    it('should return validation errors', async () => {
      mockConfigLoader.load.mockImplementationOnce(() => {
        throw new Error('Missing required field: supabaseUrl');
      });

      const context = createMockContext();
      const result = await Commands.configValidate(context, './invalid.json');

      expect(result.success).toBe(false);
      expect(result.message).toContain('validation');
    });
  });

  describe('getCommandList', () => {
    it('should return list of available commands', () => {
      const commands = Commands.getCommandList();

      expect(commands).toContainEqual(expect.objectContaining({ name: 'start' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'stop' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'status' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'task add' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'task list' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'task cancel' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'project list' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'project pause' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'project resume' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'report' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'config show' }));
      expect(commands).toContainEqual(expect.objectContaining({ name: 'config validate' }));
    });

    it('should include description for each command', () => {
      const commands = Commands.getCommandList();

      commands.forEach(cmd => {
        expect(cmd.description).toBeDefined();
        expect(cmd.description.length).toBeGreaterThan(0);
      });
    });
  });
});
