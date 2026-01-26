import { ProjectRepository, Project } from '../db/repositories/projects.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { ProposalRepository, Proposal, CreateProposalInput } from '../db/repositories/proposals.js';

export interface GeneratedProposal {
  title: string;
  description: string;
  impact_score: 'high' | 'medium' | 'low';
  estimated_sessions_opus: number;
  estimated_sessions_sonnet: number;
  reasoning: string;
}

interface ProposalTemplate {
  title: string;
  description: string;
  impact_score: 'high' | 'medium' | 'low';
  estimated_sessions_opus: number;
  estimated_sessions_sonnet: number;
  reasoning: string;
  category: string;
}

/**
 * Generates task proposals based on project context.
 * Currently uses template-based generation; can be extended with AI in the future.
 */
export class ProposalGenerator {
  private templates: ProposalTemplate[] = [
    // Infrastructure tasks
    {
      title: 'Add comprehensive error handling',
      description: 'Implement global error handling with proper logging and user-friendly error messages',
      impact_score: 'high',
      estimated_sessions_opus: 1,
      estimated_sessions_sonnet: 2,
      reasoning: 'Improves reliability and debugging experience',
      category: 'infrastructure'
    },
    {
      title: 'Set up automated testing pipeline',
      description: 'Configure CI/CD with automated unit and integration tests',
      impact_score: 'high',
      estimated_sessions_opus: 2,
      estimated_sessions_sonnet: 3,
      reasoning: 'Ensures code quality and prevents regressions',
      category: 'infrastructure'
    },
    {
      title: 'Add performance monitoring',
      description: 'Integrate performance monitoring tools to track response times and bottlenecks',
      impact_score: 'medium',
      estimated_sessions_opus: 1,
      estimated_sessions_sonnet: 2,
      reasoning: 'Enables proactive performance optimization',
      category: 'infrastructure'
    },
    // Documentation tasks
    {
      title: 'Create API documentation',
      description: 'Document all API endpoints with examples and expected responses',
      impact_score: 'medium',
      estimated_sessions_opus: 0,
      estimated_sessions_sonnet: 2,
      reasoning: 'Improves developer experience and reduces support burden',
      category: 'documentation'
    },
    {
      title: 'Add inline code documentation',
      description: 'Add JSDoc/TSDoc comments to all public functions and classes',
      impact_score: 'low',
      estimated_sessions_opus: 0,
      estimated_sessions_sonnet: 1,
      reasoning: 'Makes codebase more maintainable for future developers',
      category: 'documentation'
    },
    // Security tasks
    {
      title: 'Implement rate limiting',
      description: 'Add rate limiting to prevent API abuse and DDoS attacks',
      impact_score: 'high',
      estimated_sessions_opus: 1,
      estimated_sessions_sonnet: 1,
      reasoning: 'Critical for production security',
      category: 'security'
    },
    {
      title: 'Add input validation',
      description: 'Implement comprehensive input validation on all endpoints',
      impact_score: 'high',
      estimated_sessions_opus: 1,
      estimated_sessions_sonnet: 2,
      reasoning: 'Prevents injection attacks and data corruption',
      category: 'security'
    },
    // Feature tasks
    {
      title: 'Add user notifications',
      description: 'Implement a notification system for important events and updates',
      impact_score: 'medium',
      estimated_sessions_opus: 2,
      estimated_sessions_sonnet: 3,
      reasoning: 'Improves user engagement and communication',
      category: 'feature'
    },
    {
      title: 'Implement caching layer',
      description: 'Add caching for frequently accessed data to improve performance',
      impact_score: 'medium',
      estimated_sessions_opus: 1,
      estimated_sessions_sonnet: 2,
      reasoning: 'Reduces database load and improves response times',
      category: 'feature'
    },
    {
      title: 'Add search functionality',
      description: 'Implement full-text search across relevant data',
      impact_score: 'medium',
      estimated_sessions_opus: 1,
      estimated_sessions_sonnet: 2,
      reasoning: 'Improves user experience for finding content',
      category: 'feature'
    },
    // Testing tasks
    {
      title: 'Add unit tests for core modules',
      description: 'Write comprehensive unit tests for critical business logic',
      impact_score: 'high',
      estimated_sessions_opus: 1,
      estimated_sessions_sonnet: 3,
      reasoning: 'Ensures reliability and enables confident refactoring',
      category: 'testing'
    },
    {
      title: 'Create integration tests',
      description: 'Add integration tests for API endpoints and database operations',
      impact_score: 'high',
      estimated_sessions_opus: 1,
      estimated_sessions_sonnet: 2,
      reasoning: 'Catches issues that unit tests might miss',
      category: 'testing'
    },
    // Maintenance tasks
    {
      title: 'Refactor legacy code',
      description: 'Clean up and modernize older code sections for better maintainability',
      impact_score: 'low',
      estimated_sessions_opus: 0,
      estimated_sessions_sonnet: 2,
      reasoning: 'Reduces technical debt and improves code quality',
      category: 'maintenance'
    },
    {
      title: 'Update dependencies',
      description: 'Update outdated dependencies and address security vulnerabilities',
      impact_score: 'medium',
      estimated_sessions_opus: 0,
      estimated_sessions_sonnet: 1,
      reasoning: 'Keeps project secure and uses latest features',
      category: 'maintenance'
    },
    {
      title: 'Optimize database queries',
      description: 'Review and optimize slow database queries',
      impact_score: 'medium',
      estimated_sessions_opus: 1,
      estimated_sessions_sonnet: 1,
      reasoning: 'Improves application performance',
      category: 'maintenance'
    }
  ];

  constructor(
    private projectRepo: ProjectRepository,
    private taskRepo: TaskRepository,
    private proposalRepo: ProposalRepository
  ) {}

  /**
   * Generate proposals for a project based on its context.
   * Currently uses templates; can be extended with AI generation.
   */
  async generateProposals(project: Project, count: number = 3): Promise<GeneratedProposal[]> {
    // Get existing tasks to avoid duplicates
    const existingTasks = await this.taskRepo.getByProject(project.id);
    const existingTitles = new Set(existingTasks.map(t => t.title.toLowerCase()));

    // Get existing proposals to avoid duplicates
    const existingProposals = await this.proposalRepo.getByProject(project.id);
    const existingProposalTitles = new Set(existingProposals.map(p => p.title.toLowerCase()));

    // Filter out templates that match existing tasks or proposals
    const availableTemplates = this.templates.filter(t =>
      !existingTitles.has(t.title.toLowerCase()) &&
      !existingProposalTitles.has(t.title.toLowerCase())
    );

    // Shuffle and select templates
    const shuffled = this.shuffleArray([...availableTemplates]);
    const selected = shuffled.slice(0, count);

    // Customize templates for the project
    return selected.map(template => this.customizeTemplate(template, project));
  }

  /**
   * Generate proposals and save them to the database.
   */
  async generateAndSaveProposals(project: Project, count: number = 3): Promise<Proposal[]> {
    const generated = await this.generateProposals(project, count);
    const saved: Proposal[] = [];

    for (const proposal of generated) {
      const input: CreateProposalInput = {
        project_id: project.id,
        title: proposal.title,
        description: proposal.description,
        impact_score: proposal.impact_score,
        estimated_sessions_opus: proposal.estimated_sessions_opus,
        estimated_sessions_sonnet: proposal.estimated_sessions_sonnet,
        reasoning: proposal.reasoning
      };

      const savedProposal = await this.proposalRepo.create(input);
      saved.push(savedProposal);
    }

    return saved;
  }

  /**
   * Generate proposals for multiple projects.
   */
  async generateForAllProjects(
    projects: Project[],
    countPerProject: number = 3
  ): Promise<Map<string, Proposal[]>> {
    const results = new Map<string, Proposal[]>();

    for (const project of projects) {
      const proposals = await this.generateAndSaveProposals(project, countPerProject);
      results.set(project.id, proposals);
    }

    return results;
  }

  /**
   * Get template proposals for a specific project type.
   */
  getTemplateProposals(projectType: string): GeneratedProposal[] {
    // Map project types to relevant categories
    const categoryMap: Record<string, string[]> = {
      'web-app': ['infrastructure', 'security', 'feature', 'testing'],
      'api': ['infrastructure', 'security', 'documentation', 'testing'],
      'cli': ['infrastructure', 'documentation', 'testing'],
      'library': ['documentation', 'testing', 'maintenance']
    };

    const categories = categoryMap[projectType] || ['infrastructure', 'feature', 'testing'];

    return this.templates
      .filter(t => categories.includes(t.category))
      .map(t => ({
        title: t.title,
        description: t.description,
        impact_score: t.impact_score,
        estimated_sessions_opus: t.estimated_sessions_opus,
        estimated_sessions_sonnet: t.estimated_sessions_sonnet,
        reasoning: t.reasoning
      }));
  }

  /**
   * Customize a template for a specific project.
   */
  private customizeTemplate(template: ProposalTemplate, project: Project): GeneratedProposal {
    // Simple customization - can be made more sophisticated
    let description = template.description;

    if (project.description) {
      description = `${template.description}. Context: ${project.description}`;
    }

    return {
      title: template.title,
      description,
      impact_score: template.impact_score,
      estimated_sessions_opus: template.estimated_sessions_opus,
      estimated_sessions_sonnet: template.estimated_sessions_sonnet,
      reasoning: template.reasoning
    };
  }

  /**
   * Fisher-Yates shuffle algorithm.
   */
  private shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}
