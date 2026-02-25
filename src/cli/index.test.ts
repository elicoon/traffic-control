import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLI, CLIOptions, parseArgs, formatOutput } from './index.js';
import { Commands, CommandResult } from './commands.js';
import { ConfigLoader } from './config-loader.js';
import { Logger } from './logger.js';
import pkg from '../../package.json' with { type: 'json' };

// Mock dependencies
vi.mock('./commands.js', async () => {
  const actual = await vi.importActual('./commands.js');
  return {
    ...actual,
    Commands: {
      start: vi.fn().mockResolvedValue({ success: true, message: 'Started' }),
      stop: vi.fn().mockResolvedValue({ success: true, message: 'Stopped' }),
      status: vi.fn().mockResolvedValue({ success: true, message: 'Running', data: { isRunning: true } }),
      taskAdd: vi.fn().mockResolvedValue({ success: true, message: 'Task added' }),
      taskList: vi.fn().mockResolvedValue({ success: true, message: 'Tasks', data: { tasks: [] } }),
      taskCancel: vi.fn().mockResolvedValue({ success: true, message: 'Cancelled' }),
      projectList: vi.fn().mockResolvedValue({ success: true, message: 'Projects', data: { projects: [] } }),
      projectPause: vi.fn().mockResolvedValue({ success: true, message: 'Paused' }),
      projectResume: vi.fn().mockResolvedValue({ success: true, message: 'Resumed' }),
      report: vi.fn().mockResolvedValue({ success: true, message: 'Report generated' }),
      configShow: vi.fn().mockResolvedValue({ success: true, message: 'Config', data: { config: '{}' } }),
      configValidate: vi.fn().mockResolvedValue({ success: true, message: 'Valid' }),
      getCommandList: vi.fn().mockReturnValue([
        { name: 'start', description: 'Start the orchestrator' },
        { name: 'stop', description: 'Stop the orchestrator' },
      ]),
    },
  };
});

vi.mock('./config-loader.js', () => ({
  ConfigLoader: {
    load: vi.fn().mockReturnValue({
      supabaseUrl: 'https://test.supabase.co',
      supabaseKey: 'test-key',
      slackToken: 'xoxb-test',
      slackChannelId: 'C12345',
      maxConcurrentAgents: 5,
      pollIntervalMs: 5000,
      logLevel: 'info',
    }),
    validate: vi.fn().mockReturnValue({}),
    toDisplayString: vi.fn().mockReturnValue('{}'),
    fromEnv: vi.fn().mockReturnValue({}),
  },
  ConfigValidationError: class ConfigValidationError extends Error {
    errors: string[];
    constructor(errors: string[]) {
      super('Validation failed');
      this.errors = errors;
    }
  },
}));

vi.mock('./logger.js', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    setLevel: vi.fn(),
    setLevelFromString: vi.fn(),
    initFromEnv: vi.fn(),
    reset: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  },
}));

describe('parseArgs', () => {
  it('should parse start command', () => {
    const args = ['start'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('start');
    expect(parsed.subcommand).toBeUndefined();
  });

  it('should parse start command with config option', () => {
    const args = ['start', '--config', './config.json'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('start');
    expect(parsed.options.config).toBe('./config.json');
  });

  it('should parse stop command', () => {
    const args = ['stop'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('stop');
  });

  it('should parse status command', () => {
    const args = ['status'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('status');
  });

  it('should parse task add command', () => {
    const args = ['task', 'add', 'Fix bug', '--project', 'proj-1', '--priority', '5'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('task');
    expect(parsed.subcommand).toBe('add');
    expect(parsed.args).toContain('Fix bug');
    expect(parsed.options.project).toBe('proj-1');
    expect(parsed.options.priority).toBe('5');
  });

  it('should parse task list command', () => {
    const args = ['task', 'list', '--status', 'queued'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('task');
    expect(parsed.subcommand).toBe('list');
    expect(parsed.options.status).toBe('queued');
  });

  it('should parse task cancel command', () => {
    const args = ['task', 'cancel', 'task-123'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('task');
    expect(parsed.subcommand).toBe('cancel');
    expect(parsed.args).toContain('task-123');
  });

  it('should parse project list command', () => {
    const args = ['project', 'list'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('project');
    expect(parsed.subcommand).toBe('list');
  });

  it('should parse project pause command', () => {
    const args = ['project', 'pause', 'proj-1'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('project');
    expect(parsed.subcommand).toBe('pause');
    expect(parsed.args).toContain('proj-1');
  });

  it('should parse project resume command', () => {
    const args = ['project', 'resume', 'proj-1'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('project');
    expect(parsed.subcommand).toBe('resume');
    expect(parsed.args).toContain('proj-1');
  });

  it('should parse report command', () => {
    const args = ['report', '--format', 'json'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('report');
    expect(parsed.options.format).toBe('json');
  });

  it('should parse config show command', () => {
    const args = ['config', 'show'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('config');
    expect(parsed.subcommand).toBe('show');
  });

  it('should parse config validate command', () => {
    const args = ['config', 'validate', './config.json'];
    const parsed = parseArgs(args);

    expect(parsed.command).toBe('config');
    expect(parsed.subcommand).toBe('validate');
    expect(parsed.args).toContain('./config.json');
  });

  it('should parse help flag', () => {
    const args = ['--help'];
    const parsed = parseArgs(args);

    expect(parsed.options.help).toBe(true);
  });

  it('should parse version flag', () => {
    const args = ['--version'];
    const parsed = parseArgs(args);

    expect(parsed.options.version).toBe(true);
  });

  it('should handle empty args', () => {
    const args: string[] = [];
    const parsed = parseArgs(args);

    expect(parsed.command).toBeUndefined();
  });

  describe('malformed options', () => {
    it('should treat --=value as an option named "=value" (boolean)', () => {
      const result = parseArgs(['start', '--=value']);
      expect(result.command).toBe('start');
      expect(result.options['=value']).toBe(true);
    });

    it('should treat ---flag as an option named "-flag" (boolean)', () => {
      const result = parseArgs(['start', '---flag']);
      expect(result.options['-flag']).toBe(true);
    });

    it('should treat bare -- as an option with empty string name', () => {
      const result = parseArgs(['start', '--']);
      expect(result.options['']).toBe(true);
    });

    it('should treat -- followed by a non-dash arg as option "" with value', () => {
      const result = parseArgs(['start', '--', 'some-arg']);
      expect(result.options['']).toBe('some-arg');
    });

    it('should handle empty string arguments as command', () => {
      const result = parseArgs(['']);
      expect(result.command).toBe('');
    });

    it('should handle --option with empty string value', () => {
      // Empty string is falsy in JS, so `nextArg && ...` short-circuits.
      // The parser treats this as a boolean flag, not a value assignment.
      const result = parseArgs(['start', '--config', '']);
      expect(result.options['config']).toBe(true);
      // The empty string falls through as a positional arg (not consumed as option value)
      expect(result.args).toEqual(['']);
    });
  });

  describe('unknown and invalid command names', () => {
    it('should accept unknown commands without validation', () => {
      const result = parseArgs(['banana']);
      expect(result.command).toBe('banana');
      expect(result.subcommand).toBeUndefined();
    });

    it('should accept commands with special characters', () => {
      const result = parseArgs(['!!!']);
      expect(result.command).toBe('!!!');
    });

    it('should accept commands with numbers', () => {
      const result = parseArgs(['123']);
      expect(result.command).toBe('123');
    });

    it('should not assign subcommand for unknown commands', () => {
      const result = parseArgs(['banana', 'split']);
      expect(result.command).toBe('banana');
      expect(result.subcommand).toBeUndefined();
      expect(result.args).toEqual(['split']);
    });

    it('should accept commands with unicode characters', () => {
      const result = parseArgs(['café']);
      expect(result.command).toBe('café');
    });
  });

  describe('duplicate options', () => {
    it('should use last value when same option specified twice (last-wins)', () => {
      const result = parseArgs(['start', '--config', 'a.json', '--config', 'b.json']);
      expect(result.options['config']).toBe('b.json');
    });

    it('should use last value for boolean then value duplicate', () => {
      const result = parseArgs(['start', '--verbose', '--verbose', 'extra']);
      expect(result.options['verbose']).toBe('extra');
    });

    it('should use last value for value then boolean duplicate', () => {
      const result = parseArgs(['start', '--format', 'json', '--format']);
      expect(result.options['format']).toBe(true);
    });
  });

  describe('missing required arguments', () => {
    it('should parse command without subcommand for subcommand-supporting commands', () => {
      const result = parseArgs(['task']);
      expect(result.command).toBe('task');
      expect(result.subcommand).toBeUndefined();
      expect(result.args).toEqual([]);
    });

    it('should parse project command without subcommand', () => {
      const result = parseArgs(['project']);
      expect(result.command).toBe('project');
      expect(result.subcommand).toBeUndefined();
    });

    it('should parse subcommand without additional arguments', () => {
      const result = parseArgs(['task', 'add']);
      expect(result.command).toBe('task');
      expect(result.subcommand).toBe('add');
      expect(result.args).toEqual([]);
    });

    it('should parse with no arguments at all', () => {
      const result = parseArgs([]);
      expect(result.command).toBeUndefined();
      expect(result.subcommand).toBeUndefined();
      expect(result.args).toEqual([]);
      expect(result.options).toEqual({});
    });
  });

  describe('boundary inputs', () => {
    it('should handle very long argument strings', () => {
      const longValue = 'x'.repeat(1000);
      const result = parseArgs(['start', '--config', longValue]);
      expect(result.options['config']).toBe(longValue);
    });

    it('should handle very long command names', () => {
      const longCommand = 'cmd'.repeat(500);
      const result = parseArgs([longCommand]);
      expect(result.command).toBe(longCommand);
    });

    it('should handle special characters in option values', () => {
      const result = parseArgs(['start', '--path', '/tmp/file with spaces/config.json']);
      expect(result.options['path']).toBe('/tmp/file with spaces/config.json');
    });

    it('should handle values containing equals signs', () => {
      const result = parseArgs(['start', '--env', 'KEY=VALUE']);
      expect(result.options['env']).toBe('KEY=VALUE');
    });

    it('should handle values containing quotes', () => {
      const result = parseArgs(['task', 'add', "it's broken"]);
      expect(result.args).toEqual(["it's broken"]);
    });

    it('should handle numeric string values without coercion', () => {
      const result = parseArgs(['start', '--port', '8080']);
      expect(result.options['port']).toBe('8080');
      expect(typeof result.options['port']).toBe('string');
    });
  });

  describe('option and argument ordering', () => {
    it('should consume command name as option value when option precedes command', () => {
      const result = parseArgs(['--verbose', 'start']);
      expect(result.options['verbose']).toBe('start');
      expect(result.command).toBeUndefined();
    });

    it('should consume subcommand as option value when option is between command and subcommand', () => {
      const result = parseArgs(['task', '--verbose', 'add']);
      expect(result.options['verbose']).toBe('add');
      expect(result.subcommand).toBeUndefined();
    });

    it('should not consume next argument for short flags', () => {
      const result = parseArgs(['-v', 'start']);
      expect(result.options['v']).toBe(true);
      expect(result.command).toBe('start');
    });

    it('should handle multiple consecutive boolean long options', () => {
      const result = parseArgs(['start', '--verbose', '--debug', '--dry-run']);
      expect(result.options['verbose']).toBe(true);
      expect(result.options['debug']).toBe(true);
      expect(result.options['dry-run']).toBe(true);
    });

    it('should handle intermixed short and long flags', () => {
      const result = parseArgs(['start', '-v', '--debug', '-h']);
      expect(result.options['v']).toBe(true);
      expect(result.options['debug']).toBe(true);
      expect(result.options['h']).toBe(true);
    });
  });

  describe('short flag edge cases', () => {
    it('should treat combined short flags as single option name', () => {
      const result = parseArgs(['-hv']);
      expect(result.options['hv']).toBe(true);
      expect(result.options['h']).toBeUndefined();
      expect(result.options['v']).toBeUndefined();
    });

    it('should treat single dash alone as a short flag with empty name', () => {
      const result = parseArgs(['-']);
      expect(result.options['']).toBe(true);
    });
  });

  describe('subcommand gating by command name', () => {
    const subcommandCommands = ['task', 'project', 'config', 'agent', 'backlog', 'proposal'];

    subcommandCommands.forEach((cmd) => {
      it(`should allow subcommand for "${cmd}" command`, () => {
        const result = parseArgs([cmd, 'list']);
        expect(result.command).toBe(cmd);
        expect(result.subcommand).toBe('list');
      });
    });

    const nonSubcommandCommands = ['start', 'stop', 'status', 'report', 'unknown'];

    nonSubcommandCommands.forEach((cmd) => {
      it(`should NOT allow subcommand for "${cmd}" command`, () => {
        const result = parseArgs([cmd, 'extra']);
        expect(result.command).toBe(cmd);
        expect(result.subcommand).toBeUndefined();
        expect(result.args).toEqual(['extra']);
      });
    });
  });
});

describe('formatOutput', () => {
  it('should format successful result', () => {
    const result: CommandResult = {
      success: true,
      message: 'Operation completed',
    };

    const output = formatOutput(result, 'text');

    expect(output).toContain('Operation completed');
  });

  it('should format error result', () => {
    const result: CommandResult = {
      success: false,
      message: 'Operation failed',
    };

    const output = formatOutput(result, 'text');

    expect(output).toContain('Error');
    expect(output).toContain('Operation failed');
  });

  it('should format result as JSON', () => {
    const result: CommandResult = {
      success: true,
      message: 'Done',
      data: { count: 5 },
    };

    const output = formatOutput(result, 'json');
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('Done');
    expect(parsed.data.count).toBe(5);
  });
});

describe('CLI', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe('run', () => {
    it('should show help when --help flag is provided', async () => {
      const exitCode = await CLI.run(['--help']);

      expect(exitCode).toBe(0);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show version when --version flag is provided', async () => {
      const exitCode = await CLI.run(['--version']);

      expect(exitCode).toBe(0);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show help when no command is provided', async () => {
      const exitCode = await CLI.run([]);

      expect(exitCode).toBe(0);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should execute start command', async () => {
      const exitCode = await CLI.run(['start']);

      expect(exitCode).toBe(0);
      expect(Commands.start).toHaveBeenCalled();
    });

    it('should execute stop command', async () => {
      const exitCode = await CLI.run(['stop']);

      expect(exitCode).toBe(0);
      expect(Commands.stop).toHaveBeenCalled();
    });

    it('should execute status command', async () => {
      const exitCode = await CLI.run(['status']);

      expect(exitCode).toBe(0);
      expect(Commands.status).toHaveBeenCalled();
    });

    it('should execute task add command', async () => {
      const exitCode = await CLI.run(['task', 'add', 'New task', '--project', 'proj-1', '--priority', '5']);

      expect(exitCode).toBe(0);
      expect(Commands.taskAdd).toHaveBeenCalled();
    });

    it('should execute task list command', async () => {
      const exitCode = await CLI.run(['task', 'list']);

      expect(exitCode).toBe(0);
      expect(Commands.taskList).toHaveBeenCalled();
    });

    it('should execute task cancel command', async () => {
      const exitCode = await CLI.run(['task', 'cancel', 'task-123']);

      expect(exitCode).toBe(0);
      expect(Commands.taskCancel).toHaveBeenCalled();
    });

    it('should execute project list command', async () => {
      const exitCode = await CLI.run(['project', 'list']);

      expect(exitCode).toBe(0);
      expect(Commands.projectList).toHaveBeenCalled();
    });

    it('should execute project pause command', async () => {
      const exitCode = await CLI.run(['project', 'pause', 'proj-1']);

      expect(exitCode).toBe(0);
      expect(Commands.projectPause).toHaveBeenCalled();
    });

    it('should execute project resume command', async () => {
      const exitCode = await CLI.run(['project', 'resume', 'proj-1']);

      expect(exitCode).toBe(0);
      expect(Commands.projectResume).toHaveBeenCalled();
    });

    it('should execute report command', async () => {
      const exitCode = await CLI.run(['report']);

      expect(exitCode).toBe(0);
      expect(Commands.report).toHaveBeenCalled();
    });

    it('should execute config show command', async () => {
      const exitCode = await CLI.run(['config', 'show']);

      expect(exitCode).toBe(0);
      expect(Commands.configShow).toHaveBeenCalled();
    });

    it('should execute config validate command', async () => {
      const exitCode = await CLI.run(['config', 'validate', './config.json']);

      expect(exitCode).toBe(0);
      expect(Commands.configValidate).toHaveBeenCalled();
    });

    it('should return error code for unknown command', async () => {
      const exitCode = await CLI.run(['unknown']);

      expect(exitCode).toBe(1);
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should return error code when command fails', async () => {
      vi.mocked(Commands.start).mockResolvedValueOnce({
        success: false,
        message: 'Failed to start',
      });

      const exitCode = await CLI.run(['start']);

      expect(exitCode).toBe(1);
    });

    it('should handle unexpected errors gracefully', async () => {
      vi.mocked(Commands.start).mockRejectedValueOnce(new Error('Unexpected'));

      const exitCode = await CLI.run(['start']);

      expect(exitCode).toBe(1);
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should pass config path option to start command', async () => {
      await CLI.run(['start', '--config', './custom.json']);

      expect(Commands.start).toHaveBeenCalled();
      expect(ConfigLoader.load).toHaveBeenCalledWith('./custom.json');
    });

    it('should initialize logger from config', async () => {
      await CLI.run(['start']);

      expect(Logger.setLevelFromString).toHaveBeenCalledWith('info');
    });
  });

  describe('showHelp', () => {
    it('should display help message with commands', () => {
      CLI.showHelp();

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls.flat().join('\n');
      expect(output).toContain('TrafficControl');
      expect(output).toContain('Usage');
    });
  });

  describe('showVersion', () => {
    it('should display version number', () => {
      CLI.showVersion();

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls.flat().join('\n');
      expect(output).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should display version matching package.json', () => {
      CLI.showVersion();

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls.flat().join('\n');
      expect(output).toContain(pkg.version);
    });
  });
});
