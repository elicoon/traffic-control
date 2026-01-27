export interface QuestionAnswer {
  id: string
  question: string
  questionEmbedding?: number[] // For semantic search
  answer: string
  projectId?: string
  taskCategory?: string

  // Quality signals
  wasHelpful: boolean
  usageCount: number
  lastUsed: Date

  // Metadata
  originalTaskId: string
  originalAgentId: string
  answeredBy: string // User ID
  createdAt: Date
}

export interface SimilarityMatch {
  qa: QuestionAnswer
  score: number // 0-1
  matchType: 'exact' | 'semantic' | 'keyword'
}

export interface AutoResponseDecision {
  shouldAutoRespond: boolean
  confidence: number
  suggestedAnswer?: string
  matchedQA?: QuestionAnswer
  reason: string
}

export interface KBMetrics {
  totalQuestions: number
  autoAnswered: number
  escalatedToSlack: number
  hitRate: number
  averageConfidence: number
  topCategories: { category: string; count: number }[]
}

export interface QuestionContext {
  projectId?: string
  taskCategory?: string
  agentId: string
  taskId: string
}

export interface SimilarityOptions {
  exactMatchWeight: number
  keywordMatchWeight: number
  semanticMatchWeight: number
  minKeywordOverlap: number
}

export interface AutoResponderConfig {
  minConfidenceThreshold: number // Default: 0.85
  minUsageCount: number // Only use answers used N+ times
  requireProjectMatch: boolean // Stricter matching
  maxAgeDays: number // Don't use stale answers
}

export interface Feedback {
  questionId: string
  wasHelpful: boolean
  timestamp: Date
}