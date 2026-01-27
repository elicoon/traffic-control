/**
 * SubagentTracker - Tracks parent-child relationships between agent sessions
 * Enforces depth limits and provides hierarchy navigation utilities.
 */

import { AgentHierarchy } from './types.js';
import { logger } from '../logging/index.js';

const log = logger.child('SubagentTracker');

/**
 * Tracks subagent hierarchy and enforces depth limits
 */
export class SubagentTracker {
  private maxDepth: number;
  private hierarchy: Map<string, AgentHierarchy> = new Map();

  /**
   * Create a new SubagentTracker
   * @param maxDepth Maximum nesting depth for subagents (default: 2, minimum: 1)
   */
  constructor(maxDepth: number = 2) {
    this.maxDepth = Math.max(1, maxDepth);
  }

  /**
   * Get the configured maximum depth
   */
  getMaxDepth(): number {
    return this.maxDepth;
  }

  /**
   * Register a root-level session (no parent)
   * @param sessionId The session ID to register
   * @returns The created hierarchy node
   */
  registerRootSession(sessionId: string): AgentHierarchy {
    const node: AgentHierarchy = {
      sessionId,
      parentId: null,
      depth: 0,
      children: [],
    };
    this.hierarchy.set(sessionId, node);
    log.debug('Root session registered', { sessionId, maxDepth: this.maxDepth });
    return node;
  }

  /**
   * Check if a session can spawn a subagent (hasn't reached max depth)
   * @param parentSessionId The session that wants to spawn a subagent
   * @returns true if spawning is allowed, false otherwise
   */
  canSpawnSubagent(parentSessionId: string): boolean {
    const parent = this.hierarchy.get(parentSessionId);
    if (!parent) {
      return false;
    }
    // Can spawn if current depth + 1 is still within max depth
    return parent.depth < this.maxDepth;
  }

  /**
   * Register a subagent under a parent session
   * @param parentSessionId The parent session ID
   * @param childSessionId The new child session ID
   * @returns The created hierarchy node for the child
   * @throws Error if parent not found or max depth exceeded
   */
  registerSubagent(parentSessionId: string, childSessionId: string): AgentHierarchy {
    const parent = this.hierarchy.get(parentSessionId);
    if (!parent) {
      throw new Error(`Parent session ${parentSessionId} not found`);
    }

    if (parent.depth >= this.maxDepth) {
      throw new Error(
        `Maximum subagent depth (${this.maxDepth}) exceeded. ` +
          `Session ${parentSessionId} is at depth ${parent.depth}.`
      );
    }

    const child: AgentHierarchy = {
      sessionId: childSessionId,
      parentId: parentSessionId,
      depth: parent.depth + 1,
      children: [],
    };

    this.hierarchy.set(childSessionId, child);
    parent.children.push(child);

    log.debug('Subagent registered', {
      sessionId: childSessionId,
      parentSessionId,
      depth: child.depth,
      maxDepth: this.maxDepth,
    });
    return child;
  }

  /**
   * Get the depth of a session in the hierarchy
   * @param sessionId The session ID to check
   * @returns The depth level (0 = root), or -1 if not found
   */
  getDepth(sessionId: string): number {
    const node = this.hierarchy.get(sessionId);
    return node ? node.depth : -1;
  }

  /**
   * Get all descendant session IDs (children, grandchildren, etc.)
   * @param sessionId The session to get descendants for
   * @returns Array of descendant session IDs
   */
  getDescendants(sessionId: string): string[] {
    const node = this.hierarchy.get(sessionId);
    if (!node) {
      return [];
    }

    const descendants: string[] = [];
    const collectDescendants = (hierarchy: AgentHierarchy) => {
      for (const child of hierarchy.children) {
        descendants.push(child.sessionId);
        collectDescendants(child);
      }
    };

    collectDescendants(node);
    return descendants;
  }

  /**
   * Get the root session for a given session
   * @param sessionId The session to find the root for
   * @returns The root session ID, or null if not found
   */
  getRootSession(sessionId: string): string | null {
    let node = this.hierarchy.get(sessionId);
    if (!node) {
      return null;
    }

    while (node.parentId !== null) {
      const parent = this.hierarchy.get(node.parentId);
      if (!parent) {
        // Inconsistent state - parent reference but no parent node
        break;
      }
      node = parent;
    }

    return node.sessionId;
  }

  /**
   * Remove a session and all its descendants from tracking
   * @param sessionId The session to remove
   */
  removeSession(sessionId: string): void {
    const node = this.hierarchy.get(sessionId);
    if (!node) {
      return;
    }

    // Remove from parent's children
    if (node.parentId) {
      const parent = this.hierarchy.get(node.parentId);
      if (parent) {
        parent.children = parent.children.filter(child => child.sessionId !== sessionId);
      }
    }

    // Count descendants for logging
    let descendantsRemoved = 0;

    // Recursively remove all descendants
    const removeDescendants = (hierarchy: AgentHierarchy) => {
      for (const child of hierarchy.children) {
        removeDescendants(child);
        this.hierarchy.delete(child.sessionId);
        descendantsRemoved++;
      }
    };

    removeDescendants(node);
    this.hierarchy.delete(sessionId);
    log.debug('Session removed from hierarchy', {
      sessionId,
      hadParent: node.parentId !== null,
      descendantsRemoved,
    });
  }

  /**
   * Get the full hierarchy tree for a session
   * @param sessionId The session ID
   * @returns The hierarchy node, or null if not found
   */
  getHierarchy(sessionId: string): AgentHierarchy | null {
    return this.hierarchy.get(sessionId) || null;
  }

  /**
   * Get the parent ID for a session
   * @param sessionId The session ID
   * @returns The parent session ID, or null if root or not found
   */
  getParentId(sessionId: string): string | null {
    const node = this.hierarchy.get(sessionId);
    return node?.parentId ?? null;
  }

  /**
   * Get all root-level sessions
   * @returns Array of root session IDs
   */
  getAllRootSessions(): string[] {
    const roots: string[] = [];
    this.hierarchy.forEach((node, sessionId) => {
      if (node.parentId === null) {
        roots.push(sessionId);
      }
    });
    return roots;
  }
}
