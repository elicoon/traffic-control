import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSupabaseClient } from './db/client.js';
import { ProjectRepository } from './db/repositories/projects.js';
import { TaskRepository } from './db/repositories/tasks.js';

describe('Integration: Full Flow', () => {
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let testProjectId: string;
  let testTaskId: string;

  beforeAll(async () => {
    const client = createSupabaseClient();
    projectRepo = new ProjectRepository(client);
    taskRepo = new TaskRepository(client);
  });

  afterAll(async () => {
    // Clean up test data
    if (testTaskId) {
      try {
        await taskRepo.delete(testTaskId);
      } catch {
        // Task may already be deleted or not exist
      }
    }
    if (testProjectId) {
      try {
        await projectRepo.delete(testProjectId);
      } catch {
        // Project may already be deleted or not exist
      }
    }
  });

  it('should create a project and task, then queue task for agent', async () => {
    // Create project
    const project = await projectRepo.create({
      name: 'Integration Test Project',
      description: 'Testing the full flow',
      priority: 10
    });
    testProjectId = project.id;
    expect(project.status).toBe('active');
    expect(project.name).toBe('Integration Test Project');
    expect(project.description).toBe('Testing the full flow');
    expect(project.priority).toBe(10);

    // Create task
    const task = await taskRepo.create({
      project_id: project.id,
      title: 'Test task for integration',
      description: 'This task tests the full flow',
      priority: 5,
      estimated_sessions_sonnet: 1
    });
    testTaskId = task.id;
    expect(task.status).toBe('queued');
    expect(task.title).toBe('Test task for integration');
    expect(task.project_id).toBe(project.id);

    // Verify task appears in queue
    const queuedTasks = await taskRepo.getQueued();
    const found = queuedTasks.find(t => t.id === testTaskId);
    expect(found).toBeDefined();
    expect(found?.status).toBe('queued');

    // Simulate assignment
    const assigned = await taskRepo.assignAgent(testTaskId, 'test-agent-123');
    expect(assigned.status).toBe('assigned');
    expect(assigned.assigned_agent_id).toBe('test-agent-123');

    // Verify task no longer in queued list
    const queuedAfterAssign = await taskRepo.getQueued();
    const stillQueued = queuedAfterAssign.find(t => t.id === testTaskId);
    expect(stillQueued).toBeUndefined();

    // Simulate progress
    const inProgress = await taskRepo.updateStatus(testTaskId, 'in_progress');
    expect(inProgress.status).toBe('in_progress');
    expect(inProgress.started_at).toBeDefined();

    // Record some usage
    const withUsage = await taskRepo.recordUsage(testTaskId, {
      tokens_sonnet: 1500,
      sessions_sonnet: 1
    });
    expect(withUsage.actual_tokens_sonnet).toBe(1500);
    expect(withUsage.actual_sessions_sonnet).toBe(1);

    // Simulate completion
    const complete = await taskRepo.updateStatus(testTaskId, 'complete');
    expect(complete.status).toBe('complete');
    expect(complete.completed_at).toBeDefined();

    // Verify project can be retrieved with task
    const retrievedProject = await projectRepo.getById(testProjectId);
    expect(retrievedProject).toBeDefined();
    expect(retrievedProject?.id).toBe(testProjectId);

    // Verify tasks by project
    const projectTasks = await taskRepo.getByProject(testProjectId);
    expect(projectTasks.length).toBeGreaterThanOrEqual(1);
    const projectTask = projectTasks.find(t => t.id === testTaskId);
    expect(projectTask).toBeDefined();
    expect(projectTask?.status).toBe('complete');
  });

  it('should handle task blocking and unblocking flow', async () => {
    // Create a new task for this test
    const task = await taskRepo.create({
      project_id: testProjectId,
      title: 'Blocking test task',
      description: 'Testing blocked status flow',
      priority: 3
    });
    const blockTestTaskId = task.id;

    try {
      // Assign and start
      await taskRepo.assignAgent(blockTestTaskId, 'test-agent-456');
      await taskRepo.updateStatus(blockTestTaskId, 'in_progress');

      // Block the task
      const blocked = await taskRepo.updateStatus(blockTestTaskId, 'blocked');
      expect(blocked.status).toBe('blocked');

      // Verify in blocked status list
      const blockedTasks = await taskRepo.getByStatus('blocked');
      const foundBlocked = blockedTasks.find(t => t.id === blockTestTaskId);
      expect(foundBlocked).toBeDefined();

      // Unblock by moving back to in_progress
      const unblocked = await taskRepo.updateStatus(blockTestTaskId, 'in_progress');
      expect(unblocked.status).toBe('in_progress');

      // Complete the task
      const completed = await taskRepo.updateStatus(blockTestTaskId, 'complete');
      expect(completed.status).toBe('complete');
    } finally {
      // Cleanup
      await taskRepo.delete(blockTestTaskId);
    }
  });

  it('should properly unassign agent from task', async () => {
    // Create a new task for this test
    const task = await taskRepo.create({
      project_id: testProjectId,
      title: 'Unassign test task',
      description: 'Testing agent unassignment',
      priority: 2
    });
    const unassignTestTaskId = task.id;

    try {
      // Assign an agent
      const assigned = await taskRepo.assignAgent(unassignTestTaskId, 'test-agent-789');
      expect(assigned.status).toBe('assigned');
      expect(assigned.assigned_agent_id).toBe('test-agent-789');

      // Unassign the agent
      const unassigned = await taskRepo.unassignAgent(unassignTestTaskId);
      expect(unassigned.status).toBe('queued');
      expect(unassigned.assigned_agent_id).toBeNull();

      // Verify task is back in queue
      const queuedTasks = await taskRepo.getQueued();
      const found = queuedTasks.find(t => t.id === unassignTestTaskId);
      expect(found).toBeDefined();
    } finally {
      // Cleanup
      await taskRepo.delete(unassignTestTaskId);
    }
  });
});
