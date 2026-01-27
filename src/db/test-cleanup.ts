/**
 * Test Data Cleanup Utilities
 *
 * Provides functions to identify and remove test data from the database.
 * Used both for cleaning up after tests and for maintaining the production database.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from './client.js';
import { Task } from './repositories/tasks.js';
import { logger } from '../logging/index.js';

const log = logger.child('TestCleanup');

/**
 * Test data identification prefix - use this in test files when creating test data
 */
export const TEST_PREFIX = 'TEST_';

/**
 * Patterns that identify test tasks by title
 */
const TEST_TITLE_PATTERNS = [
  /^TEST_/i,                           // Starts with TEST_
  /test\s*task/i,                      // Contains "test task"
  /calibration\s*test/i,               // Contains "calibration test"
  /^queued\s*task$/i,                  // Exact match "Queued Task"
  /^completed\s*task$/i,               // Exact match "Completed Task"
  /^normal\s*task$/i,                  // Exact match "Normal Task"
  /^high\s*priority\s*task$/i,         // Exact match "High Priority Task"
  /^low\s*priority\s*task$/i,          // Exact match "Low Priority Task"
  /test\s*project$/i,                  // Ends with "Test Project"
  /for\s*integration$/i,               // Ends with "for integration"
  /for\s*retrospective$/i,             // Ends with "for retrospective"
  /for\s*estimates$/i,                 // Ends with "for estimates"
  /visual\s*review\s*test/i,           // Contains "visual review test"
  /below\s*threshold/i,                // Contains "below threshold"
  /at\s*threshold/i,                   // Contains "at threshold"
];

/**
 * Sources that indicate test data
 */
const TEST_SOURCES = ['test'];

/**
 * Check if a task is test data based on its properties
 */
export function isTestTask(task: Task): boolean {
  // Check source
  if (TEST_SOURCES.includes(task.source)) {
    return true;
  }

  // Check title patterns
  for (const pattern of TEST_TITLE_PATTERNS) {
    if (pattern.test(task.title)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a title matches test data patterns
 */
export function isTestTitle(title: string): boolean {
  for (const pattern of TEST_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return true;
    }
  }
  return false;
}

/**
 * Result of a cleanup operation
 */
export interface CleanupResult {
  tasksDeleted: number;
  retrospectivesDeleted: number;
  estimatesHistoryDeleted: number;
  visualReviewsDeleted: number;
  calibrationFactorsDeleted: number;
  projectsDeleted: number;
  totalDeleted: number;
  errors: string[];
}

/**
 * Get count of test tasks in the database
 */
export async function getTestTaskCount(client?: SupabaseClient): Promise<number> {
  const supabase = client || createSupabaseClient();

  const { data, error } = await supabase
    .from('tc_tasks')
    .select('id, title, source');

  if (error) {
    log.error('Failed to count test tasks', { error: error.message });
    throw new Error(`Failed to count test tasks: ${error.message}`);
  }

  const testTasks = data.filter(task => isTestTask(task as Task));
  return testTasks.length;
}

/**
 * Get all test task IDs from the database
 */
export async function getTestTaskIds(client?: SupabaseClient): Promise<string[]> {
  const supabase = client || createSupabaseClient();

  const { data, error } = await supabase
    .from('tc_tasks')
    .select('id, title, source');

  if (error) {
    log.error('Failed to get test tasks', { error: error.message });
    throw new Error(`Failed to get test tasks: ${error.message}`);
  }

  return data.filter(task => isTestTask(task as Task)).map(task => task.id);
}

/**
 * Clean up all test data from the database
 *
 * This function:
 * 1. Identifies test tasks by title patterns and source
 * 2. Deletes related data in dependent tables (retrospectives, estimates, visual reviews)
 * 3. Deletes the test tasks
 * 4. Deletes test projects (projects with names ending in "Test Project")
 *
 * @param client - Optional Supabase client (uses default if not provided)
 * @returns Cleanup result with counts of deleted records
 */
export async function cleanTestData(client?: SupabaseClient): Promise<CleanupResult> {
  const supabase = client || createSupabaseClient();
  const result: CleanupResult = {
    tasksDeleted: 0,
    retrospectivesDeleted: 0,
    estimatesHistoryDeleted: 0,
    visualReviewsDeleted: 0,
    calibrationFactorsDeleted: 0,
    projectsDeleted: 0,
    totalDeleted: 0,
    errors: [],
  };

  log.info('Starting test data cleanup');

  try {
    // Get test task IDs
    const testTaskIds = await getTestTaskIds(supabase);

    if (testTaskIds.length === 0) {
      log.info('No test data found to clean up');
      return result;
    }

    log.info('Found test tasks to delete', { count: testTaskIds.length });

    // Delete related data first (foreign key dependencies)

    // 1. Delete retrospectives for test tasks
    try {
      const { data: retroData, error: retroError } = await supabase
        .from('tc_retrospectives')
        .delete()
        .in('task_id', testTaskIds)
        .select('id');

      if (retroError) {
        result.errors.push(`Failed to delete retrospectives: ${retroError.message}`);
        log.warn('Failed to delete retrospectives', { error: retroError.message });
      } else {
        result.retrospectivesDeleted = retroData?.length || 0;
        log.debug('Deleted retrospectives', { count: result.retrospectivesDeleted });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Retrospectives deletion error: ${msg}`);
    }

    // 2. Delete estimates history for test tasks
    try {
      const { data: estData, error: estError } = await supabase
        .from('tc_estimates_history')
        .delete()
        .in('task_id', testTaskIds)
        .select('id');

      if (estError) {
        result.errors.push(`Failed to delete estimates history: ${estError.message}`);
        log.warn('Failed to delete estimates history', { error: estError.message });
      } else {
        result.estimatesHistoryDeleted = estData?.length || 0;
        log.debug('Deleted estimates history', { count: result.estimatesHistoryDeleted });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Estimates history deletion error: ${msg}`);
    }

    // 3. Delete visual reviews for test tasks
    try {
      const { data: vrData, error: vrError } = await supabase
        .from('tc_visual_reviews')
        .delete()
        .in('task_id', testTaskIds)
        .select('id');

      if (vrError) {
        result.errors.push(`Failed to delete visual reviews: ${vrError.message}`);
        log.warn('Failed to delete visual reviews', { error: vrError.message });
      } else {
        result.visualReviewsDeleted = vrData?.length || 0;
        log.debug('Deleted visual reviews', { count: result.visualReviewsDeleted });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Visual reviews deletion error: ${msg}`);
    }

    // 4. Delete test tasks
    try {
      const { data: taskData, error: taskError } = await supabase
        .from('tc_tasks')
        .delete()
        .in('id', testTaskIds)
        .select('id');

      if (taskError) {
        result.errors.push(`Failed to delete tasks: ${taskError.message}`);
        log.error('Failed to delete test tasks', { error: taskError.message });
      } else {
        result.tasksDeleted = taskData?.length || 0;
        log.info('Deleted test tasks', { count: result.tasksDeleted });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Tasks deletion error: ${msg}`);
    }

    // 5. Get test project IDs for cleanup
    const { data: testProjects } = await supabase
      .from('tc_projects')
      .select('id')
      .or('name.ilike.%Test Project%,name.ilike.TEST_%');

    const testProjectIds = testProjects?.map(p => p.id) || [];

    if (testProjectIds.length > 0) {
      // 5a. Delete calibration factors for test projects
      try {
        const { data: cfData, error: cfError } = await supabase
          .from('tc_calibration_factors')
          .delete()
          .in('project_id', testProjectIds)
          .select('id');

        if (cfError) {
          result.errors.push(`Failed to delete calibration factors: ${cfError.message}`);
          log.warn('Failed to delete calibration factors', { error: cfError.message });
        } else {
          result.calibrationFactorsDeleted = cfData?.length || 0;
          log.debug('Deleted calibration factors', { count: result.calibrationFactorsDeleted });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Calibration factors deletion error: ${msg}`);
      }

      // 5b. Delete retrospectives for test projects (not just test tasks)
      try {
        const { data: retroProjData, error: retroProjError } = await supabase
          .from('tc_retrospectives')
          .delete()
          .in('project_id', testProjectIds)
          .select('id');

        if (!retroProjError && retroProjData) {
          result.retrospectivesDeleted += retroProjData.length;
          log.debug('Deleted project retrospectives', { count: retroProjData.length });
        }
      } catch (err) {
        // Ignore - already counted
      }

      // 5c. Delete tasks belonging to test projects
      try {
        const { data: taskProjData, error: taskProjError } = await supabase
          .from('tc_tasks')
          .delete()
          .in('project_id', testProjectIds)
          .select('id');

        if (!taskProjError && taskProjData) {
          result.tasksDeleted += taskProjData.length;
          log.debug('Deleted project tasks', { count: taskProjData.length });
        }
      } catch (err) {
        // Ignore - already counted
      }

      // 5d. Delete test projects
      try {
        const { data: projData, error: projError } = await supabase
          .from('tc_projects')
          .delete()
          .in('id', testProjectIds)
          .select('id');

        if (projError) {
          result.errors.push(`Failed to delete test projects: ${projError.message}`);
          log.warn('Failed to delete test projects', { error: projError.message });
        } else {
          result.projectsDeleted = projData?.length || 0;
          log.debug('Deleted test projects', { count: result.projectsDeleted });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Projects deletion error: ${msg}`);
      }
    }

    result.totalDeleted =
      result.tasksDeleted +
      result.retrospectivesDeleted +
      result.estimatesHistoryDeleted +
      result.visualReviewsDeleted +
      result.calibrationFactorsDeleted +
      result.projectsDeleted;

    log.info('Test data cleanup complete', {
      tasksDeleted: result.tasksDeleted,
      retrospectivesDeleted: result.retrospectivesDeleted,
      estimatesHistoryDeleted: result.estimatesHistoryDeleted,
      visualReviewsDeleted: result.visualReviewsDeleted,
      calibrationFactorsDeleted: result.calibrationFactorsDeleted,
      projectsDeleted: result.projectsDeleted,
      totalDeleted: result.totalDeleted,
      errors: result.errors.length,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Cleanup failed: ${msg}`);
    log.error('Test data cleanup failed', err instanceof Error ? err : undefined);
  }

  return result;
}

/**
 * Pre-flight check for test data
 * Returns warning information if test data is detected
 */
export async function checkForTestData(client?: SupabaseClient): Promise<{
  hasTestData: boolean;
  testTaskCount: number;
  warning: string | null;
}> {
  const supabase = client || createSupabaseClient();

  try {
    const count = await getTestTaskCount(supabase);

    if (count > 0) {
      return {
        hasTestData: true,
        testTaskCount: count,
        warning: `WARNING: ${count} test task(s) detected in database. Run 'npm run cleanup:test-data' to remove.`,
      };
    }

    return {
      hasTestData: false,
      testTaskCount: 0,
      warning: null,
    };
  } catch (err) {
    log.error('Failed to check for test data', err instanceof Error ? err : undefined);
    return {
      hasTestData: false,
      testTaskCount: 0,
      warning: null,
    };
  }
}

/**
 * Delete tasks by IDs (used by test cleanup in afterAll hooks)
 */
export async function deleteTasksByIds(taskIds: string[], client?: SupabaseClient): Promise<number> {
  if (taskIds.length === 0) return 0;

  const supabase = client || createSupabaseClient();

  // Delete related data first
  await supabase.from('tc_retrospectives').delete().in('task_id', taskIds);
  await supabase.from('tc_estimates_history').delete().in('task_id', taskIds);
  await supabase.from('tc_visual_reviews').delete().in('task_id', taskIds);

  // Delete tasks
  const { data, error } = await supabase
    .from('tc_tasks')
    .delete()
    .in('id', taskIds)
    .select('id');

  if (error) {
    log.error('Failed to delete tasks', { error: error.message, taskIds });
    throw new Error(`Failed to delete tasks: ${error.message}`);
  }

  return data?.length || 0;
}

/**
 * CLI entry point for test data cleanup
 * Can be run with: npm run cleanup:test-data
 */
export async function runCleanup(): Promise<void> {
  console.log('TrafficControl - Test Data Cleanup\n');
  console.log('Checking for test data...\n');

  try {
    const check = await checkForTestData();

    if (!check.hasTestData) {
      console.log('No test data found in database.');
      return;
    }

    console.log(`Found ${check.testTaskCount} test task(s) to clean up.`);
    console.log('\nCleaning up test data...\n');

    const result = await cleanTestData();

    console.log('Cleanup Results:');
    console.log(`  Tasks deleted:              ${result.tasksDeleted}`);
    console.log(`  Retrospectives deleted:     ${result.retrospectivesDeleted}`);
    console.log(`  Estimates history deleted:  ${result.estimatesHistoryDeleted}`);
    console.log(`  Visual reviews deleted:     ${result.visualReviewsDeleted}`);
    console.log(`  Calibration factors deleted: ${result.calibrationFactorsDeleted}`);
    console.log(`  Projects deleted:           ${result.projectsDeleted}`);
    console.log(`  Total deleted:              ${result.totalDeleted}`);

    if (result.errors.length > 0) {
      console.log('\nErrors encountered:');
      for (const err of result.errors) {
        console.log(`  - ${err}`);
      }
    }

    console.log('\nCleanup complete.');
  } catch (err) {
    console.error('Cleanup failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
