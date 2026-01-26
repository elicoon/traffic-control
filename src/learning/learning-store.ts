import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as yaml from 'js-yaml';
import type {
  ExtendedLearning,
  CreateExtendedLearningInput,
  LearningStoreOptions,
  LearningYamlFrontmatter,
  LearningStats,
  LearningCategory
} from './types.js';

/**
 * Markers for learning sections in markdown files
 */
const LEARNINGS_START = '<!-- LEARNINGS_START -->';
const LEARNINGS_END = '<!-- LEARNINGS_END -->';
const RECENT_LEARNINGS_START = '<!-- RECENT_LEARNINGS_START -->';
const RECENT_LEARNINGS_END = '<!-- RECENT_LEARNINGS_END -->';

/**
 * Default learning store options
 */
const DEFAULT_OPTIONS: LearningStoreOptions = {
  basePath: './learnings',
  agentsPath: './agents.md'
};

/**
 * Manages learning files stored as markdown with YAML frontmatter.
 * Handles reading, writing, and updating learning files.
 */
export class LearningStore {
  private options: LearningStoreOptions;

  constructor(options: Partial<LearningStoreOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Adds a new learning to the appropriate file.
   * Global learnings go to global.md, project-specific learnings
   * go to project-{projectId}.md
   */
  async addLearning(input: CreateExtendedLearningInput): Promise<ExtendedLearning> {
    const learning: ExtendedLearning = {
      id: `learning-${randomUUID().slice(0, 8)}`,
      category: input.category,
      subcategory: input.subcategory,
      pattern: input.pattern,
      trigger: input.trigger,
      rule: input.rule,
      appliesTo: input.appliesTo,
      sourceRetrospective: input.sourceRetrospective,
      projectId: input.projectId,
      createdAt: new Date(),
      metadata: input.metadata
    };

    // Determine which file to write to
    const filePath = input.projectId
      ? this.getProjectFilePath(input.projectId)
      : this.getGlobalFilePath();

    // Ensure directory exists
    await this.ensureDirectory(path.dirname(filePath));

    // Read existing content
    let content = await this.readFileOrDefault(
      filePath,
      input.projectId
        ? this.getProjectFileTemplate(input.projectId)
        : this.getGlobalFileTemplate()
    );

    // Add learning to content
    const yamlContent = this.formatLearningAsYaml(learning);
    content = this.insertLearning(content, yamlContent);

    // Write updated content
    await fs.writeFile(filePath, content, 'utf-8');

    // Update index
    await this.updateIndex();

    return learning;
  }

  /**
   * Gets all global learnings from global.md
   */
  async getGlobalLearnings(): Promise<ExtendedLearning[]> {
    const filePath = this.getGlobalFilePath();
    return this.getLearningsFromFile(filePath);
  }

  /**
   * Gets project-specific learnings from project-{projectId}.md
   */
  async getProjectLearnings(projectId: string): Promise<ExtendedLearning[]> {
    const filePath = this.getProjectFilePath(projectId);
    return this.getLearningsFromFile(filePath);
  }

  /**
   * Gets a specific learning by ID, searching all files
   */
  async getLearningById(id: string): Promise<ExtendedLearning | null> {
    // Search global learnings first
    const globalLearnings = await this.getGlobalLearnings();
    const globalMatch = globalLearnings.find(l => l.id === id);
    if (globalMatch) return globalMatch;

    // Search project files
    const projectFiles = await this.listProjectFiles();
    for (const filePath of projectFiles) {
      const learnings = await this.getLearningsFromFile(filePath);
      const match = learnings.find(l => l.id === id);
      if (match) return match;
    }

    return null;
  }

  /**
   * Checks if a similar learning already exists to avoid duplicates.
   * Similarity is determined by matching category, pattern, and rule.
   * Uses a threshold of 0.7 (70% word overlap) for rule similarity.
   */
  async hasSimilarLearning(learning: { category: LearningCategory; pattern: string; rule: string; projectId?: string }): Promise<boolean> {
    const learnings = learning.projectId
      ? await this.getProjectLearnings(learning.projectId)
      : await this.getGlobalLearnings();

    return learnings.some(existing =>
      existing.category === learning.category &&
      this.normalizeText(existing.pattern) === this.normalizeText(learning.pattern) &&
      this.calculateSimilarity(existing.rule, learning.rule) > 0.7
    );
  }

  /**
   * Lists all project-specific learning files
   */
  private async listProjectFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.options.basePath);
      return files
        .filter(f => f.startsWith('project-') && f.endsWith('.md'))
        .map(f => path.join(this.options.basePath, f));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Normalizes text for comparison (lowercase, trim, collapse whitespace)
   */
  private normalizeText(text: string): string {
    return text.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Calculates simple similarity between two strings (Jaccard similarity on words)
   */
  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(this.normalizeText(a).split(' '));
    const wordsB = new Set(this.normalizeText(b).split(' '));

    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  /**
   * Gets statistics about all learnings
   */
  async getStats(): Promise<LearningStats> {
    const globalLearnings = await this.getGlobalLearnings();

    // Initialize category counts
    const byCategory: Record<LearningCategory, number> = {
      testing: 0,
      architecture: 0,
      tooling: 0,
      communication: 0,
      'project-specific': 0
    };

    // Count by category
    for (const learning of globalLearnings) {
      byCategory[learning.category]++;
    }

    // TODO: Add project-specific learning counts
    const projectSpecific = 0;

    return {
      total: globalLearnings.length + projectSpecific,
      global: globalLearnings.length,
      projectSpecific,
      byCategory
    };
  }

  /**
   * Updates the index.md file with current statistics
   */
  async updateIndex(): Promise<void> {
    const indexPath = this.getIndexFilePath();
    const stats = await this.getStats();
    const globalLearnings = await this.getGlobalLearnings();

    // Sort by creation date, most recent first
    const recentLearnings = globalLearnings
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10);

    const content = this.generateIndexContent(stats, recentLearnings);
    await fs.writeFile(indexPath, content, 'utf-8');
  }

  /**
   * Formats a learning as YAML frontmatter block
   */
  formatLearningAsYaml(learning: ExtendedLearning): string {
    const frontmatter: LearningYamlFrontmatter = {
      id: learning.id,
      category: learning.category,
      subcategory: learning.subcategory,
      pattern: learning.pattern,
      trigger: learning.trigger,
      rule: learning.rule,
      source_retrospective: learning.sourceRetrospective,
      created_at: learning.createdAt.toISOString()
    };

    if (learning.appliesTo && learning.appliesTo.length > 0) {
      frontmatter.applies_to = learning.appliesTo;
    }

    if (learning.projectId) {
      frontmatter.project_id = learning.projectId;
    }

    if (learning.metadata && Object.keys(learning.metadata).length > 0) {
      frontmatter.metadata = learning.metadata;
    }

    return `---\n${yaml.dump(frontmatter, { lineWidth: -1 })}---\n`;
  }

  /**
   * Parses learnings from markdown file content
   */
  private parseLearningsFromContent(content: string): ExtendedLearning[] {
    const learnings: ExtendedLearning[] = [];

    // Find content between markers
    const startIdx = content.indexOf(LEARNINGS_START);
    const endIdx = content.indexOf(LEARNINGS_END);

    if (startIdx === -1 || endIdx === -1) {
      return learnings;
    }

    const learningsSection = content.slice(startIdx + LEARNINGS_START.length, endIdx);

    // Split by YAML document separator
    const yamlBlocks = learningsSection.split(/---\n/).filter(block => block.trim());

    for (const block of yamlBlocks) {
      try {
        const parsed = yaml.load(block.trim()) as LearningYamlFrontmatter | null;
        if (parsed && parsed.id) {
          learnings.push({
            id: parsed.id,
            category: parsed.category,
            subcategory: parsed.subcategory,
            pattern: parsed.pattern,
            trigger: parsed.trigger,
            rule: parsed.rule,
            appliesTo: parsed.applies_to,
            sourceRetrospective: parsed.source_retrospective,
            projectId: parsed.project_id,
            createdAt: new Date(parsed.created_at),
            metadata: parsed.metadata
          });
        }
      } catch {
        // Skip invalid YAML blocks
        continue;
      }
    }

    return learnings;
  }

  /**
   * Gets learnings from a specific file
   */
  private async getLearningsFromFile(filePath: string): Promise<ExtendedLearning[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.parseLearningsFromContent(content);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Inserts a learning into the content between markers
   */
  private insertLearning(content: string, yamlContent: string): string {
    const startIdx = content.indexOf(LEARNINGS_START);
    if (startIdx === -1) {
      return content;
    }

    const insertPoint = startIdx + LEARNINGS_START.length;
    return (
      content.slice(0, insertPoint) +
      '\n' +
      yamlContent +
      content.slice(insertPoint)
    );
  }

  /**
   * Ensures a directory exists
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  /**
   * Reads a file or returns default content if it doesn't exist
   */
  private async readFileOrDefault(filePath: string, defaultContent: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return defaultContent;
      }
      throw error;
    }
  }

  /**
   * Gets the path to global.md
   */
  private getGlobalFilePath(): string {
    return path.join(this.options.basePath, 'global.md');
  }

  /**
   * Gets the path to a project-specific file
   */
  private getProjectFilePath(projectId: string): string {
    return path.join(this.options.basePath, `project-${projectId}.md`);
  }

  /**
   * Gets the path to index.md
   */
  private getIndexFilePath(): string {
    return path.join(this.options.basePath, 'index.md');
  }

  /**
   * Gets template content for global.md
   */
  private getGlobalFileTemplate(): string {
    return `# Global Learnings

Cross-project patterns and rules extracted from retrospectives.

${LEARNINGS_START}
${LEARNINGS_END}
`;
  }

  /**
   * Gets template content for project-specific files
   */
  private getProjectFileTemplate(projectId: string): string {
    return `# Project Learnings: ${projectId}

Learnings specific to project ${projectId}.

${LEARNINGS_START}
${LEARNINGS_END}
`;
  }

  /**
   * Generates index.md content with stats and recent learnings
   */
  private generateIndexContent(stats: LearningStats, recentLearnings: ExtendedLearning[]): string {
    const recentSection = recentLearnings
      .map(l => `- **${l.pattern}** (${l.category}): ${l.rule}`)
      .join('\n');

    return `# Learnings Index

Index of all learnings tracked by TrafficControl.

## Statistics

- Total Learnings: ${stats.total}
- Global Learnings: ${stats.global}
- Project-Specific Learnings: ${stats.projectSpecific}

## Categories

### Testing
- Count: ${stats.byCategory.testing}

### Architecture
- Count: ${stats.byCategory.architecture}

### Tooling
- Count: ${stats.byCategory.tooling}

### Communication
- Count: ${stats.byCategory.communication}

### Project-Specific
- Count: ${stats.byCategory['project-specific']}

## Recent Learnings

${RECENT_LEARNINGS_START}
${recentSection || 'No learnings recorded yet.'}
${RECENT_LEARNINGS_END}
`;
  }
}
