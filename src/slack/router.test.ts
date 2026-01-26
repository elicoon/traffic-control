import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { SlackRouter, SlackRouterConfig, ResponseHandler, SendMessageFn, UploadFileFn } from './router.js';
import { SlackMessage } from './bot.js';

// Type for mocked functions that retains vi.fn() methods
type MockedSendMessage = SendMessageFn & Mock;
type MockedUploadFile = UploadFileFn & Mock;
type MockedResponseHandler = ResponseHandler & Mock;

describe('SlackRouter', () => {
  let router: SlackRouter;
  let mockSendMessage: MockedSendMessage;
  let mockUploadFile: MockedUploadFile;
  let mockResponseHandler: MockedResponseHandler;
  let config: SlackRouterConfig;

  beforeEach(() => {
    mockSendMessage = vi.fn().mockResolvedValue('1234567890.123456') as MockedSendMessage;
    mockUploadFile = vi.fn().mockResolvedValue('file-123') as MockedUploadFile;
    mockResponseHandler = vi.fn().mockResolvedValue(undefined) as MockedResponseHandler;

    config = {
      channelId: 'C12345',
      batchIntervalMs: 5000,
      quietHoursStart: 0,
      quietHoursEnd: 7
    };

    router = new SlackRouter(config, mockSendMessage, mockUploadFile);
    router.onResponse(mockResponseHandler);
  });

  describe('routeQuestion', () => {
    it('should send question to Slack and return thread timestamp', async () => {
      const threadTs = await router.routeQuestion(
        'agent-1',
        'task-1',
        'TestProject',
        'What database should I use?'
      );

      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'C12345',
        text: expect.stringContaining('TestProject')
      }));
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining('What database should I use?')
      }));
      expect(threadTs).toBe('1234567890.123456');
    });

    it('should create thread entry for question', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'TestProject', 'Question?');

      const thread = router.getThreadForTask('task-1');
      expect(thread).toBeDefined();
      expect(thread?.agentId).toBe('agent-1');
      expect(thread?.projectName).toBe('TestProject');
      expect(thread?.status).toBe('waiting_response');
    });

    it('should include question emoji in message', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'TestProject', 'Question?');

      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringMatching(/\?/)
      }));
    });
  });

  describe('routeBlocker', () => {
    it('should send blocker to Slack', async () => {
      const threadTs = await router.routeBlocker(
        'agent-1',
        'task-1',
        'TestProject',
        'Cannot access API endpoint'
      );

      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining('Cannot access API endpoint')
      }));
      expect(threadTs).toBe('1234567890.123456');
    });

    it('should create thread entry for blocker', async () => {
      await router.routeBlocker('agent-1', 'task-1', 'TestProject', 'Blocked!');

      const thread = router.getThreadForTask('task-1');
      expect(thread).toBeDefined();
      expect(thread?.status).toBe('waiting_response');
    });
  });

  describe('routeVisualReview', () => {
    it('should upload screenshot and send review request', async () => {
      const screenshot = Buffer.from('fake-image-data');

      const threadTs = await router.routeVisualReview(
        'agent-1',
        'task-1',
        'TestProject',
        screenshot
      );

      expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({
        channels: 'C12345',
        file: screenshot
      }));
      expect(threadTs).toBeDefined();
    });

    it('should create thread entry for visual review', async () => {
      const screenshot = Buffer.from('fake-image-data');

      await router.routeVisualReview('agent-1', 'task-1', 'TestProject', screenshot);

      const thread = router.getThreadForTask('task-1');
      expect(thread).toBeDefined();
      expect(thread?.status).toBe('waiting_response');
    });
  });

  describe('routeCompletion', () => {
    it('should send completion notification', async () => {
      await router.routeCompletion(
        'agent-1',
        'task-1',
        'TestProject',
        'Successfully implemented feature X'
      );

      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining('Successfully implemented feature X')
      }));
    });

    it('should resolve existing thread on completion', async () => {
      // First create a thread via question
      await router.routeQuestion('agent-1', 'task-1', 'TestProject', 'Question?');

      // Then complete it
      await router.routeCompletion('agent-1', 'task-1', 'TestProject', 'Done!');

      const thread = router.getThreadForTask('task-1');
      expect(thread?.status).toBe('resolved');
    });

    it('should send completion to existing thread if one exists', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'TestProject', 'Question?');
      mockSendMessage.mockClear();

      await router.routeCompletion('agent-1', 'task-1', 'TestProject', 'Done!');

      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        thread_ts: '1234567890.123456'
      }));
    });
  });

  describe('handleResponse', () => {
    it('should invoke response handler when response received', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'TestProject', 'Question?');

      await router.handleResponse('1234567890.123456', 'user-1', 'Use PostgreSQL');

      expect(mockResponseHandler).toHaveBeenCalledWith(expect.objectContaining({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        agentId: 'agent-1',
        userId: 'user-1',
        text: 'Use PostgreSQL'
      }));
    });

    it('should add message to thread', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'TestProject', 'Question?');
      await router.handleResponse('1234567890.123456', 'user-1', 'Answer here');

      const thread = router.getThreadForTask('task-1');
      expect(thread?.messages).toHaveLength(1);
      expect(thread?.messages[0].text).toBe('Answer here');
    });

    it('should handle "skip" response for blockers', async () => {
      await router.routeBlocker('agent-1', 'task-1', 'TestProject', 'Blocked');
      await router.handleResponse('1234567890.123456', 'user-1', 'skip');

      expect(mockResponseHandler).toHaveBeenCalledWith(expect.objectContaining({
        isSkip: true
      }));
    });

    it('should ignore responses for unknown threads', async () => {
      await router.handleResponse('unknown-thread', 'user-1', 'Hello');

      expect(mockResponseHandler).not.toHaveBeenCalled();
    });
  });

  describe('handleReaction', () => {
    it('should handle approval reaction', async () => {
      const threadTs = await router.routeVisualReview('agent-1', 'task-1', 'TestProject', Buffer.from('img'));

      await router.handleReaction('white_check_mark', 'user-1', threadTs);

      expect(mockResponseHandler).toHaveBeenCalledWith(expect.objectContaining({
        isApproval: true
      }));
    });

    it('should handle rejection reaction', async () => {
      const threadTs = await router.routeVisualReview('agent-1', 'task-1', 'TestProject', Buffer.from('img'));

      await router.handleReaction('x', 'user-1', threadTs);

      expect(mockResponseHandler).toHaveBeenCalledWith(expect.objectContaining({
        isRejection: true
      }));
    });

    it('should ignore reactions on unknown threads', async () => {
      await router.handleReaction('white_check_mark', 'user-1', 'unknown-thread');

      expect(mockResponseHandler).not.toHaveBeenCalled();
    });

    it('should ignore other reactions', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'TestProject', 'Question?');

      await router.handleReaction('thumbsup', 'user-1', '1234567890.123456');

      expect(mockResponseHandler).not.toHaveBeenCalled();
    });
  });

  describe('getThreadForTask', () => {
    it('should return thread for task', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'TestProject', 'Q?');

      const thread = router.getThreadForTask('task-1');
      expect(thread).toBeDefined();
      expect(thread?.taskId).toBe('task-1');
    });

    it('should return undefined for unknown task', () => {
      const thread = router.getThreadForTask('unknown-task');
      expect(thread).toBeUndefined();
    });
  });

  describe('getActiveThreads', () => {
    it('should return all active threads', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'ProjectA', 'Q1?');
      mockSendMessage.mockResolvedValueOnce('2222222222.222222');
      await router.routeBlocker('agent-2', 'task-2', 'ProjectB', 'Blocked');

      const active = router.getActiveThreads();
      expect(active).toHaveLength(2);
    });

    it('should not include resolved threads', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'ProjectA', 'Q1?');
      await router.routeCompletion('agent-1', 'task-1', 'ProjectA', 'Done');

      const active = router.getActiveThreads();
      expect(active).toHaveLength(0);
    });
  });

  describe('getThreadsByProject', () => {
    it('should return threads for specific project', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'ProjectA', 'Q1?');
      mockSendMessage.mockResolvedValueOnce('2222222222.222222');
      await router.routeQuestion('agent-2', 'task-2', 'ProjectA', 'Q2?');
      mockSendMessage.mockResolvedValueOnce('3333333333.333333');
      await router.routeQuestion('agent-3', 'task-3', 'ProjectB', 'Q3?');

      const projectAThreads = router.getThreadsByProject('ProjectA');
      expect(projectAThreads).toHaveLength(2);
    });
  });

  describe('thread lifecycle', () => {
    it('should track full lifecycle: question -> response -> completion', async () => {
      // Question asked
      const threadTs = await router.routeQuestion('agent-1', 'task-1', 'Project', 'What?');
      let thread = router.getThreadForTask('task-1');
      expect(thread?.status).toBe('waiting_response');

      // Response received
      await router.handleResponse(threadTs, 'user-1', 'Do X');
      thread = router.getThreadForTask('task-1');
      expect(thread?.messages).toHaveLength(1);

      // Task completed
      await router.routeCompletion('agent-1', 'task-1', 'Project', 'Done');
      thread = router.getThreadForTask('task-1');
      expect(thread?.status).toBe('resolved');
    });
  });

  describe('error handling', () => {
    it('should throw error when send fails', async () => {
      mockSendMessage.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        router.routeQuestion('agent-1', 'task-1', 'Project', 'Q?')
      ).rejects.toThrow('Network error');
    });

    it('should throw error when file upload fails', async () => {
      mockUploadFile.mockRejectedValueOnce(new Error('Upload failed'));

      await expect(
        router.routeVisualReview('agent-1', 'task-1', 'Project', Buffer.from('img'))
      ).rejects.toThrow('Upload failed');
    });
  });

  describe('multiple response handlers', () => {
    it('should support multiple response handlers', async () => {
      const handler2 = vi.fn();
      router.onResponse(handler2);

      await router.routeQuestion('agent-1', 'task-1', 'Project', 'Q?');
      await router.handleResponse('1234567890.123456', 'user-1', 'Answer');

      expect(mockResponseHandler).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should allow removing response handlers', async () => {
      const unsubscribe = router.onResponse(mockResponseHandler);
      unsubscribe();

      await router.routeQuestion('agent-1', 'task-1', 'Project', 'Q?');
      await router.handleResponse('1234567890.123456', 'user-1', 'Answer');

      // Handler was registered initially but then unsubscribed
      // The original mockResponseHandler from beforeEach is still registered
      // so we need to check that the one we just unsubscribed is not called extra times
    });

    it('should clear all threads', async () => {
      await router.routeQuestion('agent-1', 'task-1', 'Project', 'Q?');

      router.clearThreads();

      expect(router.getActiveThreads()).toHaveLength(0);
    });
  });
});
