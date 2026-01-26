/**
 * Status of a Slack thread tracking an agent interaction.
 */
export type ThreadStatus = 'active' | 'waiting_response' | 'resolved';

/**
 * A message within a thread.
 */
export interface ThreadMessage {
  messageTs: string;
  userId: string;
  text: string;
  timestamp?: Date;
}

/**
 * Represents a Slack thread that's tracking an agent's task.
 */
export interface SlackThread {
  /** The Slack thread timestamp (unique identifier) */
  threadTs: string;
  /** The task ID this thread is associated with */
  taskId: string;
  /** The project name */
  projectName: string;
  /** The agent ID working on this task */
  agentId: string;
  /** Current status of the thread */
  status: ThreadStatus;
  /** When the thread was created */
  createdAt: Date;
  /** When the last activity occurred */
  lastActivityAt: Date;
  /** Messages in this thread */
  messages: ThreadMessage[];
}

/**
 * Input for creating a new thread.
 */
export interface CreateThreadInput {
  threadTs: string;
  taskId: string;
  projectName: string;
  agentId: string;
  status?: ThreadStatus;
}

/**
 * Input for adding a message to a thread.
 */
export interface AddMessageInput {
  messageTs: string;
  userId: string;
  text: string;
}

/**
 * Tracks Slack threads and maps them to tasks and agents.
 * Provides bidirectional lookup between threads, tasks, and agents.
 */
export class ThreadTracker {
  /** Map of threadTs -> SlackThread */
  private threads: Map<string, SlackThread> = new Map();
  /** Map of taskId -> threadTs for quick lookup */
  private taskToThread: Map<string, string> = new Map();

  /**
   * Creates a new thread entry.
   */
  createThread(input: CreateThreadInput): SlackThread {
    const now = new Date();
    const thread: SlackThread = {
      threadTs: input.threadTs,
      taskId: input.taskId,
      projectName: input.projectName,
      agentId: input.agentId,
      status: input.status ?? 'active',
      createdAt: now,
      lastActivityAt: now,
      messages: []
    };

    this.threads.set(input.threadTs, thread);
    this.taskToThread.set(input.taskId, input.threadTs);

    return thread;
  }

  /**
   * Gets a thread by its Slack thread timestamp.
   */
  getByThreadTs(threadTs: string): SlackThread | undefined {
    return this.threads.get(threadTs);
  }

  /**
   * Gets a thread by task ID.
   */
  getByTaskId(taskId: string): SlackThread | undefined {
    const threadTs = this.taskToThread.get(taskId);
    if (!threadTs) return undefined;
    return this.threads.get(threadTs);
  }

  /**
   * Gets all threads for a specific agent.
   */
  getByAgentId(agentId: string): SlackThread[] {
    const result: SlackThread[] = [];
    for (const thread of this.threads.values()) {
      if (thread.agentId === agentId) {
        result.push(thread);
      }
    }
    return result;
  }

  /**
   * Gets all threads for a specific project.
   */
  getByProject(projectName: string): SlackThread[] {
    const result: SlackThread[] = [];
    for (const thread of this.threads.values()) {
      if (thread.projectName === projectName) {
        result.push(thread);
      }
    }
    return result;
  }

  /**
   * Updates the status of a thread.
   * Returns true if the thread was found and updated.
   */
  updateStatus(threadTs: string, status: ThreadStatus): boolean {
    const thread = this.threads.get(threadTs);
    if (!thread) return false;

    thread.status = status;
    thread.lastActivityAt = new Date();
    return true;
  }

  /**
   * Gets all active threads (not resolved).
   */
  getActiveThreads(): SlackThread[] {
    const result: SlackThread[] = [];
    for (const thread of this.threads.values()) {
      if (thread.status === 'active' || thread.status === 'waiting_response') {
        result.push(thread);
      }
    }
    return result;
  }

  /**
   * Gets all threads waiting for a user response.
   */
  getWaitingResponseThreads(): SlackThread[] {
    const result: SlackThread[] = [];
    for (const thread of this.threads.values()) {
      if (thread.status === 'waiting_response') {
        result.push(thread);
      }
    }
    return result;
  }

  /**
   * Marks a thread as resolved.
   * Returns true if the thread was found and resolved.
   */
  resolveThread(threadTs: string): boolean {
    return this.updateStatus(threadTs, 'resolved');
  }

  /**
   * Removes a thread from tracking.
   * Returns true if the thread was found and removed.
   */
  removeThread(threadTs: string): boolean {
    const thread = this.threads.get(threadTs);
    if (!thread) return false;

    this.taskToThread.delete(thread.taskId);
    this.threads.delete(threadTs);
    return true;
  }

  /**
   * Gets all tracked threads.
   */
  getAllThreads(): SlackThread[] {
    return Array.from(this.threads.values());
  }

  /**
   * Clears all tracked threads.
   */
  clear(): void {
    this.threads.clear();
    this.taskToThread.clear();
  }

  /**
   * Adds a message to a thread.
   * Returns true if the message was added successfully.
   */
  addMessageToThread(threadTs: string, input: AddMessageInput): boolean {
    const thread = this.threads.get(threadTs);
    if (!thread) return false;

    thread.messages.push({
      messageTs: input.messageTs,
      userId: input.userId,
      text: input.text,
      timestamp: new Date()
    });
    thread.lastActivityAt = new Date();
    return true;
  }
}
