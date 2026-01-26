/**
 * TrafficControl Dashboard Module
 *
 * Provides a web-based dashboard for monitoring and controlling the
 * autonomous agent orchestration system.
 *
 * Features:
 * - Real-time system status monitoring
 * - Project and agent management
 * - Task queue visualization and control
 * - Recommendations and metrics display
 * - Server-Sent Events for live updates
 */

export { DashboardServer } from './server.js';
export type { DashboardServerConfig, SystemStatus, ProjectSummary } from './server.js';

export {
  createStatusHandler,
  createProjectsHandler,
  createProjectHandler,
  createAgentsHandler,
  createTasksHandler,
  createMetricsHandler,
  createRecommendationsHandler,
  createUpdateTaskPriorityHandler,
  createPauseProjectHandler,
  createResumeProjectHandler,
  calculateCost,
} from './routes/api.js';
