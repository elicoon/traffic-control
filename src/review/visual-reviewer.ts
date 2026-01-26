import { ReviewRepository, VisualReview } from './review-repository.js';
import { ScreenshotCapture, ScreenshotConfig } from './screenshot-capture.js';
import { sendMessage, formatVisualReview } from '../slack/bot.js';
import { Task } from '../db/repositories/tasks.js';

export interface ReviewResult {
  approved: boolean;
  feedback?: string;
  reviewedBy?: string;
  reviewedAt: Date;
}

export interface VisualReviewerOptions {
  reviewRepository: ReviewRepository;
  screenshotCapture: ScreenshotCapture;
  slackChannel: string;
  projectName: string;
}

// Keywords that indicate a task likely needs visual review
const UI_KEYWORDS = [
  'ui', 'frontend', 'component', 'page', 'layout', 'style', 'css',
  'design', 'visual', 'button', 'form', 'modal', 'dialog', 'menu',
  'navigation', 'header', 'footer', 'sidebar', 'dashboard', 'chart',
  'graph', 'animation', 'responsive', 'mobile', 'theme'
];

// Slack emoji names that indicate approval
const APPROVAL_EMOJIS = ['white_check_mark', 'heavy_check_mark', '+1', 'thumbsup', 'yes'];

// Slack emoji names that indicate rejection
const REJECTION_EMOJIS = ['x', 'heavy_multiplication_x', '-1', 'thumbsdown', 'no'];

/**
 * Coordinates the visual review process for UI tasks.
 * Detects tasks requiring review, captures screenshots, and handles Slack responses.
 */
export class VisualReviewer {
  private reviewRepository: ReviewRepository;
  private screenshotCapture: ScreenshotCapture;
  private slackChannel: string;
  private projectName: string;

  constructor(options: VisualReviewerOptions) {
    this.reviewRepository = options.reviewRepository;
    this.screenshotCapture = options.screenshotCapture;
    this.slackChannel = options.slackChannel;
    this.projectName = options.projectName;
  }

  /**
   * Determines if a task requires visual review.
   * Checks the requires_visual_review flag, tags, and title keywords.
   */
  requiresVisualReview(task: Task): boolean {
    // Explicit flag takes precedence
    if (task.requires_visual_review) {
      return true;
    }

    // Check for frontend/UI tags
    const tags = task.tags || [];
    if (tags.some(tag =>
      UI_KEYWORDS.some(keyword => tag.toLowerCase().includes(keyword))
    )) {
      return true;
    }

    // Check title for UI-related keywords
    const titleLower = task.title.toLowerCase();
    if (UI_KEYWORDS.some(keyword => titleLower.includes(keyword))) {
      return true;
    }

    return false;
  }

  /**
   * Initiates a visual review by capturing a screenshot and sending to Slack.
   * @param taskId The ID of the task being reviewed
   * @param sessionId The ID of the agent session
   * @param config Screenshot capture configuration
   * @returns The created visual review record
   */
  async initiateReview(
    taskId: string,
    sessionId: string,
    config: ScreenshotConfig
  ): Promise<VisualReview> {
    try {
      // Capture screenshot
      const screenshotResult = await this.screenshotCapture.capture(config);

      // Send to Slack with screenshot
      const message = formatVisualReview(this.projectName, config.url);

      // Note: In production, you'd upload the screenshot to Slack or a storage service
      // For now, we include the local path in the message
      const fullMessage = `${message}\n\nScreenshot: ${screenshotResult.path}`;

      const slackTs = await sendMessage({
        channel: this.slackChannel,
        text: fullMessage
      });

      // Create review record
      const review = await this.reviewRepository.create({
        taskId,
        sessionId,
        screenshotPath: screenshotResult.path,
        status: 'pending',
        slackMessageTs: slackTs
      });

      return review;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initiate visual review: ${message}`);
    }
  }

  /**
   * Handles a response from Slack (text reply or emoji reaction).
   * @param messageTs The Slack message timestamp to identify the review
   * @param response The response text or emoji name
   * @param userId The Slack user ID who responded
   * @returns The review result
   */
  async handleSlackResponse(
    messageTs: string,
    response: string,
    userId: string
  ): Promise<ReviewResult> {
    // Find the review by Slack message timestamp
    const review = await this.reviewRepository.getBySlackMessageTs(messageTs);
    if (!review) {
      throw new Error('Review not found for this message');
    }

    const normalizedResponse = response.toLowerCase().trim();
    const originalResponse = response.trim();

    // Check for approval
    if (this.isApproval(normalizedResponse)) {
      await this.reviewRepository.updateStatus(review.id, 'approved', undefined);
      return {
        approved: true,
        reviewedBy: userId,
        reviewedAt: new Date()
      };
    }

    // Check for rejection
    if (this.isRejection(normalizedResponse)) {
      // Extract feedback from original response to preserve case
      const feedback = this.extractFeedback(originalResponse);
      await this.reviewRepository.updateStatus(review.id, 'rejected', feedback);
      return {
        approved: false,
        feedback,
        reviewedBy: userId,
        reviewedAt: new Date()
      };
    }

    throw new Error('Invalid response format. Use "approve" or "reject: [feedback]"');
  }

  /**
   * Gets all pending visual reviews.
   */
  async getPendingReviews(): Promise<VisualReview[]> {
    return this.reviewRepository.getPending();
  }

  /**
   * Gets all reviews for a specific task.
   */
  async getReviewsForTask(taskId: string): Promise<VisualReview[]> {
    return this.reviewRepository.getByTaskId(taskId);
  }

  /**
   * Cleans up old screenshots to save disk space.
   * @param olderThanDays Delete screenshots older than this many days
   * @returns Number of files deleted
   */
  async cleanupOldScreenshots(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    return this.screenshotCapture.cleanup(cutoffDate);
  }

  /**
   * Checks if a response indicates approval.
   */
  private isApproval(response: string): boolean {
    // Check for approval text
    if (response === 'approve' || response === 'approved' || response === 'lgtm') {
      return true;
    }

    // Check for approval emoji
    if (APPROVAL_EMOJIS.includes(response)) {
      return true;
    }

    return false;
  }

  /**
   * Checks if a response indicates rejection.
   */
  private isRejection(response: string): boolean {
    // Check for rejection text
    if (response.startsWith('reject') || response === 'rejected') {
      return true;
    }

    // Check for rejection emoji
    if (REJECTION_EMOJIS.includes(response)) {
      return true;
    }

    return false;
  }

  /**
   * Extracts feedback from a rejection response.
   * Expected format: "reject: [feedback]" or just "reject"
   */
  private extractFeedback(response: string): string | undefined {
    // Check for "reject: feedback" format
    const colonIndex = response.indexOf(':');
    if (colonIndex > 0) {
      const feedback = response.substring(colonIndex + 1).trim();
      return feedback || undefined;
    }

    return undefined;
  }
}
