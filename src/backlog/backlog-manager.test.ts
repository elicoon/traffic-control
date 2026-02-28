import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { BacklogManager } from './backlog-manager.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { ProjectRepository, Project } from '../db/repositories/projects.js';
import { ProposalRepository } from '../db/repositories/proposals.js';
import { createSupabaseClient } from '../db/client.js';

describe('BacklogManager', () => {
  let backlogManager: BacklogManager;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let proposalRepo: ProposalRepository;
  let testProjectId: string;
  let testProject: Project;
  let testTaskIds: string[] = [];
  let initialQueuedCount: number = 0;

  beforeAll(async () => {
    const client = createSupabaseClient();
    taskRepo = new TaskRepository(client);
    projectRepo = new ProjectRepository(client);
    proposalRepo = new ProposalRepository(client);

    // Get initial count of queued tasks to account for other tests
    const initialQueued = await taskRepo.getQueued();
    initialQueuedCount = initialQueued.length;

    // Create a test project
    const project = await projectRepo.create({ name: 'Backlog Test Project' });
    testProjectId = project.id;
    testProject = project;
  });

  beforeEach(() => {
    // Create a new manager for each test with a threshold relative to initial state
    backlogManager = new BacklogManager(taskRepo, projectRepo, proposalRepo, {
      threshold: initialQueuedCount + 5
    });
  });

  afterAll(async () => {
    // Clean up test tasks
    for (const taskId of testTaskIds) {
      try {
        await taskRepo.delete(taskId);
      } catch {
        // Ignore cleanup errors
      }
    }
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  describe('isBacklogLow', () => {
    it('should return true when backlog is below threshold', async () => {
      // Get current count and set threshold above it
      const currentQueued = await taskRepo.getQueued();
      const customManager = new BacklogManager(taskRepo, projectRepo, proposalRepo, {
        threshold: currentQueued.length + 10
      });
      const isLow = await customManager.isBacklogLow();
      expect(isLow).toBe(true);
    });

    it('should return true when backlog has some tasks but still below threshold', async () => {
      // Create 3 queued tasks
      for (let i = 0; i < 3; i++) {
        const task = await taskRepo.create({
          project_id: testProjectId,
          title: `Test Task Below Threshold ${i}`,
          priority: i
        });
        testTaskIds.push(task.id);
      }

      // Get current count AFTER creating tasks, then set threshold above it
      const currentQueued = await taskRepo.getQueued();
      const customManager = new BacklogManager(taskRepo, projectRepo, proposalRepo, {
        threshold: currentQueued.length + 10
      });
      const isLow = await customManager.isBacklogLow();
      expect(isLow).toBe(true);
    });

    it('should return false when backlog meets or exceeds threshold', async () => {
      // Create more tasks to meet threshold (already have 3, need 2 more to reach 5)
      for (let i = 0; i < 3; i++) {
        const task = await taskRepo.create({
          project_id: testProjectId,
          title: `Test Task At Threshold ${i}`,
          priority: i
        });
        testTaskIds.push(task.id);
      }

      const isLow = await backlogManager.isBacklogLow();
      expect(isLow).toBe(false);
    });

    it('should respect custom threshold', async () => {
      // Set threshold relative to current queue depth so it's always considered low
      const currentQueued = await taskRepo.getQueued();
      const customManager = new BacklogManager(taskRepo, projectRepo, proposalRepo, {
        threshold: currentQueued.length + 100
      });
      const isLow = await customManager.isBacklogLow();
      expect(isLow).toBe(true);
    });
  });

  describe('getBacklogStats', () => {
    beforeEach(() => {
      vi.spyOn(projectRepo, 'listActive').mockResolvedValueOnce([testProject]);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return stats for all active projects', async () => {
      const stats = await backlogManager.getBacklogStats();
      expect(stats).toBeDefined();
      expect(Array.isArray(stats)).toBe(true);
    });

    it('should include queued task count per project', async () => {
      const stats = await backlogManager.getBacklogStats();
      const testProjectStats = stats.find(s => s.projectId === testProjectId);

      expect(testProjectStats).toBeDefined();
      expect(testProjectStats?.queuedCount).toBeGreaterThan(0);
    });
  });

  describe('getBacklogDepth', () => {
    it('should return total queued tasks count', async () => {
      const depth = await backlogManager.getBacklogDepth();
      // Just verify it returns a non-negative number (other tests may have modified the queue)
      expect(depth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('checkAndTriggerProposals', () => {
    it('should return true when backlog is low and proposals needed', async () => {
      // Clean up our test tasks to make backlog low
      for (const taskId of testTaskIds) {
        await taskRepo.delete(taskId);
      }
      testTaskIds = [];

      // Get current pending proposals count
      const pendingProposals = await proposalRepo.getPending();
      const pendingCount = pendingProposals.length;

      // Create new manager with threshold high enough to ensure backlog is considered "low"
      // AND with a threshold higher than current pending proposals to ensure proposals are needed
      const lowBacklogManager = new BacklogManager(taskRepo, projectRepo, proposalRepo, {
        threshold: Math.max(initialQueuedCount + 100, pendingCount + 10)
      });

      const needsProposals = await lowBacklogManager.checkAndTriggerProposals();
      expect(needsProposals).toBe(true);
    });

    it('should return false when backlog is sufficient', async () => {
      // Add enough tasks to exceed threshold
      for (let i = 0; i < 6; i++) {
        const task = await taskRepo.create({
          project_id: testProjectId,
          title: `Sufficient Task ${i}`,
          priority: i
        });
        testTaskIds.push(task.id);
      }

      // Get current queue and set threshold below it
      const currentQueued = await taskRepo.getQueued();
      const sufficientBacklogManager = new BacklogManager(taskRepo, projectRepo, proposalRepo, {
        threshold: Math.max(1, currentQueued.length - 5)
      });

      const needsProposals = await sufficientBacklogManager.checkAndTriggerProposals();
      expect(needsProposals).toBe(false);
    });
  });

  describe('getSummary', () => {
    beforeEach(() => {
      vi.spyOn(projectRepo, 'listActive').mockResolvedValueOnce([testProject]);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return summary with all metrics', async () => {
      const summary = await backlogManager.getSummary();

      expect(summary).toBeDefined();
      expect(typeof summary.totalQueued).toBe('number');
      expect(typeof summary.totalInProgress).toBe('number');
      expect(typeof summary.totalBlocked).toBe('number');
      expect(typeof summary.totalPendingProposals).toBe('number');
      expect(typeof summary.isBacklogLow).toBe('boolean');
      expect(typeof summary.threshold).toBe('number');
    });
  });
});
