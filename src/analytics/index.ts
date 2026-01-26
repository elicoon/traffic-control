// Estimate Accuracy System
// Phase 4: Optimization - Tracks and improves estimation accuracy over time

export {
  EstimateTracker,
  EstimateRecord,
  CreateEstimateInput,
  EstimateHistoryFilter,
  Estimator
} from './estimate-tracker.js';

export {
  AccuracyAnalyzer,
  AccuracyMetrics,
  AccuracyBreakdown,
  TaskAccuracy,
  EstimationPatterns,
  CompletedTaskFilter
} from './accuracy-analyzer.js';

export {
  CalibrationEngine,
  CalibrationFactor,
  CalibratedEstimate,
  CalibrationInput
} from './calibration-engine.js';

// Priority Scoring and Resource Allocation
// Phase 4: Optimization - Prioritization engine

export {
  PriorityScorer,
  PriorityScore,
  PriorityFactor,
  ScoringConfig,
  HistoricalAccuracy,
  ScoringContext,
} from './priority-scorer.js';

export {
  ResourceAllocator,
  ProjectStats,
  ResourceAllocation,
  TaskComplexityDistribution,
  AllocationContext,
  ModelMix,
  ResourceGap,
} from './resource-allocator.js';

export {
  RecommendationGenerator,
  RecommendationType,
  RecommendationPriority,
  Recommendation,
  RecommendationContext,
  RecommendationSummary,
} from './recommendation-generator.js';

// ROI Tracking System
// Phase 4: Optimization - Tracks costs, ROI, and budgets

export {
  CostTracker,
  type ModelPricing,
  type CostCalculation,
  type SessionCostSummary,
  type CostEstimateInput,
  type CostEstimate,
  type AddPricingInput,
} from './cost-tracker.js';

export {
  ROICalculator,
  type ROIMetrics,
  type TaskROIInput,
  type ProjectROIInput,
  type OverallROIInput,
  type EstimateAccuracy,
  type EstimateComparison,
} from './roi-calculator.js';

export {
  BudgetTracker,
  type Budget,
  type BudgetStatus,
  type BudgetPeriodType,
  type CreateBudgetInput,
  type UpdateBudgetInput,
  type BudgetAlert,
} from './budget-tracker.js';
