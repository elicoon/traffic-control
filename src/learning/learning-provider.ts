import * as fs from 'node:fs/promises';
import { LearningStore } from './learning-store.js';
import type {
  ExtendedLearning,
  LearningContext,
  LearningStoreOptions
} from './types.js';

/**
 * Default options for the learning provider
 */
const DEFAULT_OPTIONS: LearningStoreOptions = {
  basePath: './learnings',
  agentsPath: './agents.md'
};

/**
 * Extended options that allows injecting a store for testing
 */
export interface LearningProviderOptions extends LearningStoreOptions {
  store?: LearningStore;
}

/**
 * Provides learning context to agent sessions.
 * Aggregates learnings from the store and formats them for agent consumption.
 */
export class LearningProvider {
  private store: LearningStore;
  private options: LearningStoreOptions;

  constructor(options: Partial<LearningProviderOptions> = {}) {
    const { store, ...storeOptions } = options;
    this.options = { ...DEFAULT_OPTIONS, ...storeOptions };
    this.store = store ?? new LearningStore(this.options);
  }

  /**
   * Gets the full learning context for a session.
   * Includes global learnings, project-specific learnings, and agent guidelines.
   */
  async getContextForSession(projectId?: string): Promise<LearningContext> {
    // Get global learnings
    const globalLearnings = await this.store.getGlobalLearnings();

    // Get project-specific learnings if projectId provided
    const projectLearnings = projectId
      ? await this.store.getProjectLearnings(projectId)
      : [];

    // Get agent guidelines
    const agentGuidelines = await this.getAgentGuidelines();

    return {
      globalLearnings,
      projectLearnings,
      agentGuidelines
    };
  }

  /**
   * Formats the learning context as a system prompt for the agent.
   */
  formatAsSystemPrompt(context: LearningContext): string {
    const parts: string[] = [];

    // Header
    parts.push('='.repeat(60));
    parts.push('LEARNINGS FROM PREVIOUS SESSIONS');
    parts.push('='.repeat(60));
    parts.push('');

    // Global learnings section
    parts.push('## Global Learnings');
    parts.push('');
    if (context.globalLearnings.length === 0) {
      parts.push('No global learnings recorded yet.');
    } else {
      for (const learning of context.globalLearnings) {
        parts.push(this.formatLearningForPrompt(learning));
        parts.push('');
      }
    }
    parts.push('');

    // Project-specific learnings section
    parts.push('## Project-Specific Learnings');
    parts.push('');
    if (context.projectLearnings.length === 0) {
      parts.push('No project-specific learnings recorded yet.');
    } else {
      for (const learning of context.projectLearnings) {
        parts.push(this.formatLearningForPrompt(learning));
        parts.push('');
      }
    }
    parts.push('');

    // Agent guidelines section
    parts.push('='.repeat(60));
    parts.push('AGENT GUIDELINES');
    parts.push('='.repeat(60));
    parts.push('');
    parts.push(context.agentGuidelines);

    return parts.join('\n');
  }

  /**
   * Formats a single learning for inclusion in a prompt.
   */
  formatLearningForPrompt(learning: ExtendedLearning): string {
    const lines: string[] = [];

    lines.push(`- **Pattern: ${learning.pattern}**`);
    lines.push(`  When: ${learning.trigger}`);
    lines.push(`  Rule: ${learning.rule}`);

    if (learning.appliesTo && learning.appliesTo.length > 0) {
      lines.push(`  Applies to: ${learning.appliesTo.join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Gets learnings relevant to specific technologies.
   * Returns learnings that either match the technologies or have no technology filter.
   */
  async getRelevantLearnings(
    projectId: string | undefined,
    technologies: string[]
  ): Promise<ExtendedLearning[]> {
    const context = await this.getContextForSession(projectId);
    const allLearnings = [...context.globalLearnings, ...context.projectLearnings];

    // If no technologies specified, return all learnings
    if (technologies.length === 0) {
      return allLearnings;
    }

    // Filter to learnings that match technologies or have no filter
    return allLearnings.filter(learning => {
      if (!learning.appliesTo || learning.appliesTo.length === 0) {
        return true; // No filter, always relevant
      }

      // Check if any technology matches
      return technologies.some(tech =>
        learning.appliesTo!.some(
          apply => apply.toLowerCase() === tech.toLowerCase()
        )
      );
    });
  }

  /**
   * Gets a summary of learnings for logging purposes.
   */
  async getLearningsSummary(projectId?: string): Promise<string> {
    const context = await this.getContextForSession(projectId);
    const stats = await this.store.getStats();

    return [
      `Learnings loaded: Global: ${context.globalLearnings.length}, Project: ${context.projectLearnings.length}`,
      `Categories: testing(${stats.byCategory.testing}), architecture(${stats.byCategory.architecture}), ` +
        `tooling(${stats.byCategory.tooling}), communication(${stats.byCategory.communication}), ` +
        `project-specific(${stats.byCategory['project-specific']})`
    ].join('\n');
  }

  /**
   * Gets the agent guidelines from agents.md
   */
  private async getAgentGuidelines(): Promise<string> {
    try {
      return await fs.readFile(this.options.agentsPath, 'utf-8');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return 'No agent guidelines file found.';
      }
      throw error;
    }
  }

  /**
   * Gets the learning store instance.
   * Useful for direct access to store methods.
   */
  getStore(): LearningStore {
    return this.store;
  }
}
