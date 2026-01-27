import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VisualReviewer, ReviewResult } from './visual-reviewer.js';
import { ReviewRepository, VisualReview } from './review-repository.js';
import { ScreenshotCapture, ScreenshotConfig } from './screenshot-capture.js';
import { Task } from '../db/repositories/tasks.js';

// Mock dependencies
vi.mock('./review-repository.js');
vi.mock('./screenshot-capture.js');
vi.mock('../slack/bot.js', () => ({
  sendMessage: vi.fn(),
  formatVisualReview: vi.fn()
}));

import { sendMessage, formatVisualReview } from '../slack/bot.js';

describe('VisualReviewer', () => {
  let visualReviewer: VisualReviewer;
  let mockReviewRepo: ReviewRepository;
  let mockScreenshotCapture: ScreenshotCapture;

  const mockTask: Task = {
    id: 'task-123',
    project_id: 'project-123',
    title: 'Build login page',
    description: 'Create a login page with form validation',
    status: 'in_progress',
    priority: 1,
    complexity_estimate: 'medium',
    estimated_sessions_opus: 2,
    estimated_sessions_sonnet: 4,
    actual_tokens_opus: 0,
    actual_tokens_sonnet: 0,
    actual_sessions_opus: 0,
    actual_sessions_sonnet: 0,
    assigned_agent_id: 'agent-1',
    requires_visual_review: true,
    parent_task_id: null,
    tags: ['frontend'],
    acceptance_criteria: null,
    source: 'user',
    blocked_by_task_id: null,
    eta: null,
    started_at: null,
    completed_at: null,
    priority_confirmed: false,
    priority_confirmed_at: null,
    priority_confirmed_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const mockReview: VisualReview = {
    id: 'review-123',
    taskId: 'task-123',
    sessionId: 'session-123',
    screenshotUrl: 'https://storage.example.com/screenshot.png',
    screenshotPath: '/screenshots/screenshot-123.png',
    status: 'pending',
    slackMessageTs: '1234567890.123456',
    createdAt: new Date(),
    reviewedAt: undefined
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockReviewRepo = {
      create: vi.fn().mockResolvedValue(mockReview),
      getById: vi.fn().mockResolvedValue(mockReview),
      getByTaskId: vi.fn().mockResolvedValue([mockReview]),
      getBySlackMessageTs: vi.fn().mockResolvedValue(mockReview),
      updateStatus: vi.fn().mockResolvedValue({ ...mockReview, status: 'approved' }),
      getPending: vi.fn().mockResolvedValue([mockReview]),
      delete: vi.fn().mockResolvedValue(undefined)
    } as unknown as ReviewRepository;

    mockScreenshotCapture = {
      capture: vi.fn().mockResolvedValue({
        path: '/screenshots/screenshot-123.png',
        buffer: Buffer.from('fake-image')
      }),
      cleanup: vi.fn().mockResolvedValue(5),
      getOutputDir: vi.fn().mockReturnValue('/screenshots')
    } as unknown as ScreenshotCapture;

    vi.mocked(sendMessage).mockResolvedValue('1234567890.123456');
    vi.mocked(formatVisualReview).mockReturnValue('Visual review message');

    visualReviewer = new VisualReviewer({
      reviewRepository: mockReviewRepo,
      screenshotCapture: mockScreenshotCapture,
      slackChannel: '#reviews',
      projectName: 'Test Project'
    });
  });

  describe('requiresVisualReview', () => {
    it('should return true for tasks with requires_visual_review flag', () => {
      expect(visualReviewer.requiresVisualReview(mockTask)).toBe(true);
    });

    it('should return false for tasks without requires_visual_review flag', () => {
      const taskWithoutReview = {
        ...mockTask,
        requires_visual_review: false,
        title: 'Setup database connection',
        tags: ['backend']
      };
      expect(visualReviewer.requiresVisualReview(taskWithoutReview)).toBe(false);
    });

    it('should return true for tasks with frontend tag', () => {
      const frontendTask = {
        ...mockTask,
        requires_visual_review: false,
        tags: ['frontend', 'ui']
      };
      expect(visualReviewer.requiresVisualReview(frontendTask)).toBe(true);
    });

    it('should return true for tasks with UI-related keywords in title', () => {
      const uiTask = {
        ...mockTask,
        requires_visual_review: false,
        tags: [],
        title: 'Create dashboard UI component'
      };
      expect(visualReviewer.requiresVisualReview(uiTask)).toBe(true);
    });

    it('should return false for backend tasks', () => {
      const backendTask = {
        ...mockTask,
        requires_visual_review: false,
        tags: ['backend', 'api'],
        title: 'Add database migration'
      };
      expect(visualReviewer.requiresVisualReview(backendTask)).toBe(false);
    });
  });

  describe('initiateReview', () => {
    const screenshotConfig: ScreenshotConfig = {
      url: 'http://localhost:3000/login',
      viewport: { width: 1280, height: 720 }
    };

    it('should capture screenshot and create review', async () => {
      const review = await visualReviewer.initiateReview(
        'task-123',
        'session-123',
        screenshotConfig
      );

      expect(mockScreenshotCapture.capture).toHaveBeenCalledWith(screenshotConfig);
      expect(mockReviewRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-123',
        sessionId: 'session-123',
        screenshotPath: '/screenshots/screenshot-123.png',
        status: 'pending'
      }));
      expect(review.id).toBe('review-123');
    });

    it('should send Slack message with screenshot', async () => {
      await visualReviewer.initiateReview('task-123', 'session-123', screenshotConfig);

      expect(formatVisualReview).toHaveBeenCalledWith('Test Project', expect.any(String));
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        channel: '#reviews'
      }));
    });

    it('should update review with Slack message timestamp', async () => {
      vi.mocked(sendMessage).mockResolvedValue('new-timestamp.123');

      await visualReviewer.initiateReview('task-123', 'session-123', screenshotConfig);

      expect(mockReviewRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        slackMessageTs: 'new-timestamp.123'
      }));
    });

    it('should throw error if screenshot capture fails', async () => {
      vi.mocked(mockScreenshotCapture.capture).mockRejectedValue(
        new Error('Browser not available')
      );

      await expect(
        visualReviewer.initiateReview('task-123', 'session-123', screenshotConfig)
      ).rejects.toThrow('Failed to initiate visual review');
    });
  });

  describe('handleSlackResponse', () => {
    it('should approve review when response is approve', async () => {
      const result = await visualReviewer.handleSlackResponse(
        '1234567890.123456',
        'approve',
        'user-123'
      );

      expect(mockReviewRepo.getBySlackMessageTs).toHaveBeenCalledWith('1234567890.123456');
      expect(mockReviewRepo.updateStatus).toHaveBeenCalledWith('review-123', 'approved', undefined);
      expect(result.approved).toBe(true);
      expect(result.reviewedBy).toBe('user-123');
    });

    it('should reject review when response starts with reject', async () => {
      vi.mocked(mockReviewRepo.updateStatus).mockResolvedValue({
        ...mockReview,
        status: 'rejected',
        feedback: 'Needs better contrast'
      });

      const result = await visualReviewer.handleSlackResponse(
        '1234567890.123456',
        'reject: Needs better contrast',
        'user-123'
      );

      expect(mockReviewRepo.updateStatus).toHaveBeenCalledWith(
        'review-123',
        'rejected',
        'Needs better contrast'
      );
      expect(result.approved).toBe(false);
      expect(result.feedback).toBe('Needs better contrast');
    });

    it('should handle emoji reactions for approval', async () => {
      const result = await visualReviewer.handleSlackResponse(
        '1234567890.123456',
        'white_check_mark', // Slack emoji name
        'user-123'
      );

      expect(result.approved).toBe(true);
    });

    it('should handle emoji reactions for rejection', async () => {
      vi.mocked(mockReviewRepo.updateStatus).mockResolvedValue({
        ...mockReview,
        status: 'rejected'
      });

      const result = await visualReviewer.handleSlackResponse(
        '1234567890.123456',
        'x', // Slack emoji name
        'user-123'
      );

      expect(result.approved).toBe(false);
    });

    it('should throw error for unknown message timestamp', async () => {
      vi.mocked(mockReviewRepo.getBySlackMessageTs).mockResolvedValue(null);

      await expect(
        visualReviewer.handleSlackResponse('unknown.ts', 'approve', 'user-123')
      ).rejects.toThrow('Review not found');
    });

    it('should throw error for invalid response format', async () => {
      await expect(
        visualReviewer.handleSlackResponse('1234567890.123456', 'maybe', 'user-123')
      ).rejects.toThrow('Invalid response format');
    });
  });

  describe('getPendingReviews', () => {
    it('should return all pending reviews', async () => {
      const reviews = await visualReviewer.getPendingReviews();

      expect(mockReviewRepo.getPending).toHaveBeenCalled();
      expect(reviews).toHaveLength(1);
      expect(reviews[0].id).toBe('review-123');
    });

    it('should return empty array when no pending reviews', async () => {
      vi.mocked(mockReviewRepo.getPending).mockResolvedValue([]);

      const reviews = await visualReviewer.getPendingReviews();

      expect(reviews).toHaveLength(0);
    });
  });

  describe('getReviewsForTask', () => {
    it('should return all reviews for a task', async () => {
      const reviews = await visualReviewer.getReviewsForTask('task-123');

      expect(mockReviewRepo.getByTaskId).toHaveBeenCalledWith('task-123');
      expect(reviews).toHaveLength(1);
    });
  });

  describe('cleanupOldScreenshots', () => {
    it('should cleanup screenshots older than specified days', async () => {
      const deletedCount = await visualReviewer.cleanupOldScreenshots(7);

      expect(mockScreenshotCapture.cleanup).toHaveBeenCalled();
      expect(deletedCount).toBe(5);
    });
  });
});
