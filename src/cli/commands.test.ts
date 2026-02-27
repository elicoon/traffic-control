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
  updateTask: vi.fn().mockResolvedValue(true),
  getBacklogSummary: vi.fn().mockResolvedValue({
    totalQueued: 3,
    totalInProgress: 1,
    totalBlocked: 0,
    totalCompleted: 10,
    byProject: { 'proj-1': 3, 'proj-2': 1 },
  }),
};

const mockProjectRepository = {
  findAll: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue({ id: 'proj-new', name: 'New Project' }),
};

const mockAgentManager = {
  getSessions: vi.fn().mockReturnValue([]),
  getSessionMetrics: vi.fn().mockReturnValue(null),
};

const mockScheduler = {
  getCapacityInfo: vi.fn().mockReturnValue({
    opus: { current: 0, limit: 1 },
    sonnet: { current: 1, limit: 2 },
  }),
  canSchedule: vi.fn().mockReturnValue(true),
};

const mockProposalRepository = {
  findPending: vi.fn().mockResolvedValue([]),
  approve: vi.fn().mockResolvedValue([]),
  reject: vi.fn().mockResolvedValue({ id: 'prop-1', title: 'Rejected Proposal' }),
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
    agentManager: mockAgentManager as any,
    scheduler: mockScheduler as any,
    proposalRepository: mockProposalRepository as any,
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

  describe('agentList', () => {
    it('should return empty list when no agents running', async () => {
      const context = createMockContext();
      const result = await Commands.agentList(context);
      expect(result.success).toBe(true);
      expect(result.data?.agents).toHaveLength(0);
    });

    it('should return active sessions', async () => {
      mockAgentManager.getSessions.mockReturnValueOnce([
        { sessionId: 's-1', taskId: 't-1', model: 'sonnet', status: 'active', startedAt: new Date() },
        { sessionId: 's-2', taskId: 't-2', model: 'opus', status: 'completed', startedAt: new Date() },
      ]);
      const context = createMockContext();
      const result = await Commands.agentList(context);
      expect(result.success).toBe(true);
      expect(result.data?.agents).toHaveLength(2);
      expect(result.data?.activeCount).toBe(1);
    });

    it('should return error when agentManager not initialized', async () => {
      const context = createMockContext({ agentManager: undefined });
      const result = await Commands.agentList(context);
      expect(result.success).toBe(false);
      expect(result.message).toContain('not initialized');
    });
  });

  describe('agentCapacity', () => {
    it('should return capacity status', async () => {
      const context = createMockContext();
      const result = await Commands.agentCapacity(context);
      expect(result.success).toBe(true);
      expect(result.data?.opus).toBeDefined();
      expect(result.data?.sonnet).toBeDefined();
      expect(result.data?.canScheduleNewTasks).toBe(true);
    });

    it('should return error when scheduler not initialized', async () => {
      const context = createMockContext({ scheduler: undefined });
      const result = await Commands.agentCapacity(context);
      expect(result.success).toBe(false);
      expect(result.message).toContain('not initialized');
    });
  });

  describe('backlogSummary', () => {
    it('should return backlog summary', async () => {
      const context = createMockContext();
      const result = await Commands.backlogSummary(context);
      expect(result.success).toBe(true);
      expect(result.data?.totalQueued).toBe(3);
      expect(result.data?.totalInProgress).toBe(1);
    });

    it('should return error when backlogManager not initialized', async () => {
      const context = createMockContext({ backlogManager: undefined });
      const result = await Commands.backlogSummary(context);
      expect(result.success).toBe(false);
    });

    it('should handle backlog summary failure', async () => {
      mockBacklogManager.getBacklogSummary.mockRejectedValueOnce(new Error('DB error'));
      const context = createMockContext();
      const result = await Commands.backlogSummary(context);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to get backlog summary');
    });
  });

  describe('proposalList', () => {
    it('should return empty list when no proposals', async () => {
      const context = createMockContext();
      const result = await Commands.proposalList(context);
      expect(result.success).toBe(true);
      expect(result.data?.proposals).toHaveLength(0);
    });

    it('should return pending proposals', async () => {
      mockProposalRepository.findPending.mockResolvedValueOnce([
        { id: 'p-1', title: 'Proposal 1', description: 'Desc', impact_score: 8,
          estimated_sessions_opus: 1, estimated_sessions_sonnet: 2, reasoning: 'Good idea' },
      ]);
      const context = createMockContext();
      const result = await Commands.proposalList(context);
      expect(result.success).toBe(true);
      expect(result.data?.proposals).toHaveLength(1);
    });

    it('should return error when proposalRepository not initialized', async () => {
      const context = createMockContext({ proposalRepository: undefined });
      const result = await Commands.proposalList(context);
      expect(result.success).toBe(false);
    });
  });

  describe('proposalApprove', () => {
    it('should return error when proposalRepository not initialized', async () => {
      const context = createMockContext({ proposalRepository: undefined });
      const result = await Commands.proposalApprove(context, '1');
      expect(result.success).toBe(false);
    });

    it('should approve all proposals when indices is "all"', async () => {
      mockProposalRepository.findPending.mockResolvedValueOnce([
        { id: 'p-1', title: 'Proposal 1', description: 'Desc', impact_score: 8,
          estimated_sessions_opus: 1, estimated_sessions_sonnet: 2, reasoning: 'Good' },
      ]);
      mockProposalRepository.approve.mockResolvedValueOnce([{ id: 'p-1', title: 'Proposal 1' }]);
      const context = createMockContext();
      const result = await Commands.proposalApprove(context, 'all');
      expect(result.success).toBe(true);
      expect(result.data?.count).toBe(1);
    });

    it('should return error when no valid proposals to approve', async () => {
      mockProposalRepository.findPending.mockResolvedValueOnce([]);
      const context = createMockContext();
      const result = await Commands.proposalApprove(context, '1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('No valid proposals');
    });

    it('should approve by index', async () => {
      mockProposalRepository.findPending.mockResolvedValueOnce([
        { id: 'p-1', title: 'Proposal 1', description: '', impact_score: 5,
          estimated_sessions_opus: 1, estimated_sessions_sonnet: 1, reasoning: '' },
        { id: 'p-2', title: 'Proposal 2', description: '', impact_score: 5,
          estimated_sessions_opus: 1, estimated_sessions_sonnet: 1, reasoning: '' },
      ]);
      mockProposalRepository.approve.mockResolvedValueOnce([{ id: 'p-2', title: 'Proposal 2' }]);
      const context = createMockContext();
      const result = await Commands.proposalApprove(context, '2');
      expect(result.success).toBe(true);
    });
  });

  describe('proposalReject', () => {
    it('should return error when proposalRepository not initialized', async () => {
      const context = createMockContext({ proposalRepository: undefined });
      const result = await Commands.proposalReject(context, '1', 'not needed');
      expect(result.success).toBe(false);
    });

    it('should return error when reason is empty', async () => {
      const context = createMockContext();
      const result = await Commands.proposalReject(context, '1', '');
      expect(result.success).toBe(false);
      expect(result.message).toContain('reason is required');
    });

    it('should return error for invalid index', async () => {
      mockProposalRepository.findPending.mockResolvedValueOnce([
        { id: 'p-1', title: 'P1', description: '', impact_score: 5,
          estimated_sessions_opus: 1, estimated_sessions_sonnet: 1, reasoning: '' },
      ]);
      const context = createMockContext();
      const result = await Commands.proposalReject(context, '5', 'not needed');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid proposal index');
    });

    it('should reject valid proposal', async () => {
      mockProposalRepository.findPending.mockResolvedValueOnce([
        { id: 'p-1', title: 'P1', description: '', impact_score: 5,
          estimated_sessions_opus: 1, estimated_sessions_sonnet: 1, reasoning: '' },
      ]);
      mockProposalRepository.reject.mockResolvedValueOnce({ id: 'p-1', title: 'P1' });
      const context = createMockContext();
      const result = await Commands.proposalReject(context, '1', 'not needed');
      expect(result.success).toBe(true);
      expect(result.data?.reason).toBe('not needed');
    });
  });

  describe('taskUpdate', () => {
    it('should return error when backlogManager not initialized', async () => {
      const context = createMockContext({ backlogManager: undefined });
      const result = await Commands.taskUpdate(context, 'task-1', { title: 'New Title' });
      expect(result.success).toBe(false);
    });

    it('should return error when task ID is empty', async () => {
      const context = createMockContext();
      const result = await Commands.taskUpdate(context, '', { title: 'New Title' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Task ID is required');
    });

    it('should return error when task not found', async () => {
      mockBacklogManager.updateTask.mockResolvedValueOnce(false);
      const context = createMockContext();
      const result = await Commands.taskUpdate(context, 'task-999', { title: 'New' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should update task successfully', async () => {
      mockBacklogManager.updateTask.mockResolvedValueOnce(true);
      const context = createMockContext();
      const result = await Commands.taskUpdate(context, 'task-1', { title: 'New Title', priority: 5 });
      expect(result.success).toBe(true);
      expect(result.message).toContain('task-1');
    });
  });

  describe('projectCreate', () => {
    it('should return error when name is empty', async () => {
      const context = createMockContext();
      const result = await Commands.projectCreate(context, '', {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('name is required');
    });

    it('should return error when projectRepository not initialized', async () => {
      const context = createMockContext({ projectRepository: undefined });
      const result = await Commands.projectCreate(context, 'My Project', {});
      expect(result.success).toBe(false);
    });

    it('should create project successfully', async () => {
      mockProjectRepository.create.mockResolvedValueOnce({ id: 'proj-1', name: 'My Project' });
      const context = createMockContext();
      const result = await Commands.projectCreate(context, 'My Project', { description: 'Desc', priority: 7 });
      expect(result.success).toBe(true);
      expect(result.data?.projectId).toBe('proj-1');
    });

    it('should handle project creation failure', async () => {
      mockProjectRepository.create.mockRejectedValueOnce(new Error('DB error'));
      const context = createMockContext();
      const result = await Commands.projectCreate(context, 'My Project', {});
      expect(result.success).toBe(false);
    });
  });

  describe('projectSetPriority', () => {
    it('should return error when projectId is empty', async () => {
      const context = createMockContext();
      const result = await Commands.projectSetPriority(context, '', 5);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Project ID is required');
    });

    it('should return error for priority out of range', async () => {
      const context = createMockContext();
      const result = await Commands.projectSetPriority(context, 'proj-1', 0);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Priority must be between 1 and 10');
    });

    it('should return error when projectRepository not initialized', async () => {
      const context = createMockContext({ projectRepository: undefined });
      const result = await Commands.projectSetPriority(context, 'proj-1', 5);
      expect(result.success).toBe(false);
    });

    it('should return error when project not found', async () => {
      mockProjectRepository.findById.mockResolvedValueOnce(null);
      const context = createMockContext();
      const result = await Commands.projectSetPriority(context, 'proj-999', 5);
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should set project priority successfully', async () => {
      mockProjectRepository.findById.mockResolvedValueOnce({ id: 'proj-1', name: 'Test Project', status: 'active', priority: 3 });
      const context = createMockContext();
      const result = await Commands.projectSetPriority(context, 'proj-1', 8);
      expect(result.success).toBe(true);
      expect(result.data?.priority).toBe(8);
    });
  });

  describe('dndEnable', () => {
    it('should enable DND with default duration', async () => {
      const context = createMockContext();
      const result = await Commands.dndEnable(context);
      expect(result.success).toBe(true);
      expect(result.data?.durationMinutes).toBe(30);
      expect(result.data?.enabled).toBe(true);
    });

    it('should enable DND with custom duration', async () => {
      const context = createMockContext();
      const result = await Commands.dndEnable(context, 60);
      expect(result.success).toBe(true);
      expect(result.data?.durationMinutes).toBe(60);
    });
  });

  describe('dndDisable', () => {
    it('should disable DND', async () => {
      const context = createMockContext();
      const result = await Commands.dndDisable(context);
      expect(result.success).toBe(true);
      expect(result.data?.enabled).toBe(false);
    });
  });

  describe('dndStatus', () => {
    it('should return DND status', async () => {
      const context = createMockContext();
      const result = await Commands.dndStatus(context);
      expect(result.success).toBe(true);
      expect(result.data?.enabled).toBe(false);
    });
  });

  describe('error catch paths', () => {
    it('should handle agentList when agentManager.getSessions throws', async () => {
      mockAgentManager.getSessions.mockImplementationOnce(() => { throw new Error('manager error'); });
      const context = createMockContext();
      const result = await Commands.agentList(context);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to list agents');
    });

    it('should handle agentCapacity when scheduler throws', async () => {
      mockScheduler.getCapacityInfo.mockImplementationOnce(() => { throw new Error('scheduler error'); });
      const context = createMockContext();
      const result = await Commands.agentCapacity(context);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to get capacity');
    });

    it('should handle proposalList when repository throws', async () => {
      mockProposalRepository.findPending.mockRejectedValueOnce(new Error('DB error'));
      const context = createMockContext();
      const result = await Commands.proposalList(context);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to list proposals');
    });

    it('should handle proposalApprove when approve throws', async () => {
      mockProposalRepository.findPending.mockResolvedValueOnce([
        { id: 'p-1', title: 'P1', description: '', impact_score: 5,
          estimated_sessions_opus: 1, estimated_sessions_sonnet: 1, reasoning: '' },
      ]);
      mockProposalRepository.approve.mockRejectedValueOnce(new Error('approve error'));
      const context = createMockContext();
      const result = await Commands.proposalApprove(context, '1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to approve proposals');
    });

    it('should handle proposalReject when repository throws', async () => {
      mockProposalRepository.findPending.mockResolvedValueOnce([
        { id: 'p-1', title: 'P1', description: '', impact_score: 5,
          estimated_sessions_opus: 1, estimated_sessions_sonnet: 1, reasoning: '' },
      ]);
      mockProposalRepository.reject.mockRejectedValueOnce(new Error('DB error'));
      const context = createMockContext();
      const result = await Commands.proposalReject(context, '1', 'not needed');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to reject proposal');
    });

    it('should handle taskUpdate when backlogManager throws', async () => {
      mockBacklogManager.updateTask.mockRejectedValueOnce(new Error('DB write failed'));
      const context = createMockContext();
      const result = await Commands.taskUpdate(context, 'task-1', { title: 'New' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to update task');
    });

    it('should handle projectSetPriority when repository update throws', async () => {
      mockProjectRepository.findById.mockResolvedValueOnce({ id: 'p-1', name: 'Project 1', status: 'active', priority: 3 });
      mockProjectRepository.update.mockRejectedValueOnce(new Error('DB error'));
      const context = createMockContext();
      const result = await Commands.projectSetPriority(context, 'p-1', 5);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to update project priority');
    });
  });

  describe('status without mainLoop', () => {
    it('should return not initialized when mainLoop is absent', async () => {
      const context = createMockContext({ mainLoop: undefined });
      const result = await Commands.status(context);
      expect(result.success).toBe(true);
      expect(result.message).toContain('not initialized');
      expect(result.data?.isRunning).toBe(false);
    });
  });

  describe('report and configShow error paths', () => {
    it('should return error when reporter not initialized', async () => {
      const context = createMockContext({ reporter: undefined });
      const result = await Commands.report(context, {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('Reporter not initialized');
    });

    it('should return error when reporter.generateReport throws', async () => {
      mockReporter.generateReport.mockRejectedValueOnce(new Error('report generation failed'));
      const context = createMockContext();
      const result = await Commands.report(context, {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to generate report');
    });

    it('should return error when configLoader.toDisplayString throws', async () => {
      mockConfigLoader.toDisplayString.mockImplementationOnce(() => { throw new Error('config display failed'); });
      const context = createMockContext();
      const result = await Commands.configShow(context);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to display config');
    });
  });
});
