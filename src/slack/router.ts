import { SlackMessage, formatQuestion, formatBlocker, formatVisualReview } from './bot.js';
import { ThreadTracker, SlackThread } from './thread-tracker.js';

/**
 * Configuration for the Slack router.
 */
export interface SlackRouterConfig {
  channelId: string;
  batchIntervalMs: number;
  quietHoursStart: number;
  quietHoursEnd: number;
}

/**
 * Response data passed to response handlers.
 */
export interface ResponseData {
  threadTs: string;
  taskId: string;
  agentId: string;
  projectName: string;
  userId: string;
  text: string;
  isSkip?: boolean;
  isApproval?: boolean;
  isRejection?: boolean;
}

/**
 * Handler function for user responses.
 */
export type ResponseHandler = (response: ResponseData) => Promise<void>;

/**
 * Function to send Slack messages.
 */
export type SendMessageFn = (message: SlackMessage) => Promise<string | undefined>;

/**
 * File upload options.
 */
export interface FileUploadOptions {
  channels: string;
  file: Buffer;
  filename?: string;
  title?: string;
  initial_comment?: string;
  thread_ts?: string;
}

/**
 * Function to upload files to Slack.
 */
export type UploadFileFn = (options: FileUploadOptions) => Promise<string | undefined>;

/**
 * Routes messages between agents and Slack with proper threading.
 */
export class SlackRouter {
  private config: SlackRouterConfig;
  private sendMessage: SendMessageFn;
  private uploadFile: UploadFileFn;
  private threadTracker: ThreadTracker;
  private responseHandlers: ResponseHandler[] = [];

  constructor(
    config: SlackRouterConfig,
    sendMessage: SendMessageFn,
    uploadFile: UploadFileFn
  ) {
    this.config = config;
    this.sendMessage = sendMessage;
    this.uploadFile = uploadFile;
    this.threadTracker = new ThreadTracker();
  }

  /**
   * Routes a question from an agent to Slack.
   * Returns the thread timestamp for tracking.
   */
  async routeQuestion(
    agentId: string,
    taskId: string,
    projectName: string,
    question: string
  ): Promise<string> {
    const text = formatQuestion(projectName, question) + '\n_(Reply in thread to respond)_';

    const message: SlackMessage = {
      channel: this.config.channelId,
      text
    };

    const threadTs = await this.sendMessage(message);

    if (!threadTs) {
      throw new Error('Failed to send message - no thread timestamp returned');
    }

    // Track the thread
    this.threadTracker.createThread({
      threadTs,
      taskId,
      projectName,
      agentId,
      status: 'waiting_response'
    });

    return threadTs;
  }

  /**
   * Routes a blocker notification from an agent to Slack.
   * Returns the thread timestamp for tracking.
   */
  async routeBlocker(
    agentId: string,
    taskId: string,
    projectName: string,
    reason: string
  ): Promise<string> {
    const text = formatBlocker(projectName, reason) + '\n_(Reply "skip" to move to next task, or provide guidance)_';

    const message: SlackMessage = {
      channel: this.config.channelId,
      text
    };

    const threadTs = await this.sendMessage(message);

    if (!threadTs) {
      throw new Error('Failed to send message - no thread timestamp returned');
    }

    // Track the thread
    this.threadTracker.createThread({
      threadTs,
      taskId,
      projectName,
      agentId,
      status: 'waiting_response'
    });

    return threadTs;
  }

  /**
   * Routes a visual review request with screenshot to Slack.
   * Returns the thread timestamp for tracking.
   */
  async routeVisualReview(
    agentId: string,
    taskId: string,
    projectName: string,
    screenshot: Buffer
  ): Promise<string> {
    const comment = formatVisualReview(projectName, taskId) +
      '\n_(React with tick to approve, X + reply with feedback to reject)_';

    const uploadResult = await this.uploadFile({
      channels: this.config.channelId,
      file: screenshot,
      filename: `review-${taskId}.png`,
      title: `Visual Review - ${projectName}`,
      initial_comment: comment
    });

    // For simplicity, we use the file ID as the thread identifier
    // In a real implementation, we'd get the message timestamp from the upload response
    const threadTs = uploadResult || Date.now().toString();

    // Track the thread
    this.threadTracker.createThread({
      threadTs,
      taskId,
      projectName,
      agentId,
      status: 'waiting_response'
    });

    return threadTs;
  }

  /**
   * Routes a task completion notification to Slack.
   */
  async routeCompletion(
    agentId: string,
    taskId: string,
    projectName: string,
    summary: string
  ): Promise<void> {
    const text = `*[${projectName}]* Task complete:\n\n${summary}`;

    // Check if there's an existing thread for this task
    const existingThread = this.threadTracker.getByTaskId(taskId);

    const message: SlackMessage = {
      channel: this.config.channelId,
      text,
      thread_ts: existingThread?.threadTs
    };

    await this.sendMessage(message);

    // Mark thread as resolved if it exists
    if (existingThread) {
      this.threadTracker.resolveThread(existingThread.threadTs);
    }
  }

  /**
   * Handles a text response from a user in a thread.
   */
  async handleResponse(
    threadTs: string,
    userId: string,
    text: string
  ): Promise<void> {
    const thread = this.threadTracker.getByThreadTs(threadTs);

    if (!thread) {
      // Unknown thread, ignore
      return;
    }

    // Add message to thread
    this.threadTracker.addMessageToThread(threadTs, {
      messageTs: Date.now().toString(),
      userId,
      text
    });

    // Check for special commands
    const isSkip = text.toLowerCase().trim() === 'skip';

    // Build response data
    const responseData: ResponseData = {
      threadTs,
      taskId: thread.taskId,
      agentId: thread.agentId,
      projectName: thread.projectName,
      userId,
      text,
      isSkip
    };

    // Notify all handlers
    for (const handler of this.responseHandlers) {
      await handler(responseData);
    }
  }

  /**
   * Handles a reaction from a user on a message.
   */
  async handleReaction(
    reaction: string,
    userId: string,
    messageTs: string
  ): Promise<void> {
    const thread = this.threadTracker.getByThreadTs(messageTs);

    if (!thread) {
      // Unknown thread, ignore
      return;
    }

    // Only handle approval/rejection reactions
    const isApproval = reaction === 'white_check_mark';
    const isRejection = reaction === 'x';

    if (!isApproval && !isRejection) {
      return;
    }

    // Build response data
    const responseData: ResponseData = {
      threadTs: messageTs,
      taskId: thread.taskId,
      agentId: thread.agentId,
      projectName: thread.projectName,
      userId,
      text: '',
      isApproval,
      isRejection
    };

    // Notify all handlers
    for (const handler of this.responseHandlers) {
      await handler(responseData);
    }
  }

  /**
   * Registers a handler to be called when user responses are received.
   * Returns an unsubscribe function.
   */
  onResponse(handler: ResponseHandler): () => void {
    this.responseHandlers.push(handler);

    return () => {
      const index = this.responseHandlers.indexOf(handler);
      if (index !== -1) {
        this.responseHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Gets the thread associated with a task.
   */
  getThreadForTask(taskId: string): SlackThread | undefined {
    return this.threadTracker.getByTaskId(taskId);
  }

  /**
   * Gets all active (non-resolved) threads.
   */
  getActiveThreads(): SlackThread[] {
    return this.threadTracker.getActiveThreads();
  }

  /**
   * Gets all threads for a specific project.
   */
  getThreadsByProject(projectName: string): SlackThread[] {
    return this.threadTracker.getByProject(projectName);
  }

  /**
   * Clears all tracked threads.
   */
  clearThreads(): void {
    this.threadTracker.clear();
  }
}
