// Reporter module - Generates and sends status reports for TrafficControl

export {
  MetricsCollector,
  type ProjectMetrics,
  type SystemMetrics,
  type EstimateComparison,
  type TimePeriod
} from './metrics-collector.js';

export {
  RecommendationEngine,
  type Recommendation,
  type RecommendationType,
  type RecommendationPriority,
  type RecommendationReport,
  type RecommendationThresholds
} from './recommendation-engine.js';

export {
  Reporter,
  type ReporterConfig,
  type ReportResult,
  type GeneratedReport
} from './reporter.js';
