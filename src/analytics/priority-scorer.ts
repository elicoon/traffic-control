import { Task } from '../db/repositories/tasks.js';
import { CapacityStats } from '../scheduler/capacity-tracker.js';

/**
 * A single factor contributing to the priority score.
 */
export interface PriorityFactor {
  name: string;
  weight: number;
  rawValue: number;
  normalizedValue: number;
  explanation: string;
}

/**
 * Complete priority score for a task.
 */
export interface PriorityScore {
  taskId: string;
  totalScore: number;
  impactScore: number;
  urgencyScore: number;
  efficiencyScore: number;
  dependencyScore: number;
  factors: PriorityFactor[];
  calculatedAt: Date;
}

/**
 * Configuration for scoring weights.
 */
export interface ScoringConfig {
  impactWeight: number;
  urgencyWeight: number;
  efficiencyWeight: number;
  dependencyWeight: number;
}

/**
 * Historical accuracy data for efficiency calculations.
 */
export interface HistoricalAccuracy {
  estimated: number;
  actual: number;
}

/**
 * Context needed for scoring tasks.
 */
export interface ScoringContext {
  allTasks: Task[];
  historicalAccuracy: HistoricalAccuracy[];
  capacityStats: CapacityStats;
  projectBacklogSize: number;
  isUnderutilizedProject?: boolean;
}

/**
 * Default scoring configuration following the algorithm spec:
 * - Impact Score (40%): Based on task's complexity (high=100, medium=60, low=30)
 * - Urgency Score (25%): Based on age in queue + explicit priority
 * - Efficiency Score (20%): Based on historical accuracy for similar tasks
 * - Dependency Score (15%): Higher if task is blocking other work
 */
const DEFAULT_CONFIG: ScoringConfig = {
  impactWeight: 0.40,
  urgencyWeight: 0.25,
  efficiencyWeight: 0.20,
  dependencyWeight: 0.15,
};

/**
 * Low backlog threshold - projects below this get a priority boost.
 */
const LOW_BACKLOG_THRESHOLD = 3;

/**
 * Adjustment values.
 */
const LOW_BACKLOG_BOOST = 20;
const UNDERUTILIZED_PROJECT_BOOST = 10;
const OPUS_AT_CAPACITY_PENALTY = 10;

/**
 * Scores for complexity levels.
 */
const COMPLEXITY_SCORES: Record<string, number> = {
  high: 100,
  complex: 100,
  medium: 60,
  moderate: 60,
  low: 30,
  simple: 30,
};

/**
 * PriorityScorer calculates priority scores for tasks based on multiple factors.
 */
export class PriorityScorer {
  private config: ScoringConfig;

  constructor(config: Partial<ScoringConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the current scoring configuration.
   */
  getConfig(): ScoringConfig {
    return { ...this.config };
  }

  /**
   * Calculate the impact score based on task complexity.
   * High = 100, Medium = 60, Low = 30
   */
  calculateImpactScore(task: Task): number {
    if (!task.complexity_estimate) {
      return 60; // Default to medium
    }

    const complexity = task.complexity_estimate.toLowerCase();
    return COMPLEXITY_SCORES[complexity] ?? 60;
  }

  /**
   * Calculate urgency score based on age in queue and explicit priority.
   * Older tasks and higher priority tasks score higher.
   */
  calculateUrgencyScore(task: Task): number {
    const now = Date.now();
    const createdAt = new Date(task.created_at).getTime();
    const ageInDays = (now - createdAt) / (1000 * 60 * 60 * 24);

    // Age component: 5 points per day, capped at 50
    const ageScore = Math.min(50, ageInDays * 5);

    // Priority component: scale 0-10 priority to 0-50 score
    const priorityScore = (task.priority / 10) * 50;

    // Combine and cap at 100
    return Math.min(100, ageScore + priorityScore);
  }

  /**
   * Calculate efficiency score based on historical accuracy of estimates.
   * Tasks from projects with accurate estimates get higher scores.
   */
  calculateEfficiencyScore(task: Task, history: HistoricalAccuracy[]): number {
    if (history.length === 0) {
      return 50; // Default middle score when no history
    }

    // Calculate average accuracy ratio
    let totalAccuracy = 0;
    for (const entry of history) {
      if (entry.estimated > 0) {
        // Accuracy as percentage (100% = perfect estimate)
        // If actual <= estimated, accuracy is high
        // If actual > estimated, accuracy decreases
        const ratio = entry.estimated / Math.max(entry.actual, 1);
        const accuracy = Math.min(1, ratio) * 100;
        totalAccuracy += accuracy;
      }
    }

    const avgAccuracy = totalAccuracy / history.length;
    return Math.min(100, avgAccuracy);
  }

  /**
   * Calculate dependency score based on how many tasks this task is blocking.
   * Tasks blocking more work get higher priority.
   */
  calculateDependencyScore(task: Task, allBlockedTasks: Task[]): number {
    // Count how many tasks this task is blocking
    const blockingCount = allBlockedTasks.filter(
      t => t.blocked_by_task_id === task.id
    ).length;

    if (blockingCount === 0) {
      return 0;
    }

    // 20 points per blocked task, capped at 100
    return Math.min(100, blockingCount * 20);
  }

  /**
   * Apply adjustments based on context:
   * - +20 if project has low backlog (needs work to keep agents busy)
   * - +10 if task is from currently underutilized project
   * - -10 if task complexity is high and Opus is at capacity
   */
  applyAdjustments(baseScore: number, task: Task, context: ScoringContext): number {
    let adjustedScore = baseScore;

    // Low backlog boost
    if (context.projectBacklogSize < LOW_BACKLOG_THRESHOLD) {
      adjustedScore += LOW_BACKLOG_BOOST;
    }

    // Underutilized project boost
    if (context.isUnderutilizedProject) {
      adjustedScore += UNDERUTILIZED_PROJECT_BOOST;
    }

    // Opus capacity penalty for complex tasks
    const isComplexTask =
      task.complexity_estimate?.toLowerCase() === 'high' ||
      task.complexity_estimate?.toLowerCase() === 'complex';

    const opusAtCapacity =
      context.capacityStats.opus.utilization >= 1.0 ||
      context.capacityStats.opus.available === 0;

    if (isComplexTask && opusAtCapacity) {
      adjustedScore -= OPUS_AT_CAPACITY_PENALTY;
    }

    // Clamp to valid range
    return Math.max(0, Math.min(100, adjustedScore));
  }

  /**
   * Calculate the complete priority score for a task.
   */
  calculatePriorityScore(task: Task, context: ScoringContext): PriorityScore {
    // Calculate individual scores
    const impactScore = this.calculateImpactScore(task);
    const urgencyScore = this.calculateUrgencyScore(task);
    const efficiencyScore = this.calculateEfficiencyScore(task, context.historicalAccuracy);

    // Get all blocked tasks to calculate dependency
    const blockedTasks = context.allTasks.filter(t => t.status === 'blocked');
    const dependencyScore = this.calculateDependencyScore(task, blockedTasks);

    // Build factors array with explanations
    const factors: PriorityFactor[] = [
      {
        name: 'impact',
        weight: this.config.impactWeight,
        rawValue: impactScore,
        normalizedValue: impactScore,
        explanation: `Complexity: ${task.complexity_estimate || 'medium'} (score: ${impactScore})`,
      },
      {
        name: 'urgency',
        weight: this.config.urgencyWeight,
        rawValue: urgencyScore,
        normalizedValue: urgencyScore,
        explanation: `Priority: ${task.priority}, Age-based urgency score: ${urgencyScore.toFixed(1)}`,
      },
      {
        name: 'efficiency',
        weight: this.config.efficiencyWeight,
        rawValue: efficiencyScore,
        normalizedValue: efficiencyScore,
        explanation: context.historicalAccuracy.length > 0
          ? `Historical accuracy: ${efficiencyScore.toFixed(1)}%`
          : 'No historical data, using default score',
      },
      {
        name: 'dependency',
        weight: this.config.dependencyWeight,
        rawValue: dependencyScore,
        normalizedValue: dependencyScore,
        explanation: dependencyScore > 0
          ? `Blocking ${dependencyScore / 20} other task(s)`
          : 'Not blocking any tasks',
      },
    ];

    // Calculate weighted base score
    const baseScore =
      impactScore * this.config.impactWeight +
      urgencyScore * this.config.urgencyWeight +
      efficiencyScore * this.config.efficiencyWeight +
      dependencyScore * this.config.dependencyWeight;

    // Apply adjustments
    const totalScore = this.applyAdjustments(baseScore, task, context);

    return {
      taskId: task.id,
      totalScore,
      impactScore,
      urgencyScore,
      efficiencyScore,
      dependencyScore,
      factors,
      calculatedAt: new Date(),
    };
  }

  /**
   * Score multiple tasks and sort by priority (highest first).
   */
  scoreTasks(tasks: Task[], context: ScoringContext): PriorityScore[] {
    const scores = tasks.map(task => this.calculatePriorityScore(task, context));

    // Sort by total score descending
    scores.sort((a, b) => b.totalScore - a.totalScore);

    return scores;
  }

  /**
   * Get the top N priority tasks.
   */
  getTopPriorityTasks(tasks: Task[], context: ScoringContext, n: number): PriorityScore[] {
    const scores = this.scoreTasks(tasks, context);
    return scores.slice(0, n);
  }
}
