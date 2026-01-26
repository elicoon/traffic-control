import type {
  Retrospective,
  LearningCategory,
  CreateExtendedLearningInput,
  LearningExtractionResult
} from './types.js';

/**
 * Category aliases for normalization
 */
const CATEGORY_ALIASES: Record<string, LearningCategory> = {
  // Testing
  testing: 'testing',
  test: 'testing',
  tests: 'testing',
  unittest: 'testing',
  'unit-test': 'testing',

  // Architecture
  architecture: 'architecture',
  arch: 'architecture',
  design: 'architecture',
  structure: 'architecture',

  // Tooling
  tooling: 'tooling',
  tools: 'tooling',
  build: 'tooling',
  ci: 'tooling',
  cd: 'tooling',
  devops: 'tooling',
  infrastructure: 'tooling',

  // Communication
  communication: 'communication',
  comm: 'communication',
  collab: 'communication',
  collaboration: 'communication',

  // Project-specific
  'project-specific': 'project-specific',
  project: 'project-specific',
  custom: 'project-specific'
};

/**
 * Maximum length for trigger strings
 */
const MAX_TRIGGER_LENGTH = 150;

/**
 * Extracts machine-readable learnings from retrospectives.
 * Transforms retrospective data into structured learnings that can be
 * stored and propagated to future agent sessions.
 */
export class LearningExtractor {
  /**
   * Extracts structured learning from a retrospective.
   * Returns the learning along with confidence score and reasoning.
   */
  extractLearning(retrospective: Retrospective): LearningExtractionResult {
    // If no learning is present, return empty result
    if (!retrospective.learning) {
      return {
        learnings: [],
        confidence: 0,
        reasoning: 'No learning attached to retrospective'
      };
    }

    const { learning } = retrospective;

    // Normalize the category
    const category = this.normalizeCategory(learning.category);

    // Generate subcategory from pattern
    const subcategory = this.generateSubcategory(learning.pattern, category);

    // Generate trigger description
    const trigger = this.generateTrigger(
      retrospective.whatHappened,
      retrospective.rootCause,
      learning.pattern
    );

    // Calculate confidence based on completeness
    const confidence = this.calculateConfidence(retrospective);

    // Build the extended learning
    const extendedLearning: CreateExtendedLearningInput = {
      category,
      subcategory,
      pattern: learning.pattern,
      trigger,
      rule: learning.rule,
      appliesTo: learning.appliesTo,
      sourceRetrospective: retrospective.id,
      projectId: category === 'project-specific' ? retrospective.projectId : undefined
    };

    // Generate reasoning
    const reasoning = this.generateReasoning(retrospective, extendedLearning, confidence);

    return {
      learnings: [extendedLearning],
      confidence,
      reasoning
    };
  }

  /**
   * Normalizes a category string to a valid LearningCategory.
   * Maps aliases and alternative names to standard categories.
   */
  normalizeCategory(category: string): LearningCategory {
    const normalized = category.toLowerCase().trim();
    return CATEGORY_ALIASES[normalized] ?? 'project-specific';
  }

  /**
   * Generates a subcategory from the pattern and category.
   */
  private generateSubcategory(pattern: string, category: LearningCategory): string {
    // Use the pattern as the subcategory since it's already descriptive
    return pattern.toLowerCase().trim();
  }

  /**
   * Generates a trigger description from retrospective context.
   * The trigger describes when this learning should be applied.
   */
  generateTrigger(
    whatHappened: string,
    rootCause: string | null,
    pattern: string
  ): string {
    // Try to use whatHappened if it's concise
    if (whatHappened.length <= MAX_TRIGGER_LENGTH) {
      return `when ${whatHappened.charAt(0).toLowerCase()}${whatHappened.slice(1)}`;
    }

    // Try rootCause if available and concise
    if (rootCause && rootCause.length <= MAX_TRIGGER_LENGTH) {
      return `when ${rootCause.charAt(0).toLowerCase()}${rootCause.slice(1)}`;
    }

    // Fallback to pattern-based trigger
    const patternDescription = pattern
      .replace(/-/g, ' ')
      .replace(/_/g, ' ');
    return `when encountering ${patternDescription}`;
  }

  /**
   * Calculates confidence score based on retrospective completeness.
   * More complete retrospectives yield higher confidence learnings.
   */
  private calculateConfidence(retrospective: Retrospective): number {
    let score = 0;
    const factors: string[] = [];

    // Base score for having a learning
    if (retrospective.learning) {
      score += 0.3;
      factors.push('has learning');

      // Additional points for detailed learning
      if (retrospective.learning.rule.length > 20) {
        score += 0.1;
        factors.push('detailed rule');
      }
      if (retrospective.learning.appliesTo && retrospective.learning.appliesTo.length > 0) {
        score += 0.1;
        factors.push('has applies-to');
      }
    }

    // Points for context
    if (retrospective.rootCause) {
      score += 0.15;
      factors.push('has root cause');
    }
    if (retrospective.correctApproach) {
      score += 0.15;
      factors.push('has correct approach');
    }

    // Points for resolution
    if (retrospective.resolvedAt) {
      score += 0.1;
      factors.push('is resolved');
    }

    // Points for descriptive content
    if (retrospective.whatHappened.length > 50) {
      score += 0.05;
      factors.push('detailed description');
    }

    // Cap at 1.0
    return Math.min(score, 1.0);
  }

  /**
   * Generates reasoning explaining the extraction process.
   */
  private generateReasoning(
    retrospective: Retrospective,
    learning: CreateExtendedLearningInput,
    confidence: number
  ): string {
    const parts: string[] = [];

    parts.push(`Extracted learning from retrospective "${retrospective.title}".`);
    parts.push(`Category: ${learning.category} (from "${retrospective.learning?.category}").`);
    parts.push(`Confidence: ${(confidence * 100).toFixed(0)}%.`);

    if (confidence >= 0.8) {
      parts.push('High confidence: retrospective has complete context and resolution.');
    } else if (confidence >= 0.5) {
      parts.push('Medium confidence: retrospective has partial context.');
    } else {
      parts.push('Low confidence: retrospective lacks detail or resolution.');
    }

    return parts.join(' ');
  }

  /**
   * Validates that a learning has all required fields.
   */
  validateLearning(learning: CreateExtendedLearningInput): boolean {
    return (
      !!learning.category &&
      !!learning.subcategory &&
      !!learning.pattern &&
      !!learning.trigger &&
      !!learning.rule &&
      !!learning.sourceRetrospective
    );
  }
}
