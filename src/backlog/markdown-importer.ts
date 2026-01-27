/**
 * Markdown Importer for Backlog Items
 *
 * Parses existing markdown files and imports them into the database as backlog items.
 * This is a one-time migration tool.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { BacklogItemRepository, CreateBacklogItemInput, BacklogItemType } from '../db/repositories/backlog-items.js';
import { logger } from '../logging/index.js';

const log = logger.child('BacklogMarkdownImporter');

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ file: string; error: string }>;
}

export interface MarkdownImporterOptions {
  inputDir: string;
  repository: BacklogItemRepository;
  defaultProjectId?: string;
}

/**
 * Parsed frontmatter and content from a markdown file
 */
interface ParsedMarkdown {
  metadata: Record<string, string>;
  content: string;
  sections: Record<string, string>;
}

export class BacklogMarkdownImporter {
  constructor(private options: MarkdownImporterOptions) {}

  /**
   * Import all markdown files from the input directory
   */
  async importAll(): Promise<ImportResult> {
    log.info('Starting markdown import', { inputDir: this.options.inputDir });

    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      errors: [],
    };

    try {
      const files = await this.getMarkdownFiles();
      log.info(`Found ${files.length} markdown files to import`);

      for (const file of files) {
        try {
          const imported = await this.importFile(file);
          if (imported) {
            result.imported++;
          } else {
            result.skipped++;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          log.error('Failed to import file', { file, error: errorMsg });
          result.errors.push({ file, error: errorMsg });
        }
      }

      log.info('Import complete', { ...result });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to read input directory', { inputDir: this.options.inputDir, error: errorMsg });
      throw new Error(`Failed to read input directory: ${errorMsg}`);
    }

    return result;
  }

  /**
   * Import a single markdown file
   */
  async importFile(filename: string): Promise<boolean> {
    const filepath = path.join(this.options.inputDir, filename);
    log.debug('Importing file', { filepath });

    // Read and parse markdown
    const content = await fs.readFile(filepath, 'utf-8');
    const parsed = this.parseMarkdown(content);

    // Check if already imported
    const existingItem = await this.options.repository.getBySourceFile(filename);
    if (existingItem) {
      log.debug('File already imported, skipping', { file: filename, itemId: existingItem.id });
      return false;
    }

    // Extract metadata and create backlog item
    const input = this.extractBacklogItemInput(parsed, filename);

    // Create in database
    const item = await this.options.repository.create(input);
    log.info('Imported backlog item', { file: filename, itemId: item.id, title: item.title });

    return true;
  }

  /**
   * Get list of markdown files in input directory
   */
  private async getMarkdownFiles(): Promise<string[]> {
    const entries = await fs.readdir(this.options.inputDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name);
  }

  /**
   * Parse markdown file into metadata and content sections
   */
  private parseMarkdown(content: string): ParsedMarkdown {
    const lines = content.split('\n');
    const metadata: Record<string, string> = {};
    const sections: Record<string, string> = {};

    let currentSection: string | null = null;
    let currentContent: string[] = [];

    // Extract title from first line if it's an H1
    if (lines[0]?.startsWith('# ')) {
      metadata.title = lines[0].substring(2).replace(/^Backlog Item:\s*/i, '').trim();
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Parse metadata lines (bold key: value)
      const metadataMatch = line.match(/^\*\*([^:]+):\*\*\s*(.+)$/);
      if (metadataMatch) {
        const key = metadataMatch[1].toLowerCase().replace(/\s+/g, '_');
        const value = metadataMatch[2].trim();
        metadata[key] = value;
        continue;
      }

      // Parse section headers
      const sectionMatch = line.match(/^##\s+(.+)$/);
      if (sectionMatch) {
        // Save previous section
        if (currentSection) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = sectionMatch[1].toLowerCase().replace(/\s+/g, '_');
        currentContent = [];
        continue;
      }

      // Accumulate content for current section
      if (currentSection) {
        currentContent.push(line);
      }
    }

    // Save final section
    if (currentSection) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    return {
      metadata,
      content: content,
      sections,
    };
  }

  /**
   * Extract CreateBacklogItemInput from parsed markdown
   */
  private extractBacklogItemInput(
    parsed: ParsedMarkdown,
    sourceFile: string
  ): CreateBacklogItemInput {
    const { metadata, sections } = parsed;

    // Extract title (required)
    const title = metadata.title || 'Untitled Backlog Item';

    // Extract description (use problem_statement or description section)
    const description =
      sections.description ||
      sections.problem_statement ||
      sections.summary ||
      'No description provided';

    // Extract type
    const type = this.parseType(metadata.type);

    // Extract priority
    const priority = this.parsePriority(metadata.priority);

    // Extract impact score
    const impact_score = this.parseImpactScore(metadata.impact_score);

    // Extract complexity
    const complexity_estimate = this.parseComplexity(metadata.complexity);

    // Extract estimates
    const estimated_sessions_opus = this.parseNumber(metadata.estimated_sessions_opus, 0);
    const estimated_sessions_sonnet = this.parseNumber(metadata.estimated_sessions_sonnet, 0);

    // Extract reasoning
    const reasoning = sections.reasoning || sections.proposed_solution || undefined;

    // Extract acceptance criteria
    const acceptance_criteria = sections.acceptance_criteria || sections.success_criteria || undefined;

    // Extract tags from metadata or tags section
    const tags = this.parseTags(metadata.tags || sections.tags);

    return {
      title,
      description,
      type,
      priority,
      impact_score,
      complexity_estimate,
      estimated_sessions_opus,
      estimated_sessions_sonnet,
      reasoning,
      acceptance_criteria,
      tags,
      project_id: this.options.defaultProjectId,
      source: 'imported',
      source_file: sourceFile,
    };
  }

  /**
   * Parse type from string
   */
  private parseType(typeStr: string | undefined): BacklogItemType {
    if (!typeStr) return 'feature';

    const normalized = typeStr.toLowerCase().replace(/\s+/g, '_');

    // Map common variations
    const typeMap: Record<string, BacklogItemType> = {
      feature: 'feature',
      enhancement: 'enhancement',
      architecture: 'architecture',
      'architecture_improvement': 'architecture',
      infrastructure: 'infrastructure',
      documentation: 'documentation',
      docs: 'documentation',
      security: 'security',
      testing: 'testing',
      test: 'testing',
      maintenance: 'maintenance',
      research: 'research',
      'new_feature': 'feature',
    };

    return typeMap[normalized] || 'feature';
  }

  /**
   * Parse priority from string
   */
  private parsePriority(priorityStr: string | undefined): 'high' | 'medium' | 'low' {
    if (!priorityStr) return 'medium';

    const normalized = priorityStr.toLowerCase();
    if (normalized.includes('high')) return 'high';
    if (normalized.includes('low')) return 'low';
    return 'medium';
  }

  /**
   * Parse impact score from string
   */
  private parseImpactScore(impactStr: string | undefined): 'high' | 'medium' | 'low' | undefined {
    if (!impactStr) return undefined;

    const normalized = impactStr.toLowerCase();
    if (normalized.includes('high')) return 'high';
    if (normalized.includes('low')) return 'low';
    if (normalized.includes('medium')) return 'medium';
    return undefined;
  }

  /**
   * Parse complexity from string
   */
  private parseComplexity(
    complexityStr: string | undefined
  ): 'small' | 'medium' | 'large' | 'x-large' | undefined {
    if (!complexityStr) return undefined;

    const normalized = complexityStr.toLowerCase();
    if (normalized.includes('small')) return 'small';
    if (normalized.includes('medium')) return 'medium';
    if (normalized.includes('large') && !normalized.includes('x-')) return 'large';
    if (normalized.includes('x-large') || normalized.includes('xlarge')) return 'x-large';
    return undefined;
  }

  /**
   * Parse number from string
   */
  private parseNumber(numStr: string | undefined, defaultValue: number): number {
    if (!numStr) return defaultValue;
    const parsed = parseInt(numStr, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Parse tags from string or section content
   */
  private parseTags(tagsStr: string | undefined): string[] {
    if (!tagsStr) return [];

    // Remove markdown code ticks and split by comma or whitespace
    const cleaned = tagsStr.replace(/`/g, '').trim();
    const tags = cleaned
      .split(/[,\s]+/)
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);

    return tags;
  }
}
