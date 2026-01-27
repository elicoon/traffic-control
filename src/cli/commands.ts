/**
 * CLI commands for TrafficControl
 * Implements all CLI operations for the orchestrator
 */

import { TrafficControlConfig, ConfigLoader } from './config-loader.js';
import { Logger } from './logger.js';

/**
 * Result returned from command execution
 */
export interface CommandResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Command definition for help display
 */
export interface CommandDefinition {
  name: string;
  description: string;
  usage?: string;
  options?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

/**
 * Options for the start command
 */
export interface StartCommandOptions {
  configPath?: string;
}

/**
 * Options for adding a task
 */
export interface TaskAddOptions {
  description: string;
  projectId: string;
  priority: number;
}

/**
 * Options for listing tasks
 */
export interface TaskListOptions {
  status?: 'queued' | 'in_progress' | 'blocked';
}

/**
 * Options for generating reports
 */
export interface ReportOptions {
  format?: 'json' | 'text';
}

/**
 * Orchestration state interface (simplified)
 */
interface OrchestrationState {
  isRunning: boolean;
  activeAgents: Map<string, unknown>;
  pendingTasks: string[];
  lastCheckpoint: Date;
}

/**
 * Main loop interface (simplified for commands)
 */
interface MainLoopInterface {
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getState(): OrchestrationState;
}

/**
 * Agent manager interface for CLI
 */
interface AgentManagerInterface {
  getSessions(): Array<{
    sessionId: string;
    taskId: string;
    model: 'opus' | 'sonnet';
    status: 'active' | 'completed' | 'error';
    startedAt: Date;
  }>;
  getSessionMetrics(sessionId: string): {
    tokensUsed: number;
    turnsCompleted: number;
    questionsAsked: number;
  } | null;
}

/**
 * Backlog manager interface (simplified for commands)
 */
interface BacklogManagerInterface {
  addTask(task: { title: string; project_id: string; priority?: number; description?: string; tags?: string[] }): Promise<{ id: string; title: string }>;
  getTasks(filter?: { status?: string; project_id?: string; tags?: string[] }): Promise<Array<{
    id: string;
    title: string;
    status: string;
    priority: number;
    project_id: string;
    description?: string;
    tags?: string[];
    assigned_agent_id?: string;
  }>>;
  updateTask(taskId: string, updates: { title?: string; description?: string; priority?: number; tags?: string[] }): Promise<boolean>;
  cancelTask(taskId: string): Promise<boolean>;
  getBacklogSummary(): Promise<{
    totalQueued: number;
    totalInProgress: number;
    totalBlocked: number;
    totalCompleted: number;
    byProject: Record<string, number>;
  }>;
}

/**
 * Project repository interface (simplified for commands)
 */
interface ProjectRepositoryInterface {
  findAll(): Promise<Array<{ id: string; name: string; status: string; priority: number }>>;
  findById(id: string): Promise<{ id: string; name: string; status: string; priority: number } | null>;
  update(id: string, data: { status?: string; priority?: number }): Promise<void>;
  create(data: { name: string; description?: string; priority?: number }): Promise<{ id: string; name: string }>;
}

/**
 * Proposal repository interface
 */
interface ProposalRepositoryInterface {
  findPending(): Promise<Array<{
    id: string;
    title: string;
    description: string;
    impact_score: number;
    estimated_sessions_opus: number;
    estimated_sessions_sonnet: number;
    reasoning: string;
  }>>;
  approve(proposalIds: string[]): Promise<Array<{ id: string; title: string }>>;
  reject(proposalId: string, reason: string): Promise<{ id: string; title: string }>;
}

/**
 * Scheduler interface for capacity info
 */
interface SchedulerInterface {
  getCapacityInfo(): {
    opus: { current: number; limit: number };
    sonnet: { current: number; limit: number };
  };
  canSchedule(): boolean;
}

/**
 * Reporter interface (simplified for commands)
 */
interface ReporterInterface {
  generateReport(): Promise<Record<string, unknown>>;
  getMetrics(): Promise<{
    projectMetrics: Array<{
      projectId: string;
      projectName: string;
      tasksQueued: number;
      tasksInProgress: number;
      tasksCompleted: number;
      tokensUsed: number;
    }>;
    systemMetrics: {
      totalTasks: number;
      totalTokensUsed: number;
      agentUtilization: number;
    };
  }>;
}

/**
 * Config loader interface (simplified for commands)
 */
interface ConfigLoaderInterface {
  load(configPath?: string): TrafficControlConfig;
  validate(config: Partial<TrafficControlConfig>): TrafficControlConfig;
  toDisplayString(config: TrafficControlConfig): string;
}

/**
 * Context provided to commands
 */
export interface CommandContext {
  mainLoop?: MainLoopInterface;
  backlogManager?: BacklogManagerInterface;
  projectRepository?: ProjectRepositoryInterface;
  proposalRepository?: ProposalRepositoryInterface;
  agentManager?: AgentManagerInterface;
  scheduler?: SchedulerInterface;
  reporter?: ReporterInterface;
  configLoader: ConfigLoaderInterface;
  config: TrafficControlConfig;
}

/**
 * Command implementations
 */
export const Commands = {
  /**
   * Start the orchestrator
   */
  async start(context: CommandContext, options: StartCommandOptions): Promise<CommandResult> {
    try {
      if (!context.mainLoop) {
        return {
          success: false,
          message: 'Main loop not initialized',
        };
      }

      const state = context.mainLoop.getState();
      if (state.isRunning) {
        return {
          success: false,
          message: 'Orchestrator is already running',
        };
      }

      await context.mainLoop.start();
      Logger.info('Orchestrator started', { configPath: options.configPath });

      return {
        success: true,
        message: 'TrafficControl orchestrator started successfully',
        data: {
          startedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      Logger.error('Failed to start orchestrator', error instanceof Error ? error : undefined);
      return {
        success: false,
        message: `Failed to start orchestrator: ${errorMessage}`,
      };
    }
  },

  /**
   * Stop the orchestrator
   */
  async stop(context: CommandContext): Promise<CommandResult> {
    try {
      if (!context.mainLoop) {
        return {
          success: false,
          message: 'Main loop not initialized',
        };
      }

      const state = context.mainLoop.getState();
      if (!state.isRunning) {
        return {
          success: false,
          message: 'Orchestrator is not running',
        };
      }

      await context.mainLoop.stop();
      Logger.info('Orchestrator stopped');

      return {
        success: true,
        message: 'TrafficControl orchestrator stopped successfully',
        data: {
          stoppedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      Logger.error('Failed to stop orchestrator', error instanceof Error ? error : undefined);
      return {
        success: false,
        message: `Failed to stop orchestrator: ${errorMessage}`,
      };
    }
  },

  /**
   * Get orchestrator status
   */
  async status(context: CommandContext): Promise<CommandResult> {
    if (!context.mainLoop) {
      return {
        success: true,
        message: 'Orchestrator not initialized',
        data: {
          isRunning: false,
          activeAgents: 0,
          pendingTasks: 0,
        },
      };
    }

    const state = context.mainLoop.getState();
    const statusMessage = state.isRunning ? 'Orchestrator is running' : 'Orchestrator is stopped';

    return {
      success: true,
      message: statusMessage,
      data: {
        isRunning: state.isRunning,
        activeAgents: state.activeAgents.size,
        pendingTasks: state.pendingTasks.length,
        lastCheckpoint: state.lastCheckpoint.toISOString(),
      },
    };
  },

  /**
   * Add a task to the backlog
   */
  async taskAdd(context: CommandContext, options: TaskAddOptions): Promise<CommandResult> {
    // Validate inputs
    if (!options.description || options.description.trim() === '') {
      return {
        success: false,
        message: 'Task description is required',
      };
    }

    if (!options.projectId || options.projectId.trim() === '') {
      return {
        success: false,
        message: 'Project ID is required',
      };
    }

    if (options.priority < 1 || options.priority > 10) {
      return {
        success: false,
        message: 'Task priority must be between 1 and 10',
      };
    }

    if (!context.backlogManager) {
      return {
        success: false,
        message: 'Backlog manager not initialized',
      };
    }

    try {
      const task = await context.backlogManager.addTask({
        title: options.description,
        project_id: options.projectId,
        priority: options.priority,
      });

      Logger.info('Task added', { taskId: task.id, title: task.title });

      return {
        success: true,
        message: `Task added successfully: ${task.title}`,
        data: {
          taskId: task.id,
          title: task.title,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to add task: ${errorMessage}`,
      };
    }
  },

  /**
   * List tasks in the backlog
   */
  async taskList(context: CommandContext, options: TaskListOptions): Promise<CommandResult> {
    if (!context.backlogManager) {
      return {
        success: false,
        message: 'Backlog manager not initialized',
      };
    }

    try {
      const filter = options.status ? { status: options.status } : undefined;
      const tasks = await context.backlogManager.getTasks(filter);

      return {
        success: true,
        message: `Found ${tasks.length} task(s)`,
        data: {
          tasks,
          count: tasks.length,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to list tasks: ${errorMessage}`,
      };
    }
  },

  /**
   * Cancel a task
   */
  async taskCancel(context: CommandContext, taskId: string): Promise<CommandResult> {
    if (!taskId || taskId.trim() === '') {
      return {
        success: false,
        message: 'Task ID is required',
      };
    }

    if (!context.backlogManager) {
      return {
        success: false,
        message: 'Backlog manager not initialized',
      };
    }

    try {
      const success = await context.backlogManager.cancelTask(taskId);

      if (!success) {
        return {
          success: false,
          message: `Task not found: ${taskId}`,
        };
      }

      Logger.info('Task cancelled', { taskId });

      return {
        success: true,
        message: `Task cancelled: ${taskId}`,
        data: {
          taskId,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to cancel task: ${errorMessage}`,
      };
    }
  },

  /**
   * List all projects
   */
  async projectList(context: CommandContext): Promise<CommandResult> {
    if (!context.projectRepository) {
      return {
        success: false,
        message: 'Project repository not initialized',
      };
    }

    try {
      const projects = await context.projectRepository.findAll();

      return {
        success: true,
        message: `Found ${projects.length} project(s)`,
        data: {
          projects,
          count: projects.length,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to list projects: ${errorMessage}`,
      };
    }
  },

  /**
   * Pause a project
   */
  async projectPause(context: CommandContext, projectId: string): Promise<CommandResult> {
    if (!context.projectRepository) {
      return {
        success: false,
        message: 'Project repository not initialized',
      };
    }

    try {
      const project = await context.projectRepository.findById(projectId);

      if (!project) {
        return {
          success: false,
          message: `Project not found: ${projectId}`,
        };
      }

      if (project.status === 'paused') {
        return {
          success: false,
          message: `Project is already paused: ${project.name}`,
        };
      }

      await context.projectRepository.update(projectId, { status: 'paused' });
      Logger.info('Project paused', { projectId, projectName: project.name });

      return {
        success: true,
        message: `Project paused: ${project.name}`,
        data: {
          projectId,
          projectName: project.name,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to pause project: ${errorMessage}`,
      };
    }
  },

  /**
   * Resume a paused project
   */
  async projectResume(context: CommandContext, projectId: string): Promise<CommandResult> {
    if (!context.projectRepository) {
      return {
        success: false,
        message: 'Project repository not initialized',
      };
    }

    try {
      const project = await context.projectRepository.findById(projectId);

      if (!project) {
        return {
          success: false,
          message: `Project not found: ${projectId}`,
        };
      }

      if (project.status !== 'paused') {
        return {
          success: false,
          message: `Project is not paused: ${project.name}`,
        };
      }

      await context.projectRepository.update(projectId, { status: 'active' });
      Logger.info('Project resumed', { projectId, projectName: project.name });

      return {
        success: true,
        message: `Project resumed: ${project.name}`,
        data: {
          projectId,
          projectName: project.name,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to resume project: ${errorMessage}`,
      };
    }
  },

  /**
   * Generate a report
   */
  async report(context: CommandContext, options: ReportOptions): Promise<CommandResult> {
    if (!context.reporter) {
      return {
        success: false,
        message: 'Reporter not initialized',
      };
    }

    try {
      const report = await context.reporter.generateReport();
      const format = options.format || 'text';

      return {
        success: true,
        message: 'Report generated successfully',
        data: {
          format,
          report,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to generate report: ${errorMessage}`,
      };
    }
  },

  /**
   * Show current configuration
   */
  async configShow(context: CommandContext): Promise<CommandResult> {
    try {
      const displayString = context.configLoader.toDisplayString(context.config);

      return {
        success: true,
        message: 'Current configuration:',
        data: {
          config: displayString,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to display config: ${errorMessage}`,
      };
    }
  },

  /**
   * Validate a configuration file
   */
  async configValidate(context: CommandContext, configPath: string): Promise<CommandResult> {
    try {
      const config = context.configLoader.load(configPath);

      return {
        success: true,
        message: 'Configuration is valid',
        data: {
          configPath,
          config: context.configLoader.toDisplayString(config),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Configuration validation failed: ${errorMessage}`,
      };
    }
  },

  /**
   * List active agents
   */
  async agentList(context: CommandContext): Promise<CommandResult> {
    if (!context.agentManager) {
      return {
        success: false,
        message: 'Agent manager not initialized',
      };
    }

    try {
      const sessions = context.agentManager.getSessions();
      const activeSessions = sessions.filter(s => s.status === 'active');

      return {
        success: true,
        message: `${activeSessions.length} active agent(s)`,
        data: {
          agents: sessions.map(session => ({
            sessionId: session.sessionId,
            taskId: session.taskId,
            model: session.model,
            status: session.status,
            startedAt: session.startedAt.toISOString(),
          })),
          activeCount: activeSessions.length,
          totalCount: sessions.length,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to list agents: ${errorMessage}`,
      };
    }
  },

  /**
   * Get agent capacity status
   */
  async agentCapacity(context: CommandContext): Promise<CommandResult> {
    if (!context.scheduler) {
      return {
        success: false,
        message: 'Scheduler not initialized',
      };
    }

    try {
      const capacity = context.scheduler.getCapacityInfo();
      const canSchedule = context.scheduler.canSchedule();

      return {
        success: true,
        message: 'Agent capacity status',
        data: {
          opus: {
            current: capacity.opus.current,
            limit: capacity.opus.limit,
            available: capacity.opus.limit - capacity.opus.current,
          },
          sonnet: {
            current: capacity.sonnet.current,
            limit: capacity.sonnet.limit,
            available: capacity.sonnet.limit - capacity.sonnet.current,
          },
          canScheduleNewTasks: canSchedule,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to get capacity: ${errorMessage}`,
      };
    }
  },

  /**
   * Show backlog summary
   */
  async backlogSummary(context: CommandContext): Promise<CommandResult> {
    if (!context.backlogManager) {
      return {
        success: false,
        message: 'Backlog manager not initialized',
      };
    }

    try {
      const summary = await context.backlogManager.getBacklogSummary();

      return {
        success: true,
        message: 'Backlog summary',
        data: {
          totalQueued: summary.totalQueued,
          totalInProgress: summary.totalInProgress,
          totalBlocked: summary.totalBlocked,
          totalCompleted: summary.totalCompleted,
          byProject: summary.byProject,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to get backlog summary: ${errorMessage}`,
      };
    }
  },

  /**
   * List pending proposals
   */
  async proposalList(context: CommandContext): Promise<CommandResult> {
    if (!context.proposalRepository) {
      return {
        success: false,
        message: 'Proposal repository not initialized',
      };
    }

    try {
      const proposals = await context.proposalRepository.findPending();

      return {
        success: true,
        message: `${proposals.length} pending proposal(s)`,
        data: {
          proposals: proposals.map((p, index) => ({
            index: index + 1,
            id: p.id,
            title: p.title,
            description: p.description,
            impactScore: p.impact_score,
            estimatedSessionsOpus: p.estimated_sessions_opus,
            estimatedSessionsSonnet: p.estimated_sessions_sonnet,
            reasoning: p.reasoning,
          })),
          count: proposals.length,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to list proposals: ${errorMessage}`,
      };
    }
  },

  /**
   * Approve proposals
   */
  async proposalApprove(context: CommandContext, indices: string): Promise<CommandResult> {
    if (!context.proposalRepository) {
      return {
        success: false,
        message: 'Proposal repository not initialized',
      };
    }

    try {
      // First get all pending proposals
      const proposals = await context.proposalRepository.findPending();

      let proposalIds: string[] = [];

      if (indices.toLowerCase() === 'all') {
        proposalIds = proposals.map(p => p.id);
      } else {
        // Parse comma-separated indices (1-based)
        const indexList = indices.split(',').map(s => parseInt(s.trim(), 10) - 1);
        for (const idx of indexList) {
          if (idx >= 0 && idx < proposals.length) {
            proposalIds.push(proposals[idx].id);
          }
        }
      }

      if (proposalIds.length === 0) {
        return {
          success: false,
          message: 'No valid proposals to approve',
        };
      }

      const approved = await context.proposalRepository.approve(proposalIds);

      return {
        success: true,
        message: `Approved ${approved.length} proposal(s)`,
        data: {
          approved: approved.map(p => ({
            id: p.id,
            title: p.title,
          })),
          count: approved.length,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to approve proposals: ${errorMessage}`,
      };
    }
  },

  /**
   * Reject a proposal
   */
  async proposalReject(context: CommandContext, index: string, reason: string): Promise<CommandResult> {
    if (!context.proposalRepository) {
      return {
        success: false,
        message: 'Proposal repository not initialized',
      };
    }

    if (!reason || reason.trim() === '') {
      return {
        success: false,
        message: 'Rejection reason is required',
      };
    }

    try {
      // First get all pending proposals
      const proposals = await context.proposalRepository.findPending();
      const idx = parseInt(index, 10) - 1;

      if (idx < 0 || idx >= proposals.length) {
        return {
          success: false,
          message: `Invalid proposal index. Valid range: 1-${proposals.length}`,
        };
      }

      const proposalId = proposals[idx].id;
      const rejected = await context.proposalRepository.reject(proposalId, reason);

      return {
        success: true,
        message: `Rejected proposal: ${rejected.title}`,
        data: {
          id: rejected.id,
          title: rejected.title,
          reason,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to reject proposal: ${errorMessage}`,
      };
    }
  },

  /**
   * Update a task
   */
  async taskUpdate(context: CommandContext, taskId: string, updates: {
    title?: string;
    description?: string;
    priority?: number;
    tags?: string[];
  }): Promise<CommandResult> {
    if (!context.backlogManager) {
      return {
        success: false,
        message: 'Backlog manager not initialized',
      };
    }

    if (!taskId || taskId.trim() === '') {
      return {
        success: false,
        message: 'Task ID is required',
      };
    }

    try {
      const success = await context.backlogManager.updateTask(taskId, updates);

      if (!success) {
        return {
          success: false,
          message: `Task not found: ${taskId}`,
        };
      }

      return {
        success: true,
        message: `Task updated: ${taskId}`,
        data: {
          taskId,
          updates,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to update task: ${errorMessage}`,
      };
    }
  },

  /**
   * Create a new project
   */
  async projectCreate(context: CommandContext, name: string, options: {
    description?: string;
    priority?: number;
  }): Promise<CommandResult> {
    if (!name || name.trim() === '') {
      return {
        success: false,
        message: 'Project name is required',
      };
    }

    if (!context.projectRepository) {
      return {
        success: false,
        message: 'Project repository not initialized',
      };
    }

    try {
      const project = await context.projectRepository.create({
        name,
        description: options.description,
        priority: options.priority || 5,
      });

      Logger.info('Project created', { projectId: project.id, name: project.name });

      return {
        success: true,
        message: `Project created: ${project.name}`,
        data: {
          projectId: project.id,
          projectName: project.name,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to create project: ${errorMessage}`,
      };
    }
  },

  /**
   * Set project priority
   */
  async projectSetPriority(context: CommandContext, projectId: string, priority: number): Promise<CommandResult> {
    if (!projectId || projectId.trim() === '') {
      return {
        success: false,
        message: 'Project ID is required',
      };
    }

    if (priority < 1 || priority > 10) {
      return {
        success: false,
        message: 'Priority must be between 1 and 10',
      };
    }

    if (!context.projectRepository) {
      return {
        success: false,
        message: 'Project repository not initialized',
      };
    }

    try {
      const project = await context.projectRepository.findById(projectId);

      if (!project) {
        return {
          success: false,
          message: `Project not found: ${projectId}`,
        };
      }

      await context.projectRepository.update(projectId, { priority });
      Logger.info('Project priority updated', { projectId, priority });

      return {
        success: true,
        message: `Project priority updated: ${project.name} (priority: ${priority})`,
        data: {
          projectId,
          projectName: project.name,
          priority,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to update project priority: ${errorMessage}`,
      };
    }
  },

  /**
   * Enable Do Not Disturb mode
   */
  async dndEnable(context: CommandContext, durationMinutes?: number): Promise<CommandResult> {
    // DND mode would typically be stored in config or state
    // For now, return a placeholder response
    const duration = durationMinutes || 30;
    const until = new Date(Date.now() + duration * 60 * 1000);

    Logger.info('DND mode enabled', { duration, until });

    return {
      success: true,
      message: `Do Not Disturb enabled for ${duration} minutes`,
      data: {
        enabled: true,
        durationMinutes: duration,
        until: until.toISOString(),
      },
    };
  },

  /**
   * Disable Do Not Disturb mode
   */
  async dndDisable(context: CommandContext): Promise<CommandResult> {
    Logger.info('DND mode disabled');

    return {
      success: true,
      message: 'Do Not Disturb disabled',
      data: {
        enabled: false,
      },
    };
  },

  /**
   * Get DND status
   */
  async dndStatus(context: CommandContext): Promise<CommandResult> {
    // This would typically check state
    // For now, return a placeholder
    return {
      success: true,
      message: 'DND status',
      data: {
        enabled: false,
      },
    };
  },

  /**
   * Get list of available commands
   */
  getCommandList(): CommandDefinition[] {
    return [
      {
        name: 'start',
        description: 'Start the TrafficControl orchestrator',
        usage: 'trafficcontrol start [--config <path>]',
        options: [
          { name: '--config', description: 'Path to config file', required: false },
        ],
      },
      {
        name: 'stop',
        description: 'Stop the TrafficControl orchestrator gracefully',
        usage: 'trafficcontrol stop',
      },
      {
        name: 'status',
        description: 'Show current orchestrator status',
        usage: 'trafficcontrol status',
      },
      {
        name: 'task add',
        description: 'Add a new task to the backlog',
        usage: 'trafficcontrol task add "description" --project <id> --priority <1-10>',
        options: [
          { name: '--project', description: 'Project ID for the task', required: true },
          { name: '--priority', description: 'Priority level (1-10)', required: true },
        ],
      },
      {
        name: 'task list',
        description: 'List tasks in the backlog',
        usage: 'trafficcontrol task list [--status <status>]',
        options: [
          { name: '--status', description: 'Filter by status (queued|in_progress|blocked)', required: false },
        ],
      },
      {
        name: 'task cancel',
        description: 'Cancel a task',
        usage: 'trafficcontrol task cancel <task-id>',
      },
      {
        name: 'project list',
        description: 'List all projects',
        usage: 'trafficcontrol project list',
      },
      {
        name: 'project create',
        description: 'Create a new project',
        usage: 'trafficcontrol project create <name> [--description <text>] [--priority <1-10>]',
        options: [
          { name: '--description', description: 'Project description', required: false },
          { name: '--priority', description: 'Priority level (1-10)', required: false },
        ],
      },
      {
        name: 'project pause',
        description: 'Pause a project',
        usage: 'trafficcontrol project pause <project-id>',
      },
      {
        name: 'project resume',
        description: 'Resume a paused project',
        usage: 'trafficcontrol project resume <project-id>',
      },
      {
        name: 'project set-priority',
        description: 'Set project priority',
        usage: 'trafficcontrol project set-priority <project-id> <1-10>',
      },
      {
        name: 'report',
        description: 'Generate a status report',
        usage: 'trafficcontrol report [--format <json|text>]',
        options: [
          { name: '--format', description: 'Output format (json|text)', required: false },
        ],
      },
      {
        name: 'config show',
        description: 'Show current configuration (secrets masked)',
        usage: 'trafficcontrol config show',
      },
      {
        name: 'config validate',
        description: 'Validate a configuration file',
        usage: 'trafficcontrol config validate <path>',
      },
      {
        name: 'dnd',
        description: 'Manage Do Not Disturb mode',
        usage: 'trafficcontrol dnd [on <minutes>|off|status]',
      },
    ];
  },
};
