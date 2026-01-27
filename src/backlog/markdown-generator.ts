/**
 * Markdown Generator for Backlog Items
 *
 * Generates human-readable markdown files from backlog items in the database.
 * Database is the single source of truth, markdown files are generated for git tracking and readability.
 */

import { BacklogItem } from '../db/repositories/backlog-items.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../logging/index.js';

const log = logger.child('BacklogMarkdownGenerator');

export interface MarkdownGeneratorOptions {
  outputDir: string;
}

export class BacklogMarkdownGenerator {
  private outputDir: string;

  constructor(options: MarkdownGeneratorOptions) {
    this.outputDir = options.outputDir;
  }

  /**
   * Generate markdown content for a backlog item
   */
  generate(item: BacklogItem): string {
    const sections: string[] = [];

    // Title and metadata header
    sections.push(`# Backlog Item: ${item.title}\n`);
    sections.push(`**Priority:** ${this.capitalize(item.priority)}`);
    sections.push(`**Type:** ${this.formatType(item.type)}`);
    sections.push(`**Status:** ${this.formatStatus(item.status)}`);
    sections.push(`**Created:** ${this.formatDate(item.created_at)}`);

    if (item.updated_at !== item.created_at) {
      sections.push(`**Updated:** ${this.formatDate(item.updated_at)}`);
    }

    sections.push('\n---\n');

    // Description
    sections.push('## Description\n');
    sections.push(`${item.description}\n`);

    // Classification
    if (item.impact_score || item.complexity_estimate) {
      sections.push('## Classification\n');
      if (item.impact_score) {
        sections.push(`**Impact:** ${this.capitalize(item.impact_score)}`);
      }
      if (item.complexity_estimate) {
        sections.push(`**Complexity:** ${this.capitalize(item.complexity_estimate)}`);
      }
      sections.push('');
    }

    // Estimates
    if (item.estimated_sessions_opus > 0 || item.estimated_sessions_sonnet > 0) {
      sections.push('## Effort Estimates\n');
      if (item.estimated_sessions_opus > 0) {
        sections.push(`- **Opus Sessions:** ${item.estimated_sessions_opus}`);
      }
      if (item.estimated_sessions_sonnet > 0) {
        sections.push(`- **Sonnet Sessions:** ${item.estimated_sessions_sonnet}`);
      }
      sections.push('');
    }

    // Reasoning
    if (item.reasoning) {
      sections.push('## Reasoning\n');
      sections.push(`${item.reasoning}\n`);
    }

    // Acceptance Criteria
    if (item.acceptance_criteria) {
      sections.push('## Acceptance Criteria\n');
      sections.push(`${item.acceptance_criteria}\n`);
    }

    // Tags
    if (item.tags && item.tags.length > 0) {
      sections.push('## Tags\n');
      sections.push(item.tags.map(tag => `\`${tag}\``).join(', ') + '\n');
    }

    // Related Items
    if (item.related_items && item.related_items.length > 0) {
      sections.push('## Related Items\n');
      item.related_items.forEach(relatedId => {
        sections.push(`- ${relatedId}`);
      });
      sections.push('');
    }

    // Work Items
    if ((item.proposal_ids && item.proposal_ids.length > 0) ||
        (item.task_ids && item.task_ids.length > 0)) {
      sections.push('## Generated Work Items\n');

      if (item.proposal_ids && item.proposal_ids.length > 0) {
        sections.push(`**Proposals:** ${item.proposal_ids.length}`);
        item.proposal_ids.forEach(proposalId => {
          sections.push(`- ${proposalId}`);
        });
      }

      if (item.task_ids && item.task_ids.length > 0) {
        sections.push(`**Tasks:** ${item.task_ids.length}`);
        item.task_ids.forEach(taskId => {
          sections.push(`- ${taskId}`);
        });
      }
      sections.push('');
    }

    // Metadata footer
    sections.push('---\n');
    sections.push('## Metadata\n');
    sections.push(`- **ID:** \`${item.id}\``);
    sections.push(`- **Source:** ${item.source}`);
    if (item.source_file) {
      sections.push(`- **Original File:** ${item.source_file}`);
    }
    if (item.project_id) {
      sections.push(`- **Project ID:** \`${item.project_id}\``);
    }
    sections.push('');
    sections.push('*This file is auto-generated from the database. Do not edit directly.*');
    sections.push('*Use `trafficcontrol backlog update` to modify this item.*');

    return sections.join('\n');
  }

  /**
   * Generate filename for a backlog item
   */
  generateFilename(item: BacklogItem): string {
    // Use kebab-case of title with ID suffix for uniqueness
    const slug = this.slugify(item.title);
    return `${slug}-${item.id.substring(0, 8)}.md`;
  }

  /**
   * Generate file object with filename and content
   */
  generateFile(item: BacklogItem): { filename: string; content: string } {
    return {
      filename: this.generateFilename(item),
      content: this.generate(item),
    };
  }

  /**
   * Write a single backlog item to disk
   */
  async writeItem(item: BacklogItem): Promise<string> {
    const { filename, content } = this.generateFile(item);
    const filepath = path.join(this.outputDir, filename);

    await fs.mkdir(this.outputDir, { recursive: true });
    await fs.writeFile(filepath, content, 'utf-8');

    log.debug('Backlog item written to file', { itemId: item.id, filepath });
    return filepath;
  }

  /**
   * Sync all backlog items to markdown files
   */
  async syncAll(items: BacklogItem[]): Promise<{ written: number; errors: string[] }> {
    log.info('Starting backlog sync', { itemCount: items.length, outputDir: this.outputDir });

    const errors: string[] = [];
    let written = 0;

    // Ensure output directory exists
    await fs.mkdir(this.outputDir, { recursive: true });

    // Get existing markdown files
    const existingFiles = await this.getExistingMarkdownFiles();
    const generatedFiles = new Set<string>();

    // Write all items
    for (const item of items) {
      try {
        const filepath = await this.writeItem(item);
        generatedFiles.add(path.basename(filepath));
        written++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        log.error('Failed to write backlog item', { itemId: item.id, error: errorMsg });
        errors.push(`${item.id}: ${errorMsg}`);
      }
    }

    // Archive orphaned files (files that don't match any current item)
    const orphanedFiles = existingFiles.filter(file => !generatedFiles.has(file));
    if (orphanedFiles.length > 0) {
      await this.archiveOrphanedFiles(orphanedFiles);
      log.info('Archived orphaned markdown files', { count: orphanedFiles.length });
    }

    log.info('Backlog sync complete', { written, errors: errors.length, archived: orphanedFiles.length });

    return { written, errors };
  }

  /**
   * Get list of existing markdown files in output directory
   */
  private async getExistingMarkdownFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.outputDir, { withFileTypes: true });
      return entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => entry.name);
    } catch (error) {
      // Directory might not exist yet
      return [];
    }
  }

  /**
   * Archive orphaned markdown files
   */
  private async archiveOrphanedFiles(files: string[]): Promise<void> {
    const archiveDir = path.join(this.outputDir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });

    for (const file of files) {
      const sourcePath = path.join(this.outputDir, file);
      const targetPath = path.join(archiveDir, file);
      try {
        await fs.rename(sourcePath, targetPath);
        log.debug('Archived orphaned file', { file, targetPath });
      } catch (error) {
        log.error('Failed to archive file', { file, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  }

  /**
   * Helper: Capitalize first letter
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Helper: Format type for display
   */
  private formatType(type: string): string {
    return type
      .split('_')
      .map(word => this.capitalize(word))
      .join(' ');
  }

  /**
   * Helper: Format status for display
   */
  private formatStatus(status: string): string {
    return status
      .split('_')
      .map(word => this.capitalize(word))
      .join(' ');
  }

  /**
   * Helper: Format date for display
   */
  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  /**
   * Helper: Convert string to kebab-case slug
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50); // Limit length
  }
}
