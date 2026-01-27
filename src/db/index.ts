// Database module exports
export {
  createSupabaseClient,
  getClient,
  testConnection,
  resetClient,
} from './client.js';

// Repository exports
export {
  ProjectRepository,
  TaskRepository,
} from './repositories/index.js';

export type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  RecordUsageInput,
} from './repositories/index.js';

// Test cleanup utilities
export {
  TEST_PREFIX,
  isTestTask,
  isTestTitle,
  cleanTestData,
  getTestTaskCount,
  getTestTaskIds,
  checkForTestData,
  deleteTasksByIds,
  runCleanup,
} from './test-cleanup.js';

export type { CleanupResult } from './test-cleanup.js';
