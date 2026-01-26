import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProposalRepository } from './proposals.js';
import { ProjectRepository } from './projects.js';
import { createSupabaseClient } from '../client.js';

describe('ProposalRepository', () => {
  let proposalRepo: ProposalRepository;
  let projectRepo: ProjectRepository;
  let testProjectId: string;
  let testProposalId: string;

  beforeAll(async () => {
    const client = createSupabaseClient();
    proposalRepo = new ProposalRepository(client);
    projectRepo = new ProjectRepository(client);

    const project = await projectRepo.create({ name: 'Proposal Test Project' });
    testProjectId = project.id;
  });

  afterAll(async () => {
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  it('should create a proposal', async () => {
    const proposal = await proposalRepo.create({
      project_id: testProjectId,
      title: 'Add user authentication',
      description: 'Implement JWT-based authentication system',
      impact_score: 'high',
      estimated_sessions_opus: 2,
      estimated_sessions_sonnet: 3,
      reasoning: 'Critical security feature needed for production'
    });

    testProposalId = proposal.id;
    expect(proposal.title).toBe('Add user authentication');
    expect(proposal.status).toBe('proposed');
    expect(proposal.project_id).toBe(testProjectId);
    expect(proposal.impact_score).toBe('high');
  });

  it('should get a proposal by id', async () => {
    const proposal = await proposalRepo.getById(testProposalId);
    expect(proposal).toBeDefined();
    expect(proposal?.title).toBe('Add user authentication');
  });

  it('should get pending proposals', async () => {
    const proposals = await proposalRepo.getPending();
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.some(p => p.id === testProposalId)).toBe(true);
  });

  it('should get proposals by project', async () => {
    const proposals = await proposalRepo.getByProject(testProjectId);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].project_id).toBe(testProjectId);
  });

  it('should approve a proposal', async () => {
    const proposal = await proposalRepo.approve(testProposalId);
    expect(proposal.status).toBe('approved');
    expect(proposal.resolved_at).toBeDefined();
  });

  it('should create another proposal for rejection test', async () => {
    const proposal = await proposalRepo.create({
      project_id: testProjectId,
      title: 'Add dark mode',
      description: 'Implement dark mode theme',
      impact_score: 'low',
      estimated_sessions_sonnet: 1,
      reasoning: 'Nice to have feature'
    });

    const rejected = await proposalRepo.reject(proposal.id, 'Not a priority right now');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejection_reason).toBe('Not a priority right now');
    expect(rejected.resolved_at).toBeDefined();
  });

  it('should get proposals by status', async () => {
    const approved = await proposalRepo.getByStatus('approved');
    expect(approved.length).toBeGreaterThan(0);
    expect(approved.every(p => p.status === 'approved')).toBe(true);
  });

  it('should delete a proposal', async () => {
    const proposal = await proposalRepo.create({
      project_id: testProjectId,
      title: 'Temporary proposal',
      impact_score: 'low'
    });

    await proposalRepo.delete(proposal.id);
    const deleted = await proposalRepo.getById(proposal.id);
    expect(deleted).toBeNull();
  });
});
