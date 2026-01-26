import { SupabaseClient } from '@supabase/supabase-js';
import { Task } from '../db/repositories/tasks.js';

export interface CalibrationFactor {
  id?: string;
  projectId?: string;
  complexity?: string;
  taskType?: string;
  sessionsMultiplier: number;
  interventionMultiplier: number;
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  lastUpdated?: Date;
}

export interface CalibratedEstimate {
  originalEstimate: {
    sessionsOpus: number;
    sessionsSonnet: number;
    interventionMinutes: number;
  };
  calibratedEstimate: {
    sessionsOpus: number;
    sessionsSonnet: number;
    interventionMinutes: number;
  };
  calibrationApplied: CalibrationFactor;
}

export interface CalibrationInput {
  projectId?: string;
  complexity?: string;
  taskType?: string;
  sessionsOpus: number;
  sessionsSonnet: number;
  interventionMinutes?: number;
}

interface DbCalibrationFactor {
  id: string;
  project_id: string | null;
  complexity: string | null;
  task_type: string | null;
  sessions_multiplier: string;
  intervention_multiplier: string;
  sample_size: number;
  last_updated: string;
}

// Minimum sample size before providing calibration
const MIN_SAMPLE_SIZE = 5;
// Sample size thresholds for confidence levels
const MEDIUM_CONFIDENCE_THRESHOLD = 10;
const HIGH_CONFIDENCE_THRESHOLD = 20;

/**
 * Generates calibration recommendations based on historical accuracy data.
 * Calculates multipliers to apply to future estimates for improved accuracy.
 */
export class CalibrationEngine {
  constructor(private client: SupabaseClient) {}

  /**
   * Calculates calibration factors for a project based on completed tasks.
   */
  async calculateCalibrationFactors(projectId: string): Promise<CalibrationFactor[]> {
    const tasks = await this.getCompletedTasks(projectId);

    if (tasks.length === 0) {
      return [];
    }

    const factors: CalibrationFactor[] = [];
    const complexities = ['low', 'medium', 'high'];

    for (const complexity of complexities) {
      const complexityTasks = tasks.filter(t => t.complexity_estimate === complexity);

      if (complexityTasks.length > 0) {
        const factor = this.calculateFactorForTasks(complexityTasks, projectId, complexity);
        factors.push(factor);
      }
    }

    return factors;
  }

  /**
   * Calculates global calibration factors across all projects.
   */
  async calculateGlobalCalibrationFactors(): Promise<CalibrationFactor[]> {
    const { data: tasks, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('status', 'complete')
      .not('completed_at', 'is', null);

    if (error) throw new Error(`Failed to get completed tasks: ${error.message}`);
    if (!tasks || tasks.length === 0) return [];

    const factors: CalibrationFactor[] = [];
    const complexities = ['low', 'medium', 'high'];

    for (const complexity of complexities) {
      const complexityTasks = (tasks as Task[]).filter(t => t.complexity_estimate === complexity);

      if (complexityTasks.length > 0) {
        const factor = this.calculateFactorForTasks(complexityTasks, undefined, complexity);
        factors.push(factor);
      }
    }

    return factors;
  }

  /**
   * Gets a calibration factor for a specific project and complexity.
   */
  async getCalibrationFactor(
    projectId: string,
    complexity: string
  ): Promise<CalibrationFactor | null> {
    const { data, error } = await this.client
      .from('tc_calibration_factors')
      .select()
      .eq('project_id', projectId)
      .eq('complexity', complexity)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get calibration factor: ${error.message}`);
    }

    return data ? this.mapToCalibrationFactor(data as DbCalibrationFactor) : null;
  }

  /**
   * Gets all calibration factors for a project.
   */
  async getProjectCalibrationFactors(projectId: string): Promise<CalibrationFactor[]> {
    const { data, error } = await this.client
      .from('tc_calibration_factors')
      .select()
      .eq('project_id', projectId)
      .order('complexity');

    if (error) throw new Error(`Failed to get calibration factors: ${error.message}`);
    return (data as DbCalibrationFactor[]).map(d => this.mapToCalibrationFactor(d));
  }

  /**
   * Calibrates an estimate using historical data.
   */
  async calibrateEstimate(input: CalibrationInput): Promise<CalibratedEstimate> {
    const originalEstimate = {
      sessionsOpus: input.sessionsOpus,
      sessionsSonnet: input.sessionsSonnet,
      interventionMinutes: input.interventionMinutes ?? 0
    };

    // Get calibration factor
    let factor: CalibrationFactor | null = null;

    if (input.projectId && input.complexity) {
      factor = await this.getCalibrationFactor(input.projectId, input.complexity);
    }

    // If no stored factor, try to calculate one
    if (!factor && input.projectId) {
      const factors = await this.calculateCalibrationFactors(input.projectId);
      factor = factors.find(f => f.complexity === input.complexity) ?? null;
    }

    // Use default factor if none available
    const calibrationFactor = factor ?? this.defaultFactor();

    const calibratedEstimate = {
      sessionsOpus: Math.round(originalEstimate.sessionsOpus * calibrationFactor.sessionsMultiplier),
      sessionsSonnet: Math.round(originalEstimate.sessionsSonnet * calibrationFactor.sessionsMultiplier),
      interventionMinutes: Math.round(originalEstimate.interventionMinutes * calibrationFactor.interventionMultiplier)
    };

    return {
      originalEstimate,
      calibratedEstimate,
      calibrationApplied: calibrationFactor
    };
  }

  /**
   * Saves calibration factors to the database.
   */
  async saveCalibrationFactors(projectId: string): Promise<CalibrationFactor[]> {
    const factors = await this.calculateCalibrationFactors(projectId);

    const savedFactors: CalibrationFactor[] = [];

    for (const factor of factors) {
      const { data, error } = await this.client
        .from('tc_calibration_factors')
        .upsert(
          {
            project_id: projectId,
            complexity: factor.complexity,
            task_type: factor.taskType ?? null,
            sessions_multiplier: factor.sessionsMultiplier,
            intervention_multiplier: factor.interventionMultiplier,
            sample_size: factor.sampleSize,
            last_updated: new Date().toISOString()
          },
          {
            onConflict: 'project_id,complexity,task_type'
          }
        )
        .select()
        .single();

      if (error) throw new Error(`Failed to save calibration factor: ${error.message}`);
      savedFactors.push(this.mapToCalibrationFactor(data as DbCalibrationFactor));
    }

    return savedFactors;
  }

  /**
   * Clears calibration factors for a project.
   */
  async clearCalibrationFactors(projectId: string): Promise<void> {
    const { error } = await this.client
      .from('tc_calibration_factors')
      .delete()
      .eq('project_id', projectId);

    if (error) throw new Error(`Failed to clear calibration factors: ${error.message}`);
  }

  /**
   * Gets completed tasks for a project.
   */
  private async getCompletedTasks(projectId: string): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('project_id', projectId)
      .eq('status', 'complete')
      .not('completed_at', 'is', null);

    if (error) throw new Error(`Failed to get completed tasks: ${error.message}`);
    return (data as Task[]) || [];
  }

  /**
   * Calculates calibration factor for a set of tasks.
   */
  private calculateFactorForTasks(
    tasks: Task[],
    projectId?: string,
    complexity?: string
  ): CalibrationFactor {
    const sampleSize = tasks.length;

    // If sample size is below minimum, return default factor
    if (sampleSize < MIN_SAMPLE_SIZE) {
      return {
        projectId,
        complexity,
        sessionsMultiplier: 1.0,
        interventionMultiplier: 1.0,
        sampleSize,
        confidence: 'low'
      };
    }

    // Calculate actual vs estimated ratios
    const ratios = tasks.map(task => {
      const estimated = (task.estimated_sessions_opus ?? 0) + (task.estimated_sessions_sonnet ?? 0);
      const actual = (task.actual_sessions_opus ?? 0) + (task.actual_sessions_sonnet ?? 0);

      if (estimated === 0) return 1.0;
      return actual / estimated;
    });

    // Use median ratio as the multiplier (more robust to outliers)
    const sortedRatios = [...ratios].sort((a, b) => a - b);
    const medianRatio = sortedRatios[Math.floor(sortedRatios.length / 2)];

    // Clamp the multiplier to reasonable bounds (0.5 to 3.0)
    const sessionsMultiplier = Math.max(0.5, Math.min(3.0, medianRatio));

    return {
      projectId,
      complexity,
      sessionsMultiplier: Math.round(sessionsMultiplier * 1000) / 1000,
      interventionMultiplier: 1.0, // Placeholder for future intervention calibration
      sampleSize,
      confidence: this.determineConfidence(sampleSize)
    };
  }

  /**
   * Determines confidence level based on sample size.
   */
  private determineConfidence(sampleSize: number): 'low' | 'medium' | 'high' {
    if (sampleSize >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
    if (sampleSize >= MEDIUM_CONFIDENCE_THRESHOLD) return 'medium';
    return 'low';
  }

  /**
   * Returns a default calibration factor (no adjustment).
   */
  private defaultFactor(): CalibrationFactor {
    return {
      sessionsMultiplier: 1.0,
      interventionMultiplier: 1.0,
      sampleSize: 0,
      confidence: 'low'
    };
  }

  /**
   * Maps database record to CalibrationFactor interface.
   */
  private mapToCalibrationFactor(data: DbCalibrationFactor): CalibrationFactor {
    const sampleSize = data.sample_size;
    return {
      id: data.id,
      projectId: data.project_id ?? undefined,
      complexity: data.complexity ?? undefined,
      taskType: data.task_type ?? undefined,
      sessionsMultiplier: parseFloat(data.sessions_multiplier),
      interventionMultiplier: parseFloat(data.intervention_multiplier),
      sampleSize,
      confidence: this.determineConfidence(sampleSize),
      lastUpdated: new Date(data.last_updated)
    };
  }
}
