import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ProposalRepository } from './proposals.js';
import { ProjectRepository } from './projects.js';
import { createSupabaseClient } from '../client.js';
import { SupabaseClient } from '@supabase/supabase-js';

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

describe('ProposalRepository unit error paths', () => {
  function createChain(result: { data: unknown; error: { message: string } | null }): any {
    const obj: any = {
      select: () => createChain(result),
      insert: () => createChain(result),
      delete: () => createChain(result),
      update: () => createChain(result),
      eq: () => createChain(result),
      order: () => createChain(result),
      single: () => Promise.resolve(result),
      then: (resolve: (v: unknown) => void, reject: (v: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return obj;
  }

  function createErrorClient(errorMessage: string) {
    const result = { data: null, error: { message: errorMessage } };
    return { from: () => createChain(result) } as unknown as SupabaseClient;
  }

  it('should throw when getPending returns an error (lines 89-90)', async () => {
    const repo = new ProposalRepository(createErrorClient('pending failed'));
    await expect(repo.getPending()).rejects.toThrow(
      'Failed to get pending proposals: pending failed'
    );
  });

  it('should throw when getByProject returns an error (lines 107-108)', async () => {
    const repo = new ProposalRepository(createErrorClient('project query failed'));
    await expect(repo.getByProject('proj-1')).rejects.toThrow(
      'Failed to get proposals by project: project query failed'
    );
  });

  it('should throw when getByStatus returns an error (lines 125-126)', async () => {
    const repo = new ProposalRepository(createErrorClient('query failed'));
    await expect(repo.getByStatus('approved')).rejects.toThrow(
      'Failed to get proposals by status: query failed'
    );
  });

  it('should throw when approve returns an error (lines 147-148)', async () => {
    const repo = new ProposalRepository(createErrorClient('approve failed'));
    await expect(repo.approve('prop-1')).rejects.toThrow(
      'Failed to approve proposal: approve failed'
    );
  });

  it('should throw when reject returns an error (lines 170-171)', async () => {
    const repo = new ProposalRepository(createErrorClient('reject failed'));
    await expect(repo.reject('prop-1', 'not needed')).rejects.toThrow(
      'Failed to reject proposal: reject failed'
    );
  });

  it('should throw when delete returns an error (lines 187-188)', async () => {
    const repo = new ProposalRepository(createErrorClient('delete failed'));
    await expect(repo.delete('prop-1')).rejects.toThrow(
      'Failed to delete proposal: delete failed'
    );
  });
});
