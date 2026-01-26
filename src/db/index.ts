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
