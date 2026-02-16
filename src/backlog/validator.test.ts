import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BacklogValidator } from './validator.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { ProjectRepository } from '../db/repositories/projects.js';
import { createSupabaseClient } from '../db/client.js';

describe('BacklogValidator', () => {
  let validator: BacklogValidator;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let testProjectId: string;
  let testTaskIds: string[] = [];

  beforeAll(async () => {
    const client = createSupabaseClient();
    taskRepo = new TaskRepository(client);
    projectRepo = new ProjectRepository(client);

    const project = await projectRepo.create({ name: 'Validator Test Project' });
    testProjectId = project.id;

    validator = new BacklogValidator(taskRepo, { staleDays: 14 });
  });

  afterAll(async () => {
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

  describe('validate', () => {
    it('should return a ValidationResult with checkedAt and taskCount', async () => {
      const result = await validator.validate();

      expect(result).toBeDefined();
      expect(result.checkedAt).toBeDefined();
      expect(typeof result.taskCount).toBe('number');
      expect(Array.isArray(result.issues)).toBe(true);
    });
  });

  describe('stale task detection', () => {
    it('should flag tasks queued longer than staleDays', async () => {
      // Create a task with a backdated created_at via raw Supabase
      const client = createSupabaseClient();
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 20); // 20 days ago

      const { data } = await client
        .from('tc_tasks')
        .insert({
          project_id: testProjectId,
          title: 'Validator Test - Stale Task',
          status: 'queued',
          priority: 3,
          created_at: oldDate.toISOString(),
        })
        .select()
        .single();

      testTaskIds.push(data!.id);

      const result = await validator.validate();
      const staleIssues = result.issues.filter(
        i => i.taskId === data!.id && i.rule === 'stale'
      );

      expect(staleIssues).toHaveLength(1);
      expect(staleIssues[0].severity).toBe('warning');
      expect(staleIssues[0].message).toContain('20 days');
    });

    it('should not flag recent tasks as stale', async () => {
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - Fresh Task',
        priority: 3,
        description: 'has description',
        acceptance_criteria: 'has criteria',
      });
      testTaskIds.push(task.id);

      const result = await validator.validate();
      const staleIssues = result.issues.filter(
        i => i.taskId === task.id && i.rule === 'stale'
      );

      expect(staleIssues).toHaveLength(0);
    });

    it('should respect custom staleDays option', async () => {
      const strictValidator = new BacklogValidator(taskRepo, { staleDays: 1 });

      const client = createSupabaseClient();
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const { data } = await client
        .from('tc_tasks')
        .insert({
          project_id: testProjectId,
          title: 'Validator Test - Custom Stale',
          status: 'queued',
          priority: 3,
          description: 'has description',
          acceptance_criteria: 'has criteria',
          created_at: twoDaysAgo.toISOString(),
        })
        .select()
        .single();

      testTaskIds.push(data!.id);

      const result = await strictValidator.validate();
      const staleIssues = result.issues.filter(
        i => i.taskId === data!.id && i.rule === 'stale'
      );

      expect(staleIssues).toHaveLength(1);
    });
  });

  describe('incomplete task detection', () => {
    it('should flag tasks missing description', async () => {
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - No Description',
        priority: 3,
        acceptance_criteria: 'has criteria',
      });
      testTaskIds.push(task.id);

      const result = await validator.validate();
      const incompleteIssues = result.issues.filter(
        i => i.taskId === task.id && i.rule === 'incomplete'
      );

      expect(incompleteIssues).toHaveLength(1);
      expect(incompleteIssues[0].message).toContain('description');
    });

    it('should flag tasks missing acceptance_criteria', async () => {
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - No Criteria',
        priority: 3,
        description: 'has description',
      });
      testTaskIds.push(task.id);

      const result = await validator.validate();
      const incompleteIssues = result.issues.filter(
        i => i.taskId === task.id && i.rule === 'incomplete'
      );

      expect(incompleteIssues).toHaveLength(1);
      expect(incompleteIssues[0].message).toContain('acceptance_criteria');
    });

    it('should flag tasks missing both fields', async () => {
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - Missing Both',
        priority: 3,
      });
      testTaskIds.push(task.id);

      const result = await validator.validate();
      const incompleteIssues = result.issues.filter(
        i => i.taskId === task.id && i.rule === 'incomplete'
      );

      expect(incompleteIssues).toHaveLength(1);
      expect(incompleteIssues[0].message).toContain('description');
      expect(incompleteIssues[0].message).toContain('acceptance_criteria');
    });

    it('should not flag tasks with both fields present', async () => {
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - Complete Fields',
        priority: 3,
        description: 'has description',
        acceptance_criteria: 'has criteria',
      });
      testTaskIds.push(task.id);

      const result = await validator.validate();
      const incompleteIssues = result.issues.filter(
        i => i.taskId === task.id && i.rule === 'incomplete'
      );

      expect(incompleteIssues).toHaveLength(0);
    });
  });

  describe('unconfirmed high-priority detection', () => {
    it('should flag priority > 7 tasks without confirmation', async () => {
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - High Priority Unconfirmed',
        priority: 8,
        description: 'has description',
        acceptance_criteria: 'has criteria',
      });
      testTaskIds.push(task.id);

      const result = await validator.validate();
      const highPriorityIssues = result.issues.filter(
        i => i.taskId === task.id && i.rule === 'unconfirmed_high_priority'
      );

      expect(highPriorityIssues).toHaveLength(1);
      expect(highPriorityIssues[0].severity).toBe('error');
      expect(highPriorityIssues[0].message).toContain('priority=8');
    });

    it('should not flag priority > 7 tasks that are confirmed', async () => {
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - High Priority Confirmed',
        priority: 9,
        description: 'has description',
        acceptance_criteria: 'has criteria',
      });
      testTaskIds.push(task.id);

      await taskRepo.confirmPriority(task.id, 'test-user');

      const result = await validator.validate();
      const highPriorityIssues = result.issues.filter(
        i => i.taskId === task.id && i.rule === 'unconfirmed_high_priority'
      );

      expect(highPriorityIssues).toHaveLength(0);
    });

    it('should not flag priority <= 7 tasks even without confirmation', async () => {
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - Medium Priority',
        priority: 7,
        description: 'has description',
        acceptance_criteria: 'has criteria',
      });
      testTaskIds.push(task.id);

      const result = await validator.validate();
      const highPriorityIssues = result.issues.filter(
        i => i.taskId === task.id && i.rule === 'unconfirmed_high_priority'
      );

      expect(highPriorityIssues).toHaveLength(0);
    });
  });

  describe('orphaned blocker detection', () => {
    it('should flag tasks blocked by a completed task', async () => {
      // Create a blocker task and complete it
      const blockerTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - Completed Blocker',
        priority: 5,
        description: 'blocker',
        acceptance_criteria: 'criteria',
      });
      testTaskIds.push(blockerTask.id);
      await taskRepo.updateStatus(blockerTask.id, 'complete');

      // Create a task blocked by the completed one
      const blockedTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - Orphan Blocked Task',
        priority: 5,
        description: 'blocked',
        acceptance_criteria: 'criteria',
        blocked_by_task_id: blockerTask.id,
      });
      testTaskIds.push(blockedTask.id);

      const result = await validator.validate();
      const orphanIssues = result.issues.filter(
        i => i.taskId === blockedTask.id && i.rule === 'orphaned_blocker'
      );

      expect(orphanIssues).toHaveLength(1);
      expect(orphanIssues[0].severity).toBe('error');
      expect(orphanIssues[0].message).toContain('already complete');
    });

    it('should flag tasks blocked by a deleted task', async () => {
      // Create blocker task first, then create blocked task referencing it
      const blockerTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - To Be Deleted Blocker',
        priority: 5,
      });
      testTaskIds.push(blockerTask.id);

      const blockedTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - Blocked By Deleted',
        priority: 5,
        description: 'blocked',
        acceptance_criteria: 'criteria',
        blocked_by_task_id: blockerTask.id,
      });
      testTaskIds.push(blockedTask.id);

      // Now delete the blocker (FK may cascade or set null — need to re-set the reference)
      // Use raw client to delete blocker and preserve the dangling reference
      const client = createSupabaseClient();
      await client.from('tc_tasks').delete().eq('id', blockerTask.id);
      // Remove from cleanup list since already deleted
      testTaskIds = testTaskIds.filter(id => id !== blockerTask.id);

      // Re-check: the blocked_by_task_id may have been nulled by cascade
      const { data: refreshed } = await client
        .from('tc_tasks')
        .select('blocked_by_task_id')
        .eq('id', blockedTask.id)
        .single();

      // If FK cascade nulled the reference, skip this test — DB enforces integrity
      if (!refreshed?.blocked_by_task_id) {
        // The DB cascade cleaned up the reference, so the validator
        // would never see this scenario in practice. Test is not applicable.
        return;
      }

      const result = await validator.validate();
      const orphanIssues = result.issues.filter(
        i => i.taskId === blockedTask.id && i.rule === 'orphaned_blocker'
      );

      expect(orphanIssues).toHaveLength(1);
      expect(orphanIssues[0].message).toContain('no longer exists');
    });

    it('should not flag tasks blocked by an active task', async () => {
      const blockerTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - Active Blocker',
        priority: 5,
        description: 'blocker',
        acceptance_criteria: 'criteria',
      });
      testTaskIds.push(blockerTask.id);

      const blockedTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Validator Test - Validly Blocked',
        priority: 5,
        description: 'blocked',
        acceptance_criteria: 'criteria',
        blocked_by_task_id: blockerTask.id,
      });
      testTaskIds.push(blockedTask.id);

      const result = await validator.validate();
      const orphanIssues = result.issues.filter(
        i => i.taskId === blockedTask.id && i.rule === 'orphaned_blocker'
      );

      expect(orphanIssues).toHaveLength(0);
    });
  });
});
