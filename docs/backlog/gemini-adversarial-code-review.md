# Backlog Item: Gemini Adversarial Code Review MCP Server

**Priority:** Medium
**Type:** New Feature / Integration
**Status:** Phase 1 Complete - Awaiting API Quota Reset
**Created:** 2026-01-26

---

## Current Status

**Phase 1 Complete:** MCP server implemented at `gemini-review-mcp/`
- ✅ `review-code` tool with adversarial prompting
- ✅ Tiered merge blocking (critical/major/minor)
- ✅ 32 unit tests passing
- ⏳ Integration tests blocked by free tier daily quota

**Next:** Test with real API calls once quota resets (midnight Pacific), then proceed to Phase 2

---

## Problem Statement

Code reviews performed by the same model that wrote the code may have blind spots - similar reasoning patterns can lead to similar oversights. An adversarial code review from a different model architecture (Google's Gemini) could catch issues that Claude might miss due to:

1. **Same-model bias** - Claude reviewing Claude's code may share similar assumptions
2. **Architectural blind spots** - Different model training leads to different reasoning patterns
3. **Validation diversity** - Multiple perspectives improve code quality
4. **Reduced groupthink** - Cross-model review prevents echo chamber effects

## Proposed Solution: Gemini Code Review MCP Server

Create an MCP (Model Context Protocol) server that exposes Google's best coding model (currently Gemini 2.5 Pro or latest) as an adversarial code reviewer for TrafficControl workflows.

### Key Capabilities

1. **Adversarial Code Review** - Review code changes with a critical eye, specifically looking for issues Claude might miss
2. **Security Audit** - Independent security analysis from a different model's perspective
3. **Architecture Critique** - Challenge design decisions and suggest alternatives
4. **Test Coverage Gaps** - Identify untested edge cases or missing test scenarios
5. **Performance Analysis** - Spot potential performance issues or inefficiencies

### Integration Points

The MCP server would integrate with TrafficControl's existing workflow:

```
Claude writes code → TrafficControl orchestrator → Gemini MCP Review → Feedback loop
```

## Technical Design

### MCP Server Structure

```typescript
// gemini-review-mcp/src/index.ts
interface GeminiReviewServer {
  tools: {
    'review-code': {
      description: 'Adversarial code review by Gemini',
      parameters: {
        code: string;
        context?: string;
        focusAreas?: ('security' | 'performance' | 'correctness' | 'design')[];
        originalAuthor?: 'claude' | 'human';
      };
      returns: ReviewResult;
    };
    'security-audit': {
      description: 'Security-focused review',
      parameters: {
        code: string;
        language: string;
        context?: string;
      };
      returns: SecurityAuditResult;
    };
    'architecture-critique': {
      description: 'Challenge architectural decisions',
      parameters: {
        designDoc: string;
        codebase?: string;
      };
      returns: ArchitectureCritique;
    };
  };
}
```

### Review Result Format

```typescript
interface ReviewResult {
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  category: string;
  finding: string;
  location?: {
    file: string;
    lineStart: number;
    lineEnd?: number;
  };
  suggestion?: string;
  confidence: number; // 0-1 how confident Gemini is in this finding
  claudeBlindSpot?: boolean; // Whether this is likely something Claude would miss
}
```

### Adversarial Prompting Strategy

The MCP server should use prompts specifically designed to find issues Claude might miss:

```
You are reviewing code written by Claude (Anthropic's AI).
Your goal is NOT to be nice or find positive things.
Your goal is to be ADVERSARIAL - find problems, security issues,
bugs, and design flaws that Claude's similar reasoning patterns
might have overlooked.

Focus especially on:
1. Assumptions Claude might make without validating
2. Edge cases in error handling
3. Security vulnerabilities (injection, auth bypass, etc.)
4. Race conditions and concurrency issues
5. Resource leaks and cleanup failures
6. Type coercion edge cases
7. Boundary conditions
```

## Google Model Selection

### Current Best Option: Gemini 2.5 Pro (or Latest)

As of early 2026, Google's best coding model options include:
- **Gemini 2.5 Pro** - Best for complex reasoning and code review
- **Gemini 2.5 Flash** - Faster/cheaper option for simpler reviews

The MCP server should be configurable to use different models based on review type:
- Critical security audits → Gemini 2.5 Pro
- Quick code reviews → Gemini 2.5 Flash
- Architecture decisions → Gemini 2.5 Pro

### API Integration

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-pro-latest' // or latest best coding model
});
```

## TrafficControl Integration

### Workflow Integration

Add to the orchestrator's standard review workflow:

```typescript
// In orchestrator workflow
async function reviewCodeChanges(changes: CodeChanges): Promise<ReviewResults> {
  // 1. Claude's self-review
  const claudeReview = await agentManager.spawnAgent({
    type: 'code-review',
    context: changes,
  });

  // 2. Gemini adversarial review via MCP
  const geminiReview = await mcpClient.call('gemini-review', 'review-code', {
    code: changes.diff,
    context: changes.description,
    focusAreas: ['security', 'correctness'],
    originalAuthor: 'claude',
  });

  // 3. Combine and prioritize findings
  return mergeReviews(claudeReview, geminiReview);
}
```

### Configuration

```yaml
# traffic-control config
review:
  adversarial:
    enabled: true
    provider: gemini-mcp
    triggers:
      - security-sensitive-changes
      - architecture-changes
      - public-api-changes
    model:
      default: gemini-2.5-flash
      security: gemini-2.5-pro
      architecture: gemini-2.5-pro
```

## Implementation Phases

### Phase 1: Basic MCP Server
- Set up MCP server skeleton
- Implement Google AI API integration
- Basic `review-code` tool with simple prompting
- Manual testing with sample code

### Phase 2: Adversarial Prompting
- Develop and test adversarial prompt templates
- Implement focus area-specific prompts
- Add confidence scoring
- Identify Claude-specific blind spot patterns

### Phase 3: TrafficControl Integration
- Add MCP client to orchestrator
- Implement automatic triggering on code changes
- Create review result aggregation
- Add Slack notifications for critical findings

### Phase 4: Learning & Optimization
- Track which Gemini findings were valid vs false positives
- Tune prompts based on feedback
- Build a dataset of Claude blind spots
- Implement model selection based on review type

## Success Metrics

| Metric | Target |
|--------|--------|
| Bugs caught by Gemini that Claude missed | Track baseline, then measure |
| False positive rate | < 20% |
| Review latency (Gemini) | < 30 seconds |
| Security issues caught pre-merge | Increase by 25% |
| Developer satisfaction with reviews | Positive feedback |

## Cost Considerations

- Gemini API costs per review
- May want to implement caching for similar code patterns
- Consider rate limiting for non-critical reviews
- Budget monitoring and alerts

## Security & Privacy

- Code sent to Google's API - ensure compliance with data policies
- API key management via environment variables
- No logging of sensitive code unless explicitly configured
- Option to exclude certain files/paths from external review

## Related Files

- [orchestrator.ts](../../src/orchestrator.ts) - Main orchestrator for integration
- [review/](../../src/review/) - Existing review infrastructure
- [agent/manager.ts](../../src/agent/manager.ts) - Agent spawning for Claude reviews

## Decisions

### 1. Merge Blocking Policy: **Tiered Approach**
- **Critical findings** → Block merge until addressed
- **Major findings** → Require acknowledgment before merge
- **Minor findings** → Info only, no action required

### 2. Handling Disagreements: **Claude Rebuts First**
When Claude's self-review says code is fine but Gemini disagrees:
1. Claude gets a chance to defend the code with reasoning
2. If still disputed after rebuttal, escalate to human for decision

### 3. Rebuttal Flow: **Only for Disputed Findings**
- Claude only responds when its self-review said "looks good" but Gemini disagrees
- Reduces cost/latency while still catching false positives

### 4. Trigger Strategy: **Manual Only (Initial)**
- Start with manual triggering only (developer explicitly requests adversarial review)
- See follow-up backlog item: [Dynamic Review Triggering](./gemini-dynamic-triggering.md)

## Notes

This creates a healthy adversarial dynamic where two different AI architectures check each other's work. The key insight is that diversity of reasoning patterns catches more bugs than depth of single-model reasoning.

Future extension: Could add other models (GPT-4, Mistral, etc.) for even more diverse perspectives on critical code paths.
