import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setMessageHandler,
  setReactionHandler,
  setCommandHandler,
  setProposalActionHandler,
  setProposalListHandler,
  setReportHandler,
  resetHandlers,
  setupHandlers,
  parseProposalCommand,
} from './handlers.js';
import type { Proposal } from '../db/repositories/proposals.js';

// Capture registered handlers from setupHandlers()
let capturedMessageHandler: (args: Record<string, unknown>) => Promise<void>;
let capturedCommandHandler: (args: Record<string, unknown>) => Promise<void>;
let capturedReactionHandler: (args: Record<string, unknown>) => Promise<void>;
let capturedAppMentionHandler: (args: Record<string, unknown>) => Promise<void>;

const mockApp = {
  message: vi.fn((handler: (args: Record<string, unknown>) => Promise<void>) => {
    capturedMessageHandler = handler;
  }),
  command: vi.fn((name: string, handler: (args: Record<string, unknown>) => Promise<void>) => {
    capturedCommandHandler = handler;
  }),
  event: vi.fn((name: string, handler: (args: Record<string, unknown>) => Promise<void>) => {
    if (name === 'reaction_added') {
      capturedReactionHandler = handler;
    } else if (name === 'app_mention') {
      capturedAppMentionHandler = handler;
    }
  }),
};

vi.mock('./bot.js', () => ({
  createSlackBot: vi.fn(() => mockApp),
  formatProposalBatch: vi.fn((data: unknown[]) => `Batch: ${data.length} proposals`),
  formatProposalApproved: vi.fn((data: unknown[]) => `Approved: ${(data as unknown[]).length}`),
  formatProposalRejected: vi.fn((data: unknown, reason: string) => `Rejected: ${(data as { title: string }).title} - ${reason}`),
  formatStatusReport: vi.fn(() => 'Formatted status report'),
}));

vi.mock('../logging/index.js', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'proposal-1',
    project_id: 'proj-1',
    title: 'Test Proposal',
    description: 'A test proposal',
    impact_score: 'medium',
    estimated_sessions_opus: 1,
    estimated_sessions_sonnet: 2,
    reasoning: 'Test reasoning',
    status: 'proposed',
    rejection_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    resolved_at: null,
    ...overrides,
  };
}

describe('handlers', () => {
  beforeEach(() => {
    resetHandlers();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────
  // parseProposalCommand
  // ──────────────────────────────────────────────
  describe('parseProposalCommand', () => {
    it('parses "approve all"', () => {
      const result = parseProposalCommand('approve all');
      expect(result).toEqual({ action: 'approve', indices: [] });
    });

    it('parses "approve all" case-insensitively', () => {
      const result = parseProposalCommand('Approve All');
      expect(result).toEqual({ action: 'approve', indices: [] });
    });

    it('parses "approve 1,2,3" to zero-based indices', () => {
      const result = parseProposalCommand('approve 1,2,3');
      expect(result).toEqual({ action: 'approve', indices: [0, 1, 2] });
    });

    it('parses "approve 1" to single zero-based index', () => {
      const result = parseProposalCommand('approve 1');
      expect(result).toEqual({ action: 'approve', indices: [0] });
    });

    it('parses "reject 2: not needed" with colon separator', () => {
      const result = parseProposalCommand('reject 2: not needed');
      expect(result).toEqual({ action: 'reject', indices: [1], reason: 'not needed' });
    });

    it('parses "reject 3 too expensive" with space separator', () => {
      const result = parseProposalCommand('reject 3 too expensive');
      expect(result).toEqual({ action: 'reject', indices: [2], reason: 'too expensive' });
    });

    it('returns null for non-proposal text', () => {
      expect(parseProposalCommand('hello world')).toBeNull();
      expect(parseProposalCommand('status')).toBeNull();
      expect(parseProposalCommand('approve')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseProposalCommand('')).toBeNull();
    });

    it('returns null for "reject" without index or reason', () => {
      expect(parseProposalCommand('reject')).toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  // handler setters and resetHandlers
  // ──────────────────────────────────────────────
  describe('handler setters and resetHandlers', () => {
    it('resetHandlers clears all callbacks so default routing is used', async () => {
      // Set all callbacks
      const msgHandler = vi.fn();
      const rxnHandler = vi.fn();
      const cmdHandler = vi.fn();
      const proposalActionHandler = vi.fn();
      const proposalListHandler = vi.fn();
      const reportHandler = vi.fn();

      setMessageHandler(msgHandler);
      setReactionHandler(rxnHandler);
      setCommandHandler(cmdHandler);
      setProposalActionHandler(proposalActionHandler);
      setProposalListHandler(proposalListHandler);
      setReportHandler(reportHandler);

      // Reset all
      resetHandlers();

      // After reset, setupHandlers should use default command routing (no custom commandCallback)
      setupHandlers();

      const respond = vi.fn().mockResolvedValue(undefined);
      const ack = vi.fn().mockResolvedValue(undefined);

      // Trigger a command — should use default routing (help), not the custom cmdHandler
      await capturedCommandHandler({
        command: { text: 'status', user_id: 'U123' },
        ack,
        respond,
      });

      expect(cmdHandler).not.toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith('Fetching status...');
    });
  });

  // ──────────────────────────────────────────────
  // setupHandlers — command routing
  // ──────────────────────────────────────────────
  describe('setupHandlers command routing', () => {
    let respond: ReturnType<typeof vi.fn>;
    let ack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      respond = vi.fn().mockResolvedValue(undefined);
      ack = vi.fn().mockResolvedValue(undefined);
      setupHandlers();
    });

    function invokeCommand(text: string) {
      return capturedCommandHandler({
        command: { text, user_id: 'U123' },
        ack,
        respond,
      });
    }

    it('always acknowledges the command first', async () => {
      await invokeCommand('help');
      expect(ack).toHaveBeenCalled();
    });

    it('responds with help text for "help"', async () => {
      await invokeCommand('help');
      expect(respond).toHaveBeenCalledTimes(1);
      const helpText = respond.mock.calls[0][0] as string;
      expect(helpText).toContain('TrafficControl commands');
      expect(helpText).toContain('/tc status');
      expect(helpText).toContain('/tc proposals');
    });

    it('responds with help text for unknown commands', async () => {
      await invokeCommand('foobar');
      const helpText = respond.mock.calls[0][0] as string;
      expect(helpText).toContain('TrafficControl commands');
    });

    it('responds with "Fetching status..." for "status"', async () => {
      await invokeCommand('status');
      expect(respond).toHaveBeenCalledWith('Fetching status...');
    });

    it('responds with pause message for "pause project"', async () => {
      await invokeCommand('pause myProject');
      expect(respond).toHaveBeenCalledWith('Pausing project: myProject');
    });

    it('responds with "(none specified)" for "pause" without project', async () => {
      await invokeCommand('pause');
      expect(respond).toHaveBeenCalledWith('Pausing project: (none specified)');
    });

    it('responds with resume message for "resume project"', async () => {
      await invokeCommand('resume myProject');
      expect(respond).toHaveBeenCalledWith('Resuming project: myProject');
    });

    it('responds with add message for "add some task"', async () => {
      await invokeCommand('add some task');
      expect(respond).toHaveBeenCalledWith('Adding task: some task');
    });

    it('responds with "(no description)" for "add" without description', async () => {
      await invokeCommand('add');
      expect(respond).toHaveBeenCalledWith('Adding task: (no description)');
    });

    // ── proposals ──

    it('responds with "not configured" when proposals called without proposalListCallback', async () => {
      await invokeCommand('proposals');
      expect(respond).toHaveBeenCalledWith('Proposal listing not configured.');
    });

    it('calls formatProposalBatch when proposals callback returns proposals', async () => {
      const proposals = [makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })];
      setProposalListHandler(vi.fn().mockResolvedValue(proposals));
      // Re-setup so internal callback is captured
      setupHandlers();

      await invokeCommand('proposals');
      expect(respond).toHaveBeenCalledWith('Batch: 2 proposals');
    });

    it('responds with "No pending proposals" when callback returns empty array', async () => {
      setProposalListHandler(vi.fn().mockResolvedValue([]));
      setupHandlers();

      await invokeCommand('proposals');
      expect(respond).toHaveBeenCalledWith('No pending proposals. The backlog is healthy!');
    });

    it('responds with error when proposals callback throws', async () => {
      setProposalListHandler(vi.fn().mockRejectedValue(new Error('DB down')));
      setupHandlers();

      await invokeCommand('proposals');
      expect(respond).toHaveBeenCalledWith('Failed to list proposals: DB down');
    });

    // ── approve ──

    it('responds with usage for "approve" with no args', async () => {
      setProposalActionHandler(vi.fn());
      setupHandlers();

      await invokeCommand('approve');
      expect(respond).toHaveBeenCalledWith('Usage: `/tc approve all` or `/tc approve 1,2,3`');
    });

    it('responds with "not configured" for "approve" without proposalActionCallback', async () => {
      await invokeCommand('approve all');
      expect(respond).toHaveBeenCalledWith('Proposal actions not configured.');
    });

    it('approves all cached proposals with "approve all"', async () => {
      const proposals = [
        makeProposal({ id: 'p1', title: 'Proposal 1' }),
        makeProposal({ id: 'p2', title: 'Proposal 2' }),
      ];
      const listHandler = vi.fn().mockResolvedValue(proposals);
      const actionHandler = vi.fn().mockResolvedValue(proposals);

      setProposalListHandler(listHandler);
      setProposalActionHandler(actionHandler);
      setupHandlers();

      // First list proposals to populate cache
      await invokeCommand('proposals');
      respond.mockClear();

      // Then approve all
      await invokeCommand('approve all');

      expect(actionHandler).toHaveBeenCalledWith('approve', ['p1', 'p2']);
      expect(respond).toHaveBeenCalledWith('Approved: 2');
    });

    it('approves specific proposals by index with "approve 1,2"', async () => {
      const proposals = [
        makeProposal({ id: 'p1' }),
        makeProposal({ id: 'p2' }),
        makeProposal({ id: 'p3' }),
      ];
      const listHandler = vi.fn().mockResolvedValue(proposals);
      const actionHandler = vi.fn().mockResolvedValue([proposals[0], proposals[1]]);

      setProposalListHandler(listHandler);
      setProposalActionHandler(actionHandler);
      setupHandlers();

      // Populate cache
      await invokeCommand('proposals');
      respond.mockClear();

      await invokeCommand('approve 1,2');

      expect(actionHandler).toHaveBeenCalledWith('approve', ['p1', 'p2']);
    });

    it('fetches proposals when cache is empty on "approve all"', async () => {
      const proposals = [makeProposal({ id: 'p1' })];
      const listHandler = vi.fn().mockResolvedValue(proposals);
      const actionHandler = vi.fn().mockResolvedValue(proposals);

      setProposalListHandler(listHandler);
      setProposalActionHandler(actionHandler);
      setupHandlers();

      // Skip listing — go straight to approve
      await invokeCommand('approve all');

      // Should have fetched proposals via listHandler
      expect(listHandler).toHaveBeenCalled();
      expect(actionHandler).toHaveBeenCalledWith('approve', ['p1']);
    });

    it('responds with "no valid proposals" when indices are out of range', async () => {
      const proposals = [makeProposal({ id: 'p1' })];
      const listHandler = vi.fn().mockResolvedValue(proposals);
      const actionHandler = vi.fn();

      setProposalListHandler(listHandler);
      setProposalActionHandler(actionHandler);
      setupHandlers();

      // Only 1 proposal; try to approve index 5
      await invokeCommand('approve 5');

      expect(actionHandler).not.toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith('No valid proposals to approve. Use `/tc proposals` to see the list.');
    });

    // ── reject ──

    it('responds with usage for "reject" with no args', async () => {
      setProposalActionHandler(vi.fn());
      setupHandlers();

      await invokeCommand('reject');
      expect(respond).toHaveBeenCalledWith('Usage: `/tc reject 2: reason for rejection`');
    });

    it('responds with "not configured" for "reject" without proposalActionCallback', async () => {
      await invokeCommand('reject 1: not needed');
      expect(respond).toHaveBeenCalledWith('Proposal actions not configured.');
    });

    it('rejects a proposal by index with reason (colon format)', async () => {
      const proposal = makeProposal({ id: 'p1', title: 'Proposal 1' });
      const listHandler = vi.fn().mockResolvedValue([proposal]);
      const actionHandler = vi.fn().mockResolvedValue([proposal]);

      setProposalListHandler(listHandler);
      setProposalActionHandler(actionHandler);
      setupHandlers();

      // Populate cache
      await invokeCommand('proposals');
      respond.mockClear();

      await invokeCommand('reject 1: not needed right now');

      expect(actionHandler).toHaveBeenCalledWith('reject', ['p1'], 'not needed right now');
      expect(respond).toHaveBeenCalledWith('Rejected: Proposal 1 - not needed right now');
    });

    it('rejects a proposal by index with reason (space format)', async () => {
      const proposal = makeProposal({ id: 'p1', title: 'Proposal 1' });
      const listHandler = vi.fn().mockResolvedValue([proposal]);
      const actionHandler = vi.fn().mockResolvedValue([proposal]);

      setProposalListHandler(listHandler);
      setProposalActionHandler(actionHandler);
      setupHandlers();

      // Populate cache
      await invokeCommand('proposals');
      respond.mockClear();

      await invokeCommand('reject 1 too expensive');

      expect(actionHandler).toHaveBeenCalledWith('reject', ['p1'], 'too expensive');
    });

    it('responds with error for reject without reason', async () => {
      setProposalActionHandler(vi.fn());
      setupHandlers();

      await invokeCommand('reject 1');
      expect(respond).toHaveBeenCalledWith('Please provide a reason: `/tc reject 2: reason`');
    });

    it('responds with error for reject with invalid index', async () => {
      setProposalActionHandler(vi.fn());
      setProposalListHandler(vi.fn().mockResolvedValue([makeProposal()]));
      setupHandlers();

      await invokeCommand('reject abc: reason');
      expect(respond).toHaveBeenCalledWith('Invalid proposal number. Use `/tc proposals` to see the list.');
    });

    it('responds with error for reject with out-of-range index', async () => {
      const proposal = makeProposal({ id: 'p1' });
      setProposalActionHandler(vi.fn());
      setProposalListHandler(vi.fn().mockResolvedValue([proposal]));
      setupHandlers();

      // Populate cache
      await invokeCommand('proposals');
      respond.mockClear();

      await invokeCommand('reject 5: out of range');
      expect(respond).toHaveBeenCalledWith('Invalid proposal number. Valid range: 1-1');
    });

    // ── report ──

    it('responds with "not configured" for "report" without reportCallback', async () => {
      await invokeCommand('report');
      expect(respond).toHaveBeenCalledWith(
        'Report generation not configured. Please ensure the reporter is initialized.'
      );
    });

    it('generates and responds with formatted report when reportCallback is set', async () => {
      const mockReport = {
        metrics: { projectMetrics: [], systemMetrics: {} },
        recommendations: { projectRecommendations: new Map(), systemRecommendations: [], actionItems: [] },
        timestamp: new Date(),
      };
      setReportHandler(vi.fn().mockResolvedValue(mockReport));
      setupHandlers();

      await invokeCommand('report');

      // First call is "Generating status report...", second is the formatted report
      expect(respond).toHaveBeenCalledWith('Generating status report...');
      expect(respond).toHaveBeenCalledWith('Formatted status report');
    });

    it('responds with error when report generation fails', async () => {
      setReportHandler(vi.fn().mockRejectedValue(new Error('metrics unavailable')));
      setupHandlers();

      await invokeCommand('report');

      expect(respond).toHaveBeenCalledWith('Failed to generate report: metrics unavailable');
    });

    // ── custom command handler ──

    it('delegates to custom commandCallback when set', async () => {
      const customHandler = vi.fn().mockResolvedValue(undefined);
      setCommandHandler(customHandler);
      setupHandlers();

      await invokeCommand('status');

      expect(customHandler).toHaveBeenCalledWith(
        'status',
        [],
        'U123',
        expect.any(Function)
      );
      // Default handling should NOT have been invoked
      expect(respond).not.toHaveBeenCalledWith('Fetching status...');
    });

    it('custom commandCallback receives the respond wrapper', async () => {
      const customHandler = vi.fn(async (_cmd: string, _args: string[], _uid: string, respondFn: (text: string) => Promise<void>) => {
        await respondFn('custom response');
      });
      setCommandHandler(customHandler);
      setupHandlers();

      await invokeCommand('anything');

      expect(respond).toHaveBeenCalledWith('custom response');
    });

    // ── error handling ──

    it('responds with error message when command handler throws', async () => {
      setCommandHandler(vi.fn().mockRejectedValue(new Error('handler exploded')));
      setupHandlers();

      await invokeCommand('status');

      expect(respond).toHaveBeenCalledWith(
        'An error occurred while processing your command: handler exploded'
      );
    });

    it('handles empty command text gracefully (defaults to help)', async () => {
      await capturedCommandHandler({
        command: { text: '', user_id: 'U123' },
        ack,
        respond,
      });

      const helpText = respond.mock.calls[0][0] as string;
      expect(helpText).toContain('TrafficControl commands');
    });
  });

  // ──────────────────────────────────────────────
  // setupHandlers — message handling
  // ──────────────────────────────────────────────
  describe('setupHandlers message handling', () => {
    beforeEach(() => {
      setupHandlers();
    });

    it('invokes messageCallback with text, userId, and threadTs', async () => {
      const msgHandler = vi.fn().mockResolvedValue(undefined);
      setMessageHandler(msgHandler);
      setupHandlers();

      const say = vi.fn();
      await capturedMessageHandler({
        message: {
          text: 'hello there',
          user: 'U456',
          thread_ts: 'ts-123',
          ts: 'ts-000',
        },
        say,
      });

      expect(msgHandler).toHaveBeenCalledWith('hello there', 'U456', 'ts-123');
    });

    it('uses message ts when thread_ts is absent', async () => {
      const msgHandler = vi.fn().mockResolvedValue(undefined);
      setMessageHandler(msgHandler);
      setupHandlers();

      const say = vi.fn();
      await capturedMessageHandler({
        message: {
          text: 'hello',
          user: 'U456',
          ts: 'ts-000',
        },
        say,
      });

      expect(msgHandler).toHaveBeenCalledWith('hello', 'U456', 'ts-000');
    });

    it('ignores messages with a subtype (edits, deletes, etc.)', async () => {
      const msgHandler = vi.fn().mockResolvedValue(undefined);
      setMessageHandler(msgHandler);
      setupHandlers();

      const say = vi.fn();
      await capturedMessageHandler({
        message: {
          subtype: 'message_changed',
          text: 'edited text',
          user: 'U456',
          ts: 'ts-000',
        },
        say,
      });

      expect(msgHandler).not.toHaveBeenCalled();
    });

    it('does nothing when no messageCallback is set', async () => {
      // resetHandlers already clears callbacks
      setupHandlers();

      const say = vi.fn();
      // Should not throw
      await capturedMessageHandler({
        message: {
          text: 'hello',
          user: 'U456',
          ts: 'ts-000',
        },
        say,
      });

      // No error, just silently ignored
    });

    it('catches errors thrown by messageCallback', async () => {
      const msgHandler = vi.fn().mockRejectedValue(new Error('callback failed'));
      setMessageHandler(msgHandler);
      setupHandlers();

      const say = vi.fn();
      // Should not throw
      await capturedMessageHandler({
        message: {
          text: 'hello',
          user: 'U456',
          ts: 'ts-000',
        },
        say,
      });

      expect(msgHandler).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // setupHandlers — reaction handling
  // ──────────────────────────────────────────────
  describe('setupHandlers reaction handling', () => {
    beforeEach(() => {
      setupHandlers();
    });

    it('invokes reactionCallback for white_check_mark', async () => {
      const rxnHandler = vi.fn().mockResolvedValue(undefined);
      setReactionHandler(rxnHandler);
      setupHandlers();

      await capturedReactionHandler({
        event: {
          reaction: 'white_check_mark',
          user: 'U789',
          item: { type: 'message', ts: 'msg-ts', channel: 'C001' },
        },
      });

      expect(rxnHandler).toHaveBeenCalledWith('white_check_mark', 'U789', 'msg-ts', 'C001');
    });

    it('invokes reactionCallback for x reaction', async () => {
      const rxnHandler = vi.fn().mockResolvedValue(undefined);
      setReactionHandler(rxnHandler);
      setupHandlers();

      await capturedReactionHandler({
        event: {
          reaction: 'x',
          user: 'U789',
          item: { type: 'message', ts: 'msg-ts', channel: 'C001' },
        },
      });

      expect(rxnHandler).toHaveBeenCalledWith('x', 'U789', 'msg-ts', 'C001');
    });

    it('ignores reactions other than white_check_mark and x', async () => {
      const rxnHandler = vi.fn().mockResolvedValue(undefined);
      setReactionHandler(rxnHandler);
      setupHandlers();

      await capturedReactionHandler({
        event: {
          reaction: 'thumbsup',
          user: 'U789',
          item: { type: 'message', ts: 'msg-ts', channel: 'C001' },
        },
      });

      expect(rxnHandler).not.toHaveBeenCalled();
    });

    it('ignores reactions on non-message items', async () => {
      const rxnHandler = vi.fn().mockResolvedValue(undefined);
      setReactionHandler(rxnHandler);
      setupHandlers();

      await capturedReactionHandler({
        event: {
          reaction: 'white_check_mark',
          user: 'U789',
          item: { type: 'file', ts: 'file-ts', channel: 'C001' },
        },
      });

      expect(rxnHandler).not.toHaveBeenCalled();
    });

    it('does nothing when no reactionCallback is set for valid reactions', async () => {
      // No callback set (resetHandlers in beforeEach)
      setupHandlers();

      // Should not throw
      await capturedReactionHandler({
        event: {
          reaction: 'white_check_mark',
          user: 'U789',
          item: { type: 'message', ts: 'msg-ts', channel: 'C001' },
        },
      });
    });

    it('catches errors thrown by reactionCallback', async () => {
      const rxnHandler = vi.fn().mockRejectedValue(new Error('reaction error'));
      setReactionHandler(rxnHandler);
      setupHandlers();

      // Should not throw
      await capturedReactionHandler({
        event: {
          reaction: 'white_check_mark',
          user: 'U789',
          item: { type: 'message', ts: 'msg-ts', channel: 'C001' },
        },
      });

      expect(rxnHandler).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // setupHandlers — app_mention handling
  // ──────────────────────────────────────────────
  describe('setupHandlers app_mention handling', () => {
    beforeEach(() => {
      setupHandlers();
    });

    it('invokes messageCallback on app_mention when set', async () => {
      const msgHandler = vi.fn().mockResolvedValue(undefined);
      setMessageHandler(msgHandler);
      setupHandlers();

      const say = vi.fn();
      await capturedAppMentionHandler({
        event: {
          text: '<@BOT> hello',
          user: 'U456',
          thread_ts: 'thread-ts-1',
          ts: 'event-ts-1',
        },
        say,
      });

      expect(msgHandler).toHaveBeenCalledWith('<@BOT> hello', 'U456', 'thread-ts-1');
    });

    it('uses event ts as thread context when thread_ts is absent', async () => {
      const msgHandler = vi.fn().mockResolvedValue(undefined);
      setMessageHandler(msgHandler);
      setupHandlers();

      const say = vi.fn();
      await capturedAppMentionHandler({
        event: {
          text: '<@BOT> hello',
          user: 'U456',
          ts: 'event-ts-2',
        },
        say,
      });

      expect(msgHandler).toHaveBeenCalledWith('<@BOT> hello', 'U456', 'event-ts-2');
    });

    it('sends default help reply when no messageCallback is set', async () => {
      // No callback set
      setupHandlers();

      const say = vi.fn().mockResolvedValue(undefined);
      await capturedAppMentionHandler({
        event: {
          text: '<@BOT> hello',
          user: 'U456',
          ts: 'event-ts-3',
        },
        say,
      });

      expect(say).toHaveBeenCalledWith({
        text: 'Hello <@U456>! Use `/tc help` to see available commands.',
        thread_ts: 'event-ts-3',
      });
    });

    it('sends error message via say when messageCallback throws', async () => {
      const msgHandler = vi.fn().mockRejectedValue(new Error('mention handler broke'));
      setMessageHandler(msgHandler);
      setupHandlers();

      const say = vi.fn().mockResolvedValue(undefined);
      await capturedAppMentionHandler({
        event: {
          text: '<@BOT> hello',
          user: 'U456',
          ts: 'event-ts-4',
        },
        say,
      });

      expect(say).toHaveBeenCalledWith({
        text: 'An error occurred processing your mention: mention handler broke',
        thread_ts: 'event-ts-4',
      });
    });

    it('does not throw when both messageCallback and error say fail', async () => {
      const msgHandler = vi.fn().mockRejectedValue(new Error('handler broke'));
      setMessageHandler(msgHandler);
      setupHandlers();

      const say = vi.fn().mockRejectedValue(new Error('say also broke'));

      // Should not throw even if say fails
      await capturedAppMentionHandler({
        event: {
          text: '<@BOT> hello',
          user: 'U456',
          ts: 'event-ts-5',
        },
        say,
      });

      // Just verifying it doesn't throw
      expect(say).toHaveBeenCalled();
    });
  });
});
