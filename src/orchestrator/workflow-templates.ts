/**
 * Workflow Templates for TrafficControl Task Delegation
 *
 * This module defines workflow patterns for common development tasks.
 * Each workflow defines phases with specific sub-agent prompts and tracks
 * phase completion, passing minimal context between phases (summaries only).
 *
 * Available workflows:
 * - BugFixWorkflow: analyze -> implement -> test -> commit
 * - FeatureWorkflow: plan -> implement -> verify -> commit
 * - RefactorWorkflow: analyze -> implement -> verify
 *
 * See CAPABILITIES.md for available tools/skills and agents.md for guidelines.
 */

import { ModelType } from '../scheduler/index.js';

/**
 * Phase status in a workflow
 */
export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * A single phase in a workflow
 */
export interface WorkflowPhase {
  /** Unique identifier for this phase */
  id: string;

  /** Human-readable name */
  name: string;

  /** Current status */
  status: PhaseStatus;

  /** Model recommendation for this phase */
  recommendedModel: ModelType;

  /** Prompt template for the sub-agent */
  promptTemplate: string;

  /** Summary of previous phase results (populated at runtime) */
  inputSummary?: string;

  /** Summary of this phase's output (populated on completion) */
  outputSummary?: string;

  /** Session ID if phase is running */
  sessionId?: string;

  /** When this phase started */
  startedAt?: Date;

  /** When this phase completed */
  completedAt?: Date;

  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Workflow type identifier
 */
export type WorkflowType = 'bug_fix' | 'feature' | 'refactor';

/**
 * Complete workflow definition
 */
export interface Workflow {
  /** Unique identifier */
  id: string;

  /** Workflow type */
  type: WorkflowType;

  /** Human-readable name */
  name: string;

  /** Task ID this workflow is executing */
  taskId: string;

  /** Project name for context */
  projectName: string;

  /** Ordered list of phases */
  phases: WorkflowPhase[];

  /** Current phase index (0-based) */
  currentPhaseIndex: number;

  /** Overall status */
  status: 'pending' | 'running' | 'completed' | 'failed';

  /** When workflow was created */
  createdAt: Date;

  /** When workflow completed (if applicable) */
  completedAt?: Date;
}

/**
 * Input for creating a new workflow
 */
export interface WorkflowInput {
  /** Task ID to execute */
  taskId: string;

  /** Project name */
  projectName: string;

  /** Task title */
  taskTitle: string;

  /** Task description */
  taskDescription?: string;

  /** Acceptance criteria (optional) */
  acceptanceCriteria?: string[];
}

/**
 * Result of advancing a workflow phase
 */
export interface PhaseAdvanceResult {
  /** Whether advancement was successful */
  success: boolean;

  /** The current phase after advancement */
  currentPhase: WorkflowPhase | null;

  /** Whether workflow is complete */
  workflowComplete: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Generate a unique ID for workflows and phases
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Build the base prompt header with documentation references
 */
function buildPromptHeader(projectName: string, taskTitle: string): string {
  return `# Task Assignment

## Project: ${projectName}

## Task: ${taskTitle}

## Guidelines
- Refer to CAPABILITIES.md for available tools and actions
- Refer to agents.md for agent behavior guidelines
- Keep responses focused on the task at hand
- Provide a brief summary of your work at the end

`;
}

/**
 * Build input context section from previous phase summary
 */
function buildInputContext(inputSummary?: string): string {
  if (!inputSummary) {
    return '';
  }
  return `## Previous Phase Summary
${inputSummary}

`;
}

/**
 * Create a BugFixWorkflow: analyze -> implement -> test -> commit
 */
export function createBugFixWorkflow(input: WorkflowInput): Workflow {
  const workflowId = generateId();
  const header = buildPromptHeader(input.projectName, input.taskTitle);

  const phases: WorkflowPhase[] = [
    {
      id: `${workflowId}-analyze`,
      name: 'Analyze',
      status: 'pending',
      recommendedModel: 'sonnet',
      promptTemplate: `${header}## Phase: Bug Analysis

## Description
${input.taskDescription || 'Analyze the reported bug.'}

## Objectives
1. Reproduce the bug and understand the symptoms
2. Identify the root cause through code analysis
3. Determine the scope of affected code
4. Identify any related issues or edge cases

## Deliverables
Provide a summary containing:
- Root cause identification
- Affected files and functions
- Recommended fix approach
- Potential side effects to watch for

Use the systematic-debugging skill if the issue is complex.
`,
    },
    {
      id: `${workflowId}-implement`,
      name: 'Implement Fix',
      status: 'pending',
      recommendedModel: 'sonnet',
      promptTemplate: `${header}## Phase: Implement Bug Fix

{{INPUT_CONTEXT}}## Objectives
1. Implement the fix based on the analysis
2. Follow existing code patterns and conventions
3. Add appropriate error handling
4. Keep changes minimal and focused

## Deliverables
Provide a summary containing:
- Files modified
- Changes made (brief description)
- Any additional issues discovered
`,
    },
    {
      id: `${workflowId}-test`,
      name: 'Test',
      status: 'pending',
      recommendedModel: 'sonnet',
      promptTemplate: `${header}## Phase: Test Bug Fix

{{INPUT_CONTEXT}}## Objectives
1. Run existing tests to ensure no regressions
2. Add tests for the specific bug if not covered
3. Verify the fix resolves the original issue
4. Check edge cases identified in analysis

## Deliverables
Provide a summary containing:
- Test results (pass/fail counts)
- Any new tests added
- Verification that the bug is fixed
`,
    },
    {
      id: `${workflowId}-commit`,
      name: 'Commit',
      status: 'pending',
      recommendedModel: 'sonnet',
      promptTemplate: `${header}## Phase: Commit Changes

{{INPUT_CONTEXT}}## Objectives
1. Stage all relevant changes
2. Create a clear, descriptive commit message
3. Include bug reference if available
4. Run verification-before-completion skill

## Deliverables
Provide a summary containing:
- Commit hash
- Files committed
- Confirmation that all changes are staged
`,
    },
  ];

  return {
    id: workflowId,
    type: 'bug_fix',
    name: `Bug Fix: ${input.taskTitle}`,
    taskId: input.taskId,
    projectName: input.projectName,
    phases,
    currentPhaseIndex: 0,
    status: 'pending',
    createdAt: new Date(),
  };
}

/**
 * Create a FeatureWorkflow: plan -> implement -> verify -> commit
 */
export function createFeatureWorkflow(input: WorkflowInput): Workflow {
  const workflowId = generateId();
  const header = buildPromptHeader(input.projectName, input.taskTitle);

  const criteriaSection = input.acceptanceCriteria?.length
    ? `## Acceptance Criteria
${input.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

`
    : '';

  const phases: WorkflowPhase[] = [
    {
      id: `${workflowId}-plan`,
      name: 'Plan',
      status: 'pending',
      recommendedModel: 'opus',
      promptTemplate: `${header}## Phase: Feature Planning

## Description
${input.taskDescription || 'Plan the feature implementation.'}

${criteriaSection}## Objectives
1. Understand the feature requirements
2. Design the implementation approach
3. Identify components and files to modify
4. Plan the testing strategy

## Deliverables
Provide a summary containing:
- Implementation approach
- Files to create/modify
- Dependencies or prerequisites
- Potential risks or considerations

Use the brainstorming skill to explore requirements thoroughly.
Use the writing-plans skill to create a detailed implementation plan.
`,
    },
    {
      id: `${workflowId}-implement`,
      name: 'Implement',
      status: 'pending',
      recommendedModel: 'opus',
      promptTemplate: `${header}## Phase: Feature Implementation

{{INPUT_CONTEXT}}${criteriaSection}## Objectives
1. Implement the feature according to the plan
2. Follow test-driven development practices
3. Ensure type safety and proper error handling
4. Add appropriate comments for complex logic

## Deliverables
Provide a summary containing:
- Files created/modified
- Key implementation decisions
- Any deviations from the plan
- Tests written

Use the test-driven-development skill for implementation.
`,
    },
    {
      id: `${workflowId}-verify`,
      name: 'Verify',
      status: 'pending',
      recommendedModel: 'sonnet',
      promptTemplate: `${header}## Phase: Feature Verification

{{INPUT_CONTEXT}}${criteriaSection}## Objectives
1. Run all tests and ensure they pass
2. Verify each acceptance criterion is met
3. Check for edge cases and error handling
4. Review code quality and patterns

## Deliverables
Provide a summary containing:
- Test results
- Acceptance criteria verification (each item checked)
- Any issues found and resolved
- Code quality assessment

Use the verification-before-completion skill.
`,
    },
    {
      id: `${workflowId}-commit`,
      name: 'Commit',
      status: 'pending',
      recommendedModel: 'sonnet',
      promptTemplate: `${header}## Phase: Commit Changes

{{INPUT_CONTEXT}}## Objectives
1. Stage all feature-related changes
2. Create a clear, descriptive commit message
3. Reference the feature/task ID
4. Final verification before commit

## Deliverables
Provide a summary containing:
- Commit hash
- Files committed
- Feature summary for changelog
`,
    },
  ];

  return {
    id: workflowId,
    type: 'feature',
    name: `Feature: ${input.taskTitle}`,
    taskId: input.taskId,
    projectName: input.projectName,
    phases,
    currentPhaseIndex: 0,
    status: 'pending',
    createdAt: new Date(),
  };
}

/**
 * Create a RefactorWorkflow: analyze -> implement -> verify
 */
export function createRefactorWorkflow(input: WorkflowInput): Workflow {
  const workflowId = generateId();
  const header = buildPromptHeader(input.projectName, input.taskTitle);

  const phases: WorkflowPhase[] = [
    {
      id: `${workflowId}-analyze`,
      name: 'Analyze',
      status: 'pending',
      recommendedModel: 'sonnet',
      promptTemplate: `${header}## Phase: Refactor Analysis

## Description
${input.taskDescription || 'Analyze the code for refactoring.'}

## Objectives
1. Understand the current code structure
2. Identify code smells and improvement opportunities
3. Plan the refactoring approach
4. Ensure behavior preservation

## Deliverables
Provide a summary containing:
- Current code assessment
- Specific refactoring targets
- Approach and steps
- Tests to ensure behavior preservation

Use Task(Explore) to understand the codebase structure.
`,
    },
    {
      id: `${workflowId}-implement`,
      name: 'Implement',
      status: 'pending',
      recommendedModel: 'sonnet',
      promptTemplate: `${header}## Phase: Implement Refactoring

{{INPUT_CONTEXT}}## Objectives
1. Apply refactoring in small, incremental steps
2. Run tests after each significant change
3. Preserve existing behavior
4. Improve code readability and maintainability

## Deliverables
Provide a summary containing:
- Files modified
- Refactoring steps applied
- Any issues encountered
- Test status after changes
`,
    },
    {
      id: `${workflowId}-verify`,
      name: 'Verify',
      status: 'pending',
      recommendedModel: 'sonnet',
      promptTemplate: `${header}## Phase: Verify Refactoring

{{INPUT_CONTEXT}}## Objectives
1. Run full test suite
2. Verify behavior is preserved
3. Check for any regressions
4. Validate code quality improvements

## Deliverables
Provide a summary containing:
- Test results (all must pass)
- Behavior verification checklist
- Code quality metrics (if available)
- Ready for commit status

Use the verification-before-completion skill.
`,
    },
  ];

  return {
    id: workflowId,
    type: 'refactor',
    name: `Refactor: ${input.taskTitle}`,
    taskId: input.taskId,
    projectName: input.projectName,
    phases,
    currentPhaseIndex: 0,
    status: 'pending',
    createdAt: new Date(),
  };
}

/**
 * WorkflowManager - Manages workflow execution and phase transitions
 */
export class WorkflowManager {
  private workflows: Map<string, Workflow> = new Map();

  /**
   * Create a new workflow of the specified type
   */
  createWorkflow(type: WorkflowType, input: WorkflowInput): Workflow {
    let workflow: Workflow;

    switch (type) {
      case 'bug_fix':
        workflow = createBugFixWorkflow(input);
        break;
      case 'feature':
        workflow = createFeatureWorkflow(input);
        break;
      case 'refactor':
        workflow = createRefactorWorkflow(input);
        break;
      default:
        throw new Error(`Unknown workflow type: ${type}`);
    }

    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  /**
   * Get a workflow by ID
   */
  getWorkflow(workflowId: string): Workflow | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get workflows by task ID
   */
  getWorkflowsByTask(taskId: string): Workflow[] {
    return Array.from(this.workflows.values()).filter((w) => w.taskId === taskId);
  }

  /**
   * Get the current phase of a workflow
   */
  getCurrentPhase(workflowId: string): WorkflowPhase | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || workflow.currentPhaseIndex >= workflow.phases.length) {
      return null;
    }
    return workflow.phases[workflow.currentPhaseIndex];
  }

  /**
   * Start a workflow (mark first phase as in_progress)
   */
  startWorkflow(workflowId: string): WorkflowPhase | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || workflow.status !== 'pending') {
      return null;
    }

    workflow.status = 'running';
    const firstPhase = workflow.phases[0];
    firstPhase.status = 'in_progress';
    firstPhase.startedAt = new Date();

    return firstPhase;
  }

  /**
   * Get the prompt for the current phase, with input context populated
   */
  getCurrentPhasePrompt(workflowId: string): string | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return null;
    }

    const currentPhase = workflow.phases[workflow.currentPhaseIndex];
    if (!currentPhase) {
      return null;
    }

    // Replace input context placeholder
    const inputContext = buildInputContext(currentPhase.inputSummary);
    return currentPhase.promptTemplate.replace('{{INPUT_CONTEXT}}', inputContext);
  }

  /**
   * Complete the current phase with a summary and advance to next
   */
  completePhase(workflowId: string, outputSummary: string): PhaseAdvanceResult {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return {
        success: false,
        currentPhase: null,
        workflowComplete: false,
        error: 'Workflow not found',
      };
    }

    const currentPhase = workflow.phases[workflow.currentPhaseIndex];
    if (!currentPhase || currentPhase.status !== 'in_progress') {
      return {
        success: false,
        currentPhase: null,
        workflowComplete: false,
        error: 'No phase in progress',
      };
    }

    // Complete current phase
    currentPhase.status = 'completed';
    currentPhase.completedAt = new Date();
    currentPhase.outputSummary = outputSummary;

    // Move to next phase
    workflow.currentPhaseIndex++;

    // Check if workflow is complete
    if (workflow.currentPhaseIndex >= workflow.phases.length) {
      workflow.status = 'completed';
      workflow.completedAt = new Date();
      return {
        success: true,
        currentPhase: null,
        workflowComplete: true,
      };
    }

    // Start next phase
    const nextPhase = workflow.phases[workflow.currentPhaseIndex];
    nextPhase.status = 'in_progress';
    nextPhase.startedAt = new Date();
    nextPhase.inputSummary = outputSummary; // Pass summary to next phase

    return {
      success: true,
      currentPhase: nextPhase,
      workflowComplete: false,
    };
  }

  /**
   * Fail the current phase with an error message
   */
  failPhase(workflowId: string, errorMessage: string): PhaseAdvanceResult {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return {
        success: false,
        currentPhase: null,
        workflowComplete: false,
        error: 'Workflow not found',
      };
    }

    const currentPhase = workflow.phases[workflow.currentPhaseIndex];
    if (!currentPhase || currentPhase.status !== 'in_progress') {
      return {
        success: false,
        currentPhase: null,
        workflowComplete: false,
        error: 'No phase in progress',
      };
    }

    currentPhase.status = 'failed';
    currentPhase.completedAt = new Date();
    currentPhase.errorMessage = errorMessage;
    workflow.status = 'failed';

    return {
      success: false,
      currentPhase,
      workflowComplete: false,
      error: errorMessage,
    };
  }

  /**
   * Skip the current phase and advance to next
   */
  skipPhase(workflowId: string, reason: string): PhaseAdvanceResult {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return {
        success: false,
        currentPhase: null,
        workflowComplete: false,
        error: 'Workflow not found',
      };
    }

    const currentPhase = workflow.phases[workflow.currentPhaseIndex];
    if (!currentPhase) {
      return {
        success: false,
        currentPhase: null,
        workflowComplete: false,
        error: 'No current phase',
      };
    }

    // Skip current phase
    currentPhase.status = 'skipped';
    currentPhase.completedAt = new Date();
    currentPhase.outputSummary = `Skipped: ${reason}`;

    // Move to next phase
    workflow.currentPhaseIndex++;

    // Check if workflow is complete
    if (workflow.currentPhaseIndex >= workflow.phases.length) {
      workflow.status = 'completed';
      workflow.completedAt = new Date();
      return {
        success: true,
        currentPhase: null,
        workflowComplete: true,
      };
    }

    // Start next phase (carry forward previous non-skipped summary)
    const nextPhase = workflow.phases[workflow.currentPhaseIndex];
    nextPhase.status = 'in_progress';
    nextPhase.startedAt = new Date();
    // Find last non-skipped phase's summary
    const lastCompletedPhase = workflow.phases
      .slice(0, workflow.currentPhaseIndex)
      .reverse()
      .find((p) => p.status === 'completed' && p.outputSummary);
    nextPhase.inputSummary = lastCompletedPhase?.outputSummary;

    return {
      success: true,
      currentPhase: nextPhase,
      workflowComplete: false,
    };
  }

  /**
   * Set the session ID for the current phase
   */
  setPhaseSession(workflowId: string, sessionId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return false;
    }

    const currentPhase = workflow.phases[workflow.currentPhaseIndex];
    if (!currentPhase || currentPhase.status !== 'in_progress') {
      return false;
    }

    currentPhase.sessionId = sessionId;
    return true;
  }

  /**
   * Get workflow progress summary
   */
  getProgress(workflowId: string): {
    completed: number;
    total: number;
    percentage: number;
    currentPhaseName: string | null;
  } | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return null;
    }

    const completed = workflow.phases.filter(
      (p) => p.status === 'completed' || p.status === 'skipped'
    ).length;
    const total = workflow.phases.length;

    return {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      currentPhaseName: workflow.phases[workflow.currentPhaseIndex]?.name || null,
    };
  }

  /**
   * Delete a workflow
   */
  deleteWorkflow(workflowId: string): boolean {
    return this.workflows.delete(workflowId);
  }

  /**
   * Clear all workflows
   */
  clear(): void {
    this.workflows.clear();
  }
}
