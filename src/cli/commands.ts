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
 * Backlog manager interface (simplified for commands)
 */
interface BacklogManagerInterface {
  addTask(task: { title: string; project_id: string; priority?: number }): Promise<{ id: string; title: string }>;
  getTasks(filter?: { status?: string }): Promise<Array<{ id: string; title: string; status: string }>>;
  cancelTask(taskId: string): Promise<boolean>;
}

/**
 * Project repository interface (simplified for commands)
 */
interface ProjectRepositoryInterface {
  findAll(): Promise<Array<{ id: string; name: string; status: string }>>;
  findById(id: string): Promise<{ id: string; name: string; status: string } | null>;
  update(id: string, data: { status: string }): Promise<void>;
}

/**
 * Reporter interface (simplified for commands)
 */
interface ReporterInterface {
  generateReport(): Promise<Record<string, unknown>>;
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
    ];
  },
};
