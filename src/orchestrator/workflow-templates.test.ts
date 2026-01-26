import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBugFixWorkflow,
  createFeatureWorkflow,
  createRefactorWorkflow,
  WorkflowManager,
  WorkflowInput,
  Workflow,
  WorkflowPhase,
} from './workflow-templates.js';

describe('Workflow Templates', () => {
  const baseInput: WorkflowInput = {
    taskId: 'task-123',
    projectName: 'TestProject',
    taskTitle: 'Test Task',
    taskDescription: 'This is a test task description',
  };

  describe('createBugFixWorkflow', () => {
    it('should create a workflow with correct type and name', () => {
      const workflow = createBugFixWorkflow(baseInput);

      expect(workflow.type).toBe('bug_fix');
      expect(workflow.name).toBe('Bug Fix: Test Task');
      expect(workflow.taskId).toBe('task-123');
      expect(workflow.projectName).toBe('TestProject');
    });

    it('should have four phases: analyze, implement, test, commit', () => {
      const workflow = createBugFixWorkflow(baseInput);

      expect(workflow.phases).toHaveLength(4);
      expect(workflow.phases.map((p) => p.name)).toEqual([
        'Analyze',
        'Implement Fix',
        'Test',
        'Commit',
      ]);
    });

    it('should initialize all phases as pending', () => {
      const workflow = createBugFixWorkflow(baseInput);

      workflow.phases.forEach((phase) => {
        expect(phase.status).toBe('pending');
      });
    });

    it('should set analyze phase to use sonnet model', () => {
      const workflow = createBugFixWorkflow(baseInput);

      expect(workflow.phases[0].recommendedModel).toBe('sonnet');
    });

    it('should include task description in analyze phase prompt', () => {
      const workflow = createBugFixWorkflow(baseInput);

      expect(workflow.phases[0].promptTemplate).toContain('This is a test task description');
    });

    it('should reference CAPABILITIES.md and agents.md in prompts', () => {
      const workflow = createBugFixWorkflow(baseInput);

      workflow.phases.forEach((phase) => {
        expect(phase.promptTemplate).toContain('CAPABILITIES.md');
        expect(phase.promptTemplate).toContain('agents.md');
      });
    });

    it('should include input context placeholder in subsequent phases', () => {
      const workflow = createBugFixWorkflow(baseInput);

      // First phase should not have input context placeholder
      expect(workflow.phases[0].promptTemplate).not.toContain('{{INPUT_CONTEXT}}');

      // Subsequent phases should have it
      expect(workflow.phases[1].promptTemplate).toContain('{{INPUT_CONTEXT}}');
      expect(workflow.phases[2].promptTemplate).toContain('{{INPUT_CONTEXT}}');
      expect(workflow.phases[3].promptTemplate).toContain('{{INPUT_CONTEXT}}');
    });

    it('should have unique phase IDs', () => {
      const workflow = createBugFixWorkflow(baseInput);

      const ids = workflow.phases.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have status pending initially', () => {
      const workflow = createBugFixWorkflow(baseInput);

      expect(workflow.status).toBe('pending');
      expect(workflow.currentPhaseIndex).toBe(0);
    });
  });

  describe('createFeatureWorkflow', () => {
    it('should create a workflow with correct type and name', () => {
      const workflow = createFeatureWorkflow(baseInput);

      expect(workflow.type).toBe('feature');
      expect(workflow.name).toBe('Feature: Test Task');
    });

    it('should have four phases: plan, implement, verify, commit', () => {
      const workflow = createFeatureWorkflow(baseInput);

      expect(workflow.phases).toHaveLength(4);
      expect(workflow.phases.map((p) => p.name)).toEqual([
        'Plan',
        'Implement',
        'Verify',
        'Commit',
      ]);
    });

    it('should recommend opus for plan and implement phases', () => {
      const workflow = createFeatureWorkflow(baseInput);

      expect(workflow.phases[0].recommendedModel).toBe('opus');
      expect(workflow.phases[1].recommendedModel).toBe('opus');
      expect(workflow.phases[2].recommendedModel).toBe('sonnet');
      expect(workflow.phases[3].recommendedModel).toBe('sonnet');
    });

    it('should include acceptance criteria in prompts when provided', () => {
      const inputWithCriteria: WorkflowInput = {
        ...baseInput,
        acceptanceCriteria: ['Criterion 1', 'Criterion 2', 'Criterion 3'],
      };

      const workflow = createFeatureWorkflow(inputWithCriteria);

      // Plan, implement, and verify phases should have criteria
      expect(workflow.phases[0].promptTemplate).toContain('Criterion 1');
      expect(workflow.phases[0].promptTemplate).toContain('Criterion 2');
      expect(workflow.phases[1].promptTemplate).toContain('Criterion 1');
      expect(workflow.phases[2].promptTemplate).toContain('Criterion 1');
    });

    it('should suggest brainstorming and writing-plans skills in plan phase', () => {
      const workflow = createFeatureWorkflow(baseInput);

      expect(workflow.phases[0].promptTemplate).toContain('brainstorming skill');
      expect(workflow.phases[0].promptTemplate).toContain('writing-plans skill');
    });

    it('should suggest test-driven-development skill in implement phase', () => {
      const workflow = createFeatureWorkflow(baseInput);

      expect(workflow.phases[1].promptTemplate).toContain('test-driven-development skill');
    });
  });

  describe('createRefactorWorkflow', () => {
    it('should create a workflow with correct type and name', () => {
      const workflow = createRefactorWorkflow(baseInput);

      expect(workflow.type).toBe('refactor');
      expect(workflow.name).toBe('Refactor: Test Task');
    });

    it('should have three phases: analyze, implement, verify', () => {
      const workflow = createRefactorWorkflow(baseInput);

      expect(workflow.phases).toHaveLength(3);
      expect(workflow.phases.map((p) => p.name)).toEqual(['Analyze', 'Implement', 'Verify']);
    });

    it('should recommend sonnet for all phases', () => {
      const workflow = createRefactorWorkflow(baseInput);

      workflow.phases.forEach((phase) => {
        expect(phase.recommendedModel).toBe('sonnet');
      });
    });

    it('should mention Task(Explore) in analyze phase', () => {
      const workflow = createRefactorWorkflow(baseInput);

      expect(workflow.phases[0].promptTemplate).toContain('Task(Explore)');
    });

    it('should emphasize behavior preservation in implement phase', () => {
      const workflow = createRefactorWorkflow(baseInput);

      expect(workflow.phases[1].promptTemplate).toContain('Preserve existing behavior');
    });

    it('should not have a commit phase', () => {
      const workflow = createRefactorWorkflow(baseInput);

      const phaseNames = workflow.phases.map((p) => p.name.toLowerCase());
      expect(phaseNames).not.toContain('commit');
    });
  });
});

describe('WorkflowManager', () => {
  let manager: WorkflowManager;
  const baseInput: WorkflowInput = {
    taskId: 'task-123',
    projectName: 'TestProject',
    taskTitle: 'Test Task',
    taskDescription: 'Test description',
  };

  beforeEach(() => {
    manager = new WorkflowManager();
  });

  describe('createWorkflow', () => {
    it('should create bug_fix workflow', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);

      expect(workflow.type).toBe('bug_fix');
      expect(manager.getWorkflow(workflow.id)).toBe(workflow);
    });

    it('should create feature workflow', () => {
      const workflow = manager.createWorkflow('feature', baseInput);

      expect(workflow.type).toBe('feature');
      expect(manager.getWorkflow(workflow.id)).toBe(workflow);
    });

    it('should create refactor workflow', () => {
      const workflow = manager.createWorkflow('refactor', baseInput);

      expect(workflow.type).toBe('refactor');
      expect(manager.getWorkflow(workflow.id)).toBe(workflow);
    });

    it('should throw for unknown workflow type', () => {
      expect(() => manager.createWorkflow('unknown' as any, baseInput)).toThrow(
        'Unknown workflow type'
      );
    });
  });

  describe('getWorkflow', () => {
    it('should return undefined for non-existent workflow', () => {
      expect(manager.getWorkflow('non-existent')).toBeUndefined();
    });

    it('should return the workflow by ID', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      expect(manager.getWorkflow(workflow.id)).toBe(workflow);
    });
  });

  describe('getAllWorkflows', () => {
    it('should return empty array when no workflows', () => {
      expect(manager.getAllWorkflows()).toHaveLength(0);
    });

    it('should return all workflows', () => {
      manager.createWorkflow('bug_fix', baseInput);
      manager.createWorkflow('feature', { ...baseInput, taskId: 'task-456' });

      expect(manager.getAllWorkflows()).toHaveLength(2);
    });
  });

  describe('getWorkflowsByTask', () => {
    it('should return workflows for specific task', () => {
      manager.createWorkflow('bug_fix', baseInput);
      manager.createWorkflow('feature', { ...baseInput, taskId: 'task-456' });
      manager.createWorkflow('refactor', baseInput);

      const workflows = manager.getWorkflowsByTask('task-123');

      expect(workflows).toHaveLength(2);
      expect(workflows.every((w) => w.taskId === 'task-123')).toBe(true);
    });
  });

  describe('getCurrentPhase', () => {
    it('should return null for non-existent workflow', () => {
      expect(manager.getCurrentPhase('non-existent')).toBeNull();
    });

    it('should return first phase initially', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      const phase = manager.getCurrentPhase(workflow.id);

      expect(phase?.name).toBe('Analyze');
    });
  });

  describe('startWorkflow', () => {
    it('should start the workflow and first phase', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      const phase = manager.startWorkflow(workflow.id);

      expect(phase?.status).toBe('in_progress');
      expect(phase?.startedAt).toBeInstanceOf(Date);
      expect(workflow.status).toBe('running');
    });

    it('should return null if workflow is already running', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      const result = manager.startWorkflow(workflow.id);
      expect(result).toBeNull();
    });

    it('should return null for non-existent workflow', () => {
      expect(manager.startWorkflow('non-existent')).toBeNull();
    });
  });

  describe('getCurrentPhasePrompt', () => {
    it('should return null for non-existent workflow', () => {
      expect(manager.getCurrentPhasePrompt('non-existent')).toBeNull();
    });

    it('should return prompt without input context for first phase', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      const prompt = manager.getCurrentPhasePrompt(workflow.id);

      expect(prompt).toContain('Phase: Bug Analysis');
      expect(prompt).not.toContain('Previous Phase Summary');
    });

    it('should replace input context placeholder with summary', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);
      manager.completePhase(workflow.id, 'Analysis found the bug in file X');

      const prompt = manager.getCurrentPhasePrompt(workflow.id);

      expect(prompt).toContain('Previous Phase Summary');
      expect(prompt).toContain('Analysis found the bug in file X');
    });
  });

  describe('completePhase', () => {
    it('should complete phase and advance to next', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      const result = manager.completePhase(workflow.id, 'Phase 1 complete');

      expect(result.success).toBe(true);
      expect(result.workflowComplete).toBe(false);
      expect(result.currentPhase?.name).toBe('Implement Fix');
      expect(result.currentPhase?.inputSummary).toBe('Phase 1 complete');
    });

    it('should pass summary to next phase', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);
      manager.completePhase(workflow.id, 'Bug is in module X');

      const currentPhase = manager.getCurrentPhase(workflow.id);
      expect(currentPhase?.inputSummary).toBe('Bug is in module X');
    });

    it('should mark workflow complete when all phases done', () => {
      const workflow = manager.createWorkflow('refactor', baseInput); // 3 phases
      manager.startWorkflow(workflow.id);

      manager.completePhase(workflow.id, 'Phase 1');
      manager.completePhase(workflow.id, 'Phase 2');
      const result = manager.completePhase(workflow.id, 'Phase 3');

      expect(result.success).toBe(true);
      expect(result.workflowComplete).toBe(true);
      expect(result.currentPhase).toBeNull();
      expect(workflow.status).toBe('completed');
      expect(workflow.completedAt).toBeInstanceOf(Date);
    });

    it('should return error if no phase in progress', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      // Don't start workflow

      const result = manager.completePhase(workflow.id, 'Summary');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No phase in progress');
    });

    it('should return error for non-existent workflow', () => {
      const result = manager.completePhase('non-existent', 'Summary');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Workflow not found');
    });
  });

  describe('failPhase', () => {
    it('should fail the phase and workflow', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      const result = manager.failPhase(workflow.id, 'Could not reproduce bug');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not reproduce bug');
      expect(result.currentPhase?.status).toBe('failed');
      expect(workflow.status).toBe('failed');
    });

    it('should record error message on phase', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      manager.failPhase(workflow.id, 'Error message');

      const phase = workflow.phases[0];
      expect(phase.errorMessage).toBe('Error message');
    });
  });

  describe('skipPhase', () => {
    it('should skip phase and advance to next', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      const result = manager.skipPhase(workflow.id, 'Not needed');

      expect(result.success).toBe(true);
      expect(workflow.phases[0].status).toBe('skipped');
      expect(result.currentPhase?.name).toBe('Implement Fix');
    });

    it('should mark skipped phase output summary', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      manager.skipPhase(workflow.id, 'Analysis not needed');

      expect(workflow.phases[0].outputSummary).toBe('Skipped: Analysis not needed');
    });

    it('should carry forward last non-skipped summary', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      manager.completePhase(workflow.id, 'Important summary');
      manager.skipPhase(workflow.id, 'Skip this one');

      const currentPhase = manager.getCurrentPhase(workflow.id);
      expect(currentPhase?.inputSummary).toBe('Important summary');
    });
  });

  describe('setPhaseSession', () => {
    it('should set session ID on current phase', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      const result = manager.setPhaseSession(workflow.id, 'session-abc');

      expect(result).toBe(true);
      expect(workflow.phases[0].sessionId).toBe('session-abc');
    });

    it('should return false if no phase in progress', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);

      const result = manager.setPhaseSession(workflow.id, 'session-abc');

      expect(result).toBe(false);
    });

    it('should return false for non-existent workflow', () => {
      const result = manager.setPhaseSession('non-existent', 'session-abc');
      expect(result).toBe(false);
    });
  });

  describe('getProgress', () => {
    it('should return null for non-existent workflow', () => {
      expect(manager.getProgress('non-existent')).toBeNull();
    });

    it('should return 0% initially', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      const progress = manager.getProgress(workflow.id);

      expect(progress?.completed).toBe(0);
      expect(progress?.total).toBe(4);
      expect(progress?.percentage).toBe(0);
      expect(progress?.currentPhaseName).toBe('Analyze');
    });

    it('should update progress as phases complete', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      manager.completePhase(workflow.id, 'Done');
      let progress = manager.getProgress(workflow.id);
      expect(progress?.completed).toBe(1);
      expect(progress?.percentage).toBe(25);

      manager.completePhase(workflow.id, 'Done');
      progress = manager.getProgress(workflow.id);
      expect(progress?.completed).toBe(2);
      expect(progress?.percentage).toBe(50);
    });

    it('should count skipped phases as completed', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      manager.skipPhase(workflow.id, 'Skip');
      const progress = manager.getProgress(workflow.id);

      expect(progress?.completed).toBe(1);
    });
  });

  describe('deleteWorkflow', () => {
    it('should delete workflow', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);

      const result = manager.deleteWorkflow(workflow.id);

      expect(result).toBe(true);
      expect(manager.getWorkflow(workflow.id)).toBeUndefined();
    });

    it('should return false for non-existent workflow', () => {
      expect(manager.deleteWorkflow('non-existent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all workflows', () => {
      manager.createWorkflow('bug_fix', baseInput);
      manager.createWorkflow('feature', { ...baseInput, taskId: 'task-456' });

      manager.clear();

      expect(manager.getAllWorkflows()).toHaveLength(0);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete bug fix workflow', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);

      // Start workflow
      manager.startWorkflow(workflow.id);
      expect(workflow.status).toBe('running');

      // Complete analyze phase
      let result = manager.completePhase(
        workflow.id,
        'Found null pointer in handleClick function'
      );
      expect(result.currentPhase?.name).toBe('Implement Fix');

      // Complete implement phase
      result = manager.completePhase(workflow.id, 'Added null check before accessing property');
      expect(result.currentPhase?.name).toBe('Test');

      // Complete test phase
      result = manager.completePhase(workflow.id, 'All 42 tests pass');
      expect(result.currentPhase?.name).toBe('Commit');

      // Complete commit phase
      result = manager.completePhase(workflow.id, 'Committed as abc123');
      expect(result.workflowComplete).toBe(true);
      expect(workflow.status).toBe('completed');
    });

    it('should handle workflow with failure recovery', () => {
      const workflow = manager.createWorkflow('feature', baseInput);
      manager.startWorkflow(workflow.id);

      // Fail first attempt at plan
      manager.failPhase(workflow.id, 'Requirements unclear');
      expect(workflow.status).toBe('failed');

      // Create new workflow for retry
      const retryWorkflow = manager.createWorkflow('feature', baseInput);
      manager.startWorkflow(retryWorkflow.id);
      manager.completePhase(retryWorkflow.id, 'Plan complete after clarification');

      expect(retryWorkflow.status).toBe('running');
      expect(retryWorkflow.phases[0].status).toBe('completed');
    });

    it('should maintain minimal context between phases', () => {
      const workflow = manager.createWorkflow('bug_fix', baseInput);
      manager.startWorkflow(workflow.id);

      // Complete with detailed summary
      manager.completePhase(
        workflow.id,
        'Root cause: Missing validation in user input handler. Affected files: src/handlers/user.ts, src/validators/input.ts'
      );

      // Next phase should only get the summary, not full analysis
      const prompt = manager.getCurrentPhasePrompt(workflow.id);
      expect(prompt).toContain('Previous Phase Summary');
      expect(prompt).toContain('Root cause: Missing validation');

      // The prompt should be focused, not bloated
      expect(prompt!.length).toBeLessThan(5000);
    });
  });
});
