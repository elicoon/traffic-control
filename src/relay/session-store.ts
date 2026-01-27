/**
 * Session Store for Slack Claude Relay
 *
 * In-memory store for mapping Slack thread timestamps to Claude session IDs.
 * This enables conversation continuity via the --resume flag.
 *
 * Note: This is intentionally ephemeral (in-memory only). Session IDs
 * are short-lived and don't need persistence across restarts.
 */

/**
 * In-memory session store.
 * Maps Slack thread timestamps to Claude CLI session IDs.
 */
export class SessionStore {
  /** Thread timestamp -> Claude session ID mapping */
  private sessions: Map<string, string> = new Map();

  /**
   * Get the Claude session ID for a Slack thread.
   *
   * @param threadTs - Slack thread timestamp
   * @returns The Claude session ID, or undefined if not found
   */
  get(threadTs: string): string | undefined {
    return this.sessions.get(threadTs);
  }

  /**
   * Store a Claude session ID for a Slack thread.
   *
   * @param threadTs - Slack thread timestamp
   * @param sessionId - Claude CLI session ID
   */
  set(threadTs: string, sessionId: string): void {
    this.sessions.set(threadTs, sessionId);
  }

  /**
   * Delete the session mapping for a Slack thread.
   * Used when the user sends !reset to start a fresh conversation.
   *
   * @param threadTs - Slack thread timestamp
   * @returns true if the mapping existed and was deleted
   */
  delete(threadTs: string): boolean {
    return this.sessions.delete(threadTs);
  }

  /**
   * Check if a session mapping exists for a thread.
   *
   * @param threadTs - Slack thread timestamp
   * @returns true if a mapping exists
   */
  has(threadTs: string): boolean {
    return this.sessions.has(threadTs);
  }

  /**
   * Clear all session mappings.
   * Useful for testing or manual cleanup.
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Get the number of stored sessions.
   *
   * @returns Number of active session mappings
   */
  size(): number {
    return this.sessions.size;
  }

  /**
   * Get all thread timestamps with active sessions.
   *
   * @returns Array of thread timestamps
   */
  threads(): string[] {
    return Array.from(this.sessions.keys());
  }
}
