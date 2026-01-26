# Phase 4: Optimization - Parallel Implementation Prompts

**Date:** 2026-01-26
**Phase:** 4 - Optimization
**Prerequisites:** Phase 1 (Foundation), Phase 2 (Automation), and Phase 3 (Learning) completed

---

## Overview

Phase 4 implements optimization and visibility features:
1. ROI tracking with cost analysis
2. Estimate accuracy improvement system
3. Prioritization engine for resource allocation
4. Web dashboard for monitoring

---

## Instance 1: ROI Tracking

### Context
You are implementing the ROI tracking system for TrafficControl. This system tracks actual costs, compares to estimates, and calculates return on investment for agent work.

### Your Task
Build the ROI tracking system that:
1. Tracks actual dollar costs per session (using pricing at time of use)
2. Compares estimates vs actuals for sessions and costs
3. Calculates ROI metrics per task, project, and overall
4. Provides cost projections and budget tracking

### Files to Create
- `src/analytics/cost-tracker.ts` - Tracks costs with pricing lookup
- `src/analytics/roi-calculator.ts` - Calculates ROI metrics
- `src/analytics/budget-tracker.ts` - Budget management and projections
- `src/analytics/index.ts` - Module exports
- Tests for each file

### Database Schema
Add this migration:
```sql
-- Model pricing table (for historical accuracy)
CREATE TABLE tc_model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model TEXT NOT NULL,
  input_price_per_million DECIMAL(10, 6) NOT NULL,
  output_price_per_million DECIMAL(10, 6) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMPTZ,
  UNIQUE(model, effective_from)
);

-- Insert current pricing (as of 2026-01)
INSERT INTO tc_model_pricing (model, input_price_per_million, output_price_per_million) VALUES
  ('opus', 15.0, 75.0),
  ('sonnet', 3.0, 15.0),
  ('haiku', 0.25, 1.25);

-- Budget configuration
CREATE TABLE tc_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES tc_projects(id),
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
  budget_usd DECIMAL(10, 2) NOT NULL,
  alert_threshold_percent INTEGER DEFAULT 80,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE tc_model_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for tc_model_pricing" ON tc_model_pricing FOR ALL USING (true);
CREATE POLICY "Allow all for tc_budgets" ON tc_budgets FOR ALL USING (true);
```

### Key Interfaces
```typescript
interface ModelPricing {
  model: 'opus' | 'sonnet' | 'haiku';
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  effectiveFrom: Date;
  effectiveUntil?: Date;
}

interface CostCalculation {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  model: string;
  pricingDate: Date;
}

interface ROIMetrics {
  taskId?: string;
  projectId?: string;

  // Estimates
  estimatedSessions: number;
  estimatedCost: number;

  // Actuals
  actualSessions: number;
  actualCost: number;
  actualTokens: { input: number; output: number };

  // ROI calculations
  costVariance: number;  // (actual - estimated) / estimated
  sessionVariance: number;
  efficiency: number;  // 1 = on target, >1 = over budget, <1 = under budget

  // Time metrics
  totalDurationMinutes: number;
  interventionMinutes: number;
  automatedMinutes: number;
}

interface BudgetStatus {
  projectId?: string;
  periodType: 'daily' | 'weekly' | 'monthly';
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
  projectedTotalUsd: number;
  onTrack: boolean;
  alertTriggered: boolean;
}
```

### Key Methods
```typescript
// cost-tracker.ts
class CostTracker {
  constructor(usageLogRepo: UsageLogRepository);

  // Get pricing for a model at a specific time
  async getPricing(model: string, at?: Date): Promise<ModelPricing>;

  // Calculate cost for a session
  async calculateSessionCost(sessionId: string): Promise<CostCalculation>;

  // Calculate cost for a task (including all sessions)
  async calculateTaskCost(taskId: string): Promise<CostCalculation>;

  // Record cost when logging usage
  async recordUsageWithCost(usage: UsageLogEntry): Promise<void>;
}

// roi-calculator.ts
class ROICalculator {
  constructor(
    taskRepo: TaskRepository,
    sessionRepo: AgentSessionRepository,
    costTracker: CostTracker
  );

  // Calculate ROI for a specific task
  async calculateTaskROI(taskId: string): Promise<ROIMetrics>;

  // Calculate ROI for a project
  async calculateProjectROI(projectId: string): Promise<ROIMetrics>;

  // Calculate overall system ROI
  async calculateSystemROI(since?: Date): Promise<ROIMetrics>;

  // Get estimate accuracy trends
  async getEstimateAccuracyTrend(projectId?: string, days?: number): Promise<AccuracyTrend[]>;
}

// budget-tracker.ts
class BudgetTracker {
  constructor(costTracker: CostTracker);

  // Set budget for a project or globally
  async setBudget(config: BudgetConfig): Promise<void>;

  // Get current budget status
  async getBudgetStatus(projectId?: string): Promise<BudgetStatus>;

  // Check if spending is within budget
  async checkBudget(projectId?: string): Promise<boolean>;

  // Get projected spending for period
  async getProjection(projectId?: string, periodType: string): Promise<number>;
}
```

### Test Requirements
- Unit tests with mocked database
- Test cost calculations with different pricing scenarios
- Test ROI calculations with various estimate/actual combinations
- Test budget tracking and projections

### Important Notes
- Always use pricing at time of usage for accurate historical costs
- Handle pricing changes gracefully (new prices only apply to new usage)
- Follow existing repository patterns from Phase 1/2

---

## Instance 2: Estimate Accuracy Improvement

### Context
You are implementing the estimate accuracy improvement system for TrafficControl. This system tracks estimate history, identifies patterns in estimation errors, and provides calibration suggestions.

### Your Task
Build the estimate accuracy system that:
1. Tracks estimate history for each task
2. Calculates estimation error patterns
3. Identifies systematic over/under-estimation
4. Provides calibration factors for future estimates

### Files to Create
- `src/analytics/estimate-tracker.ts` - Tracks and stores estimate history
- `src/analytics/accuracy-analyzer.ts` - Analyzes estimation accuracy
- `src/analytics/calibration-engine.ts` - Generates calibration recommendations
- Tests for each file

### Database Schema
Add this migration:
```sql
-- Estimate history table (already defined in design, ensure it exists)
CREATE TABLE IF NOT EXISTS tc_estimates_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id) NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  estimated_sessions_opus INTEGER DEFAULT 0,
  estimated_sessions_sonnet INTEGER DEFAULT 0,
  estimated_impact_score TEXT,
  estimated_intervention_minutes INTEGER,
  estimator TEXT DEFAULT 'system',  -- 'system', 'human', 'calibrated'
  notes TEXT
);

-- Calibration factors per project
CREATE TABLE tc_calibration_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES tc_projects(id),
  complexity TEXT CHECK (complexity IN ('low', 'medium', 'high')),
  task_type TEXT,  -- optional categorization
  sessions_multiplier DECIMAL(5, 3) DEFAULT 1.0,
  intervention_multiplier DECIMAL(5, 3) DEFAULT 1.0,
  sample_size INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, complexity, task_type)
);

-- Enable RLS
ALTER TABLE tc_estimates_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_calibration_factors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for tc_estimates_history" ON tc_estimates_history FOR ALL USING (true);
CREATE POLICY "Allow all for tc_calibration_factors" ON tc_calibration_factors FOR ALL USING (true);
```

### Key Interfaces
```typescript
interface EstimateRecord {
  id: string;
  taskId: string;
  recordedAt: Date;
  estimatedSessionsOpus: number;
  estimatedSessionsSonnet: number;
  estimatedImpactScore?: string;
  estimatedInterventionMinutes?: number;
  estimator: 'system' | 'human' | 'calibrated';
  notes?: string;
}

interface AccuracyMetrics {
  projectId?: string;
  sampleSize: number;

  // Session estimation accuracy
  meanSessionError: number;  // positive = underestimate, negative = overestimate
  sessionErrorStdDev: number;
  sessionAccuracyPercent: number;  // % within 20% of actual

  // Intervention estimation accuracy
  meanInterventionError: number;
  interventionAccuracyPercent: number;

  // Breakdown by complexity
  byComplexity: {
    low: AccuracyBreakdown;
    medium: AccuracyBreakdown;
    high: AccuracyBreakdown;
  };
}

interface CalibrationFactor {
  projectId?: string;
  complexity?: string;
  taskType?: string;
  sessionsMultiplier: number;
  interventionMultiplier: number;
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
}

interface CalibratedEstimate {
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
```

### Key Methods
```typescript
// estimate-tracker.ts
class EstimateTracker {
  constructor(client: SupabaseClient);

  // Record an estimate for a task
  async recordEstimate(taskId: string, estimate: EstimateInput): Promise<EstimateRecord>;

  // Get estimate history for a task
  async getEstimateHistory(taskId: string): Promise<EstimateRecord[]>;

  // Get latest estimate for a task
  async getLatestEstimate(taskId: string): Promise<EstimateRecord | null>;
}

// accuracy-analyzer.ts
class AccuracyAnalyzer {
  constructor(
    estimateTracker: EstimateTracker,
    taskRepo: TaskRepository
  );

  // Analyze accuracy for a project
  async analyzeProjectAccuracy(projectId: string): Promise<AccuracyMetrics>;

  // Analyze system-wide accuracy
  async analyzeSystemAccuracy(): Promise<AccuracyMetrics>;

  // Get accuracy trend over time
  async getAccuracyTrend(projectId?: string, weeks?: number): Promise<AccuracyTrendPoint[]>;

  // Identify systematic biases
  async identifyBiases(projectId?: string): Promise<EstimationBias[]>;
}

// calibration-engine.ts
class CalibrationEngine {
  constructor(
    accuracyAnalyzer: AccuracyAnalyzer,
    client: SupabaseClient
  );

  // Calculate calibration factors based on historical data
  async calculateCalibrationFactors(projectId?: string): Promise<CalibrationFactor[]>;

  // Apply calibration to a raw estimate
  async calibrateEstimate(
    estimate: RawEstimate,
    projectId: string,
    complexity: string
  ): Promise<CalibratedEstimate>;

  // Update stored calibration factors
  async updateCalibrationFactors(projectId?: string): Promise<void>;

  // Get confidence level for calibration
  getCalibrationConfidence(sampleSize: number): 'low' | 'medium' | 'high';
}
```

### Test Requirements
- Test estimate tracking and history
- Test accuracy calculation with known data
- Test calibration factor generation
- Test calibrated estimate output

### Important Notes
- Minimum sample size of 5 tasks before providing calibration
- Confidence increases with sample size (5=low, 10=medium, 20+=high)
- Recalculate calibration factors after each completed task

---

## Instance 3: Prioritization Engine

### Context
You are implementing the prioritization engine for TrafficControl. This system recommends how to allocate resources across projects and tasks based on ROI, urgency, and capacity.

### Your Task
Build the prioritization engine that:
1. Scores tasks based on multiple factors
2. Recommends resource allocation across projects
3. Provides actionable recommendations in reports
4. Adapts to changing conditions

### Files to Create
- `src/analytics/priority-scorer.ts` - Calculates priority scores
- `src/analytics/resource-allocator.ts` - Recommends resource allocation
- `src/analytics/recommendation-generator.ts` - Generates actionable recommendations
- Tests for each file

### Key Interfaces
```typescript
interface PriorityScore {
  taskId: string;
  totalScore: number;  // 0-100

  // Component scores (each 0-100)
  impactScore: number;
  urgencyScore: number;
  efficiencyScore: number;  // Based on estimate accuracy for similar tasks
  dependencyScore: number;  // Higher if blocking other tasks

  // Metadata
  factors: PriorityFactor[];
  calculatedAt: Date;
}

interface PriorityFactor {
  name: string;
  weight: number;
  rawValue: number;
  normalizedValue: number;
  explanation: string;
}

interface ResourceAllocation {
  projectId: string;
  projectName: string;

  // Current state
  currentOpusSessions: number;
  currentSonnetSessions: number;
  queuedTasks: number;
  blockedTasks: number;

  // Recommended allocation
  recommendedOpusPercent: number;  // % of available Opus capacity
  recommendedSonnetPercent: number;

  // Justification
  reasoning: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}

interface Recommendation {
  id: string;
  type: 'rebalance' | 'pause' | 'accelerate' | 'investigate' | 'complete';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedProjects: string[];
  suggestedAction: string;
  expectedImpact: string;
  createdAt: Date;
}
```

### Key Methods
```typescript
// priority-scorer.ts
class PriorityScorer {
  constructor(
    taskRepo: TaskRepository,
    roiCalculator: ROICalculator
  );

  // Calculate priority score for a task
  async scoreTask(taskId: string): Promise<PriorityScore>;

  // Score all queued tasks
  async scoreQueuedTasks(): Promise<PriorityScore[]>;

  // Get sorted task queue by priority
  async getPrioritizedQueue(): Promise<Task[]>;

  // Configure scoring weights
  setWeights(weights: ScoringWeights): void;
}

// resource-allocator.ts
class ResourceAllocator {
  constructor(
    priorityScorer: PriorityScorer,
    capacityTracker: CapacityTracker,
    projectRepo: ProjectRepository
  );

  // Calculate recommended allocation
  async calculateAllocation(): Promise<ResourceAllocation[]>;

  // Check if current allocation matches recommendations
  async checkAllocationHealth(): Promise<AllocationHealth>;

  // Get allocation history
  async getAllocationHistory(days?: number): Promise<AllocationSnapshot[]>;
}

// recommendation-generator.ts
class RecommendationGenerator {
  constructor(
    resourceAllocator: ResourceAllocator,
    roiCalculator: ROICalculator,
    metricsCollector: MetricsCollector
  );

  // Generate current recommendations
  async generateRecommendations(): Promise<Recommendation[]>;

  // Get recommendations for a specific project
  async getProjectRecommendations(projectId: string): Promise<Recommendation[]>;

  // Format recommendations for Slack report
  formatForSlack(recommendations: Recommendation[]): string;

  // Format recommendations for dashboard
  formatForDashboard(recommendations: Recommendation[]): DashboardRecommendation[];
}
```

### Scoring Algorithm
```
Priority Score = weighted sum of:
- Impact Score (40%): Based on task's impact_score field (high=100, medium=60, low=30)
- Urgency Score (25%): Based on age in queue + explicit priority
- Efficiency Score (20%): Based on historical accuracy for similar tasks
- Dependency Score (15%): Higher if task is blocking other work

Adjustments:
- +20 if project has low backlog (needs work to keep agents busy)
- +10 if task is from currently underutilized project
- -10 if task complexity is high and Opus is at capacity
```

### Test Requirements
- Test scoring algorithm with various scenarios
- Test allocation recommendations
- Test recommendation generation
- Test Slack/dashboard formatting

### Important Notes
- Default weights can be adjusted via configuration
- Recommendations should be actionable and specific
- Include reasoning for all recommendations

---

## Instance 4: Dashboard UI

### Context
You are implementing the web dashboard for TrafficControl. This provides real-time visibility into system status, metrics, and recommendations.

### Your Task
Build the web dashboard that:
1. Shows real-time system status (projects, agents, capacity)
2. Displays ROI and cost metrics
3. Shows recommendations from the prioritization engine
4. Provides interactive controls for common operations

### Files to Create
- `src/dashboard/server.ts` - Express server for dashboard
- `src/dashboard/routes/api.ts` - REST API endpoints
- `src/dashboard/routes/views.ts` - SSR views (or static HTML)
- `src/dashboard/public/` - Static assets (CSS, JS)
- `src/dashboard/views/` - HTML templates
- `src/dashboard/index.ts` - Module exports
- Tests for API endpoints

### Tech Stack
- **Server:** Express.js (simple, low overhead)
- **Templating:** EJS or plain HTML with JS
- **Styling:** Tailwind CSS (utility-first, fast iteration)
- **Real-time:** Server-Sent Events (simpler than WebSocket for this use case)

### Key Routes
```typescript
// API Routes
GET  /api/status              // Overall system status
GET  /api/projects            // List projects with stats
GET  /api/projects/:id        // Project details
GET  /api/agents              // Active agent sessions
GET  /api/tasks               // Task queue with priorities
GET  /api/metrics             // ROI and cost metrics
GET  /api/recommendations     // Current recommendations
GET  /api/events              // SSE stream for real-time updates

POST /api/tasks/:id/priority  // Update task priority
POST /api/projects/:id/pause  // Pause a project
POST /api/projects/:id/resume // Resume a project
```

### Dashboard Sections

#### 1. System Overview
```
┌─────────────────────────────────────────────────────────┐
│  TrafficControl Dashboard                    [Status: ●]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Capacity                  Today's Stats                │
│  ┌─────────────────────┐   ┌─────────────────────────┐  │
│  │ Opus:   3/5 (60%)   │   │ Tasks Completed: 7      │  │
│  │ Sonnet: 7/10 (70%)  │   │ Tokens Used: 1.2M       │  │
│  │ ███████░░░░         │   │ Cost: $45.23            │  │
│  └─────────────────────┘   │ Interventions: 3        │  │
│                            └─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

#### 2. Project Cards
```
┌──────────────────────────────────────────────────────────┐
│  Projects                                                │
├──────────────────────────────────────────────────────────┤
│  ┌────────────────────┐  ┌────────────────────┐         │
│  │ Portfolio Website  │  │ TrafficControl     │         │
│  │ Status: Active     │  │ Status: Active     │         │
│  │ Agents: 2          │  │ Agents: 1          │         │
│  │ Queue: 5 tasks     │  │ Queue: 3 tasks     │         │
│  │ ROI: 1.2x          │  │ ROI: 0.9x          │         │
│  │ [Pause] [Details]  │  │ [Pause] [Details]  │         │
│  └────────────────────┘  └────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

#### 3. Active Agents
```
┌──────────────────────────────────────────────────────────┐
│  Active Agents                                           │
├──────────────────────────────────────────────────────────┤
│  Agent abc123 (Opus)         Duration: 12m               │
│  Project: Portfolio          Task: Fix auth bug          │
│  Status: Working             Tokens: 45,230              │
│  ─────────────────────────────────────────────────────   │
│  Agent def456 (Sonnet)       Duration: 5m                │
│  Project: TrafficControl     Task: Add dashboard         │
│  Status: Blocked (question)  Tokens: 12,100              │
│  [View Question] [Terminate]                             │
└──────────────────────────────────────────────────────────┘
```

#### 4. Recommendations Panel
```
┌──────────────────────────────────────────────────────────┐
│  Recommendations                                         │
├──────────────────────────────────────────────────────────┤
│  ⚠️ HIGH: Rebalance resources                            │
│  Portfolio has 3 blocked tasks but no active agents.     │
│  Suggested: Assign waiting task "Update homepage"        │
│  [Apply]                                                 │
│  ─────────────────────────────────────────────────────   │
│  ℹ️ MEDIUM: Review estimates                             │
│  TrafficControl tasks taking 40% longer than estimated.  │
│  Suggested: Increase session estimates by 1.4x           │
│  [Apply Calibration]                                     │
└──────────────────────────────────────────────────────────┘
```

### Key Components
```typescript
// server.ts
class DashboardServer {
  constructor(
    port: number,
    orchestrator: Orchestrator,
    roiCalculator: ROICalculator,
    recommendationGenerator: RecommendationGenerator
  );

  // Start the server
  async start(): Promise<void>;

  // Stop the server
  async stop(): Promise<void>;

  // Setup SSE for real-time updates
  private setupEventStream(): void;

  // Broadcast update to all connected clients
  broadcast(event: DashboardEvent): void;
}

// API response types
interface SystemStatus {
  running: boolean;
  uptime: number;
  capacity: CapacityStats;
  todayStats: {
    tasksCompleted: number;
    tokensUsed: number;
    costUsd: number;
    interventions: number;
  };
}

interface ProjectSummary {
  id: string;
  name: string;
  status: 'active' | 'paused';
  activeAgents: number;
  queuedTasks: number;
  blockedTasks: number;
  roi: number;
  costToday: number;
}
```

### Test Requirements
- Test API endpoints return correct data
- Test SSE connection and events
- Test POST endpoints modify state correctly
- No visual regression tests needed (manual verification)

### Important Notes
- Keep dashboard simple and functional - no over-engineering
- Use SSE for real-time updates (simpler than WebSocket)
- Dashboard should work on mobile (responsive)
- Authentication can be added later (Phase 5)

---

## Execution Instructions

Each instance should:
1. Read this prompt and existing codebase
2. Follow TDD: write failing tests first
3. Implement the feature
4. Ensure all tests pass
5. Run `npm run build` to verify TypeScript compiles
6. Commit changes with descriptive message

All instances can run in parallel as they work on separate modules.

---

## Integration Points

After all instances complete:
1. ROI Calculator integrates with Reporter for cost metrics in reports
2. Estimate Tracker records estimates when tasks are created
3. Prioritization Engine uses ROI data for scoring
4. Dashboard pulls from all analytics and displays via API
5. Reporter includes recommendations in checkpoint reports

Final integration will wire these together in the main orchestrator and update the Reporter to include new metrics.
