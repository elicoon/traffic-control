import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSlackBot, formatQuestion, formatBlocker, formatVisualReview, formatStatus, resetSlackBot } from './bot.js';

describe('Slack Bot', () => {
  beforeEach(() => {
    // Reset bot instance between tests
    resetSlackBot();
  });

  it('should create a bot instance', () => {
    // Mock environment
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    vi.stubEnv('SLACK_SIGNING_SECRET', 'test-secret');
    vi.stubEnv('SLACK_APP_TOKEN', 'xapp-test');

    const bot = createSlackBot();
    expect(bot).toBeDefined();
  });

  it('should return same bot instance on multiple calls', () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    vi.stubEnv('SLACK_SIGNING_SECRET', 'test-secret');
    vi.stubEnv('SLACK_APP_TOKEN', 'xapp-test');

    const bot1 = createSlackBot();
    const bot2 = createSlackBot();
    expect(bot1).toBe(bot2);
  });

  it('should throw error when environment variables are missing', () => {
    // Store original values
    const originalToken = process.env.SLACK_BOT_TOKEN;
    const originalSecret = process.env.SLACK_SIGNING_SECRET;
    const originalAppToken = process.env.SLACK_APP_TOKEN;

    // Reset bot and clear env vars
    resetSlackBot();
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_APP_TOKEN;

    expect(() => createSlackBot()).toThrow('Missing Slack credentials');

    // Restore env vars
    process.env.SLACK_BOT_TOKEN = originalToken;
    process.env.SLACK_SIGNING_SECRET = originalSecret;
    process.env.SLACK_APP_TOKEN = originalAppToken;
    resetSlackBot();
  });

  it('should format question messages', () => {
    const message = formatQuestion('TestProject', 'What database should I use?');
    expect(message).toContain('TestProject');
    expect(message).toContain('What database should I use?');
  });

  it('should format blocker messages', () => {
    const message = formatBlocker('TestProject', 'Cannot access API endpoint');
    expect(message).toContain('TestProject');
    expect(message).toContain('Cannot access API endpoint');
  });

  it('should format visual review messages', () => {
    const message = formatVisualReview('TestProject', 'Create login page');
    expect(message).toContain('TestProject');
    expect(message).toContain('Create login page');
    expect(message).toContain('Visual review');
  });

  it('should format status messages', () => {
    const projects = [
      { name: 'Project1', activeTasks: 3, blockedTasks: 1 },
      { name: 'Project2', activeTasks: 5, blockedTasks: 0 }
    ];
    const message = formatStatus(projects);
    expect(message).toContain('Project1');
    expect(message).toContain('Project2');
    expect(message).toContain('3 active');
    expect(message).toContain('1 blocked');
    expect(message).toContain('5 active');
    expect(message).toContain('0 blocked');
  });
});
