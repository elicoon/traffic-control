import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProposalGenerator, GeneratedProposal } from './proposal-generator.js';
import { ProjectRepository, Project } from '../db/repositories/projects.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { ProposalRepository } from '../db/repositories/proposals.js';
import { createSupabaseClient } from '../db/client.js';

describe('ProposalGenerator', () => {
  let generator: ProposalGenerator;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let proposalRepo: ProposalRepository;
  let testProject: Project;
  let createdProposalIds: string[] = [];

  beforeAll(async () => {
    const client = createSupabaseClient();
    projectRepo = new ProjectRepository(client);
    taskRepo = new TaskRepository(client);
    proposalRepo = new ProposalRepository(client);
    generator = new ProposalGenerator(projectRepo, taskRepo, proposalRepo);

    testProject = await projectRepo.create({
      name: 'Generator Test Project',
      description: 'A project for testing proposal generation'
    });
  });

  afterAll(async () => {
    // Clean up created proposals
    for (const id of createdProposalIds) {
      try {
        await proposalRepo.delete(id);
      } catch {
        // Ignore cleanup errors
      }
    }
    if (testProject?.id) {
      await projectRepo.delete(testProject.id);
    }
  });

  describe('generateProposals', () => {
    it('should generate proposals for a project', async () => {
      const proposals = await generator.generateProposals(testProject, 3);

      expect(proposals).toBeDefined();
      expect(Array.isArray(proposals)).toBe(true);
      expect(proposals.length).toBe(3);
    });

    it('should generate proposals with required fields', async () => {
      const proposals = await generator.generateProposals(testProject, 1);
      const proposal = proposals[0];

      expect(proposal.title).toBeDefined();
      expect(proposal.title.length).toBeGreaterThan(0);
      expect(proposal.description).toBeDefined();
      expect(proposal.impact_score).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(proposal.impact_score);
      expect(proposal.reasoning).toBeDefined();
    });

    it('should include session estimates', async () => {
      const proposals = await generator.generateProposals(testProject, 1);
      const proposal = proposals[0];

      expect(typeof proposal.estimated_sessions_opus).toBe('number');
      expect(typeof proposal.estimated_sessions_sonnet).toBe('number');
      expect(proposal.estimated_sessions_opus + proposal.estimated_sessions_sonnet).toBeGreaterThan(0);
    });
  });

  describe('generateAndSaveProposals', () => {
    it('should save generated proposals to database', async () => {
      const proposals = await generator.generateAndSaveProposals(testProject, 2);

      expect(proposals.length).toBe(2);
      createdProposalIds.push(...proposals.map(p => p.id));

      // Verify proposals are in database
      for (const proposal of proposals) {
        const saved = await proposalRepo.getById(proposal.id);
        expect(saved).toBeDefined();
        expect(saved?.status).toBe('proposed');
      }
    });

    it('should associate proposals with the project', async () => {
      const proposals = await generator.generateAndSaveProposals(testProject, 1);
      createdProposalIds.push(...proposals.map(p => p.id));

      expect(proposals[0].project_id).toBe(testProject.id);
    });
  });

  describe('generateForAllProjects', () => {
    it('should generate proposals for multiple projects', async () => {
      // Create another test project
      const project2 = await projectRepo.create({ name: 'Generator Test Project 2' });

      try {
        const results = await generator.generateForAllProjects([testProject, project2], 2);

        expect(results.size).toBe(2);
        expect(results.has(testProject.id)).toBe(true);
        expect(results.has(project2.id)).toBe(true);

        // Track created proposals for cleanup
        for (const proposals of results.values()) {
          createdProposalIds.push(...proposals.map(p => p.id));
        }
      } finally {
        await projectRepo.delete(project2.id);
      }
    });
  });

  describe('getTemplateProposals', () => {
    it('should return template proposals based on project type', () => {
      const templates = generator.getTemplateProposals('web-app');

      expect(templates).toBeDefined();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should return generic templates for unknown project type', () => {
      const templates = generator.getTemplateProposals('unknown-type');

      expect(templates).toBeDefined();
      expect(templates.length).toBeGreaterThan(0);
    });
  });
});
