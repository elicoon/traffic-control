# Phase 1: Gemini Adversarial Code Review MCP Server - Implementation Plan

**Status:** Ready for Implementation
**Priority:** Medium
**Estimated Complexity:** Medium
**Parent Backlog Item:** [gemini-adversarial-code-review.md](../backlog/gemini-adversarial-code-review.md)

---

## Objective

Create a working MCP (Model Context Protocol) server that exposes Google's Gemini model as an adversarial code reviewer. Phase 1 focuses on the foundational infrastructure: server setup, Google AI API integration, and a basic `review-code` tool.

## Decisions (From Backlog)

These decisions have already been made and should be implemented:

1. **Merge Blocking Policy:** Tiered approach
   - Critical findings block merge
   - Major findings require acknowledgment
   - Minor findings are info only

2. **Handling Disagreements:** Claude rebuts first
   - Claude defends code with reasoning when Gemini disagrees
   - Escalate to human if still disputed

3. **Trigger Strategy:** Manual only (initial)
   - Developer explicitly requests adversarial review
   - No automatic triggering in Phase 1

---

## Prerequisites

Before starting:
- [ ] Google AI API key (from Google AI Studio or Google Cloud)
- [ ] Node.js 20+ installed
- [ ] Understanding of MCP server protocol (see [MCP documentation](https://modelcontextprotocol.io))

---

## Task 1: Project Setup

**Files:**
- Create: `gemini-review-mcp/package.json`
- Create: `gemini-review-mcp/tsconfig.json`
- Create: `gemini-review-mcp/.env.example`
- Create: `gemini-review-mcp/.gitignore`
- Create: `gemini-review-mcp/src/index.ts`

### Step 1: Initialize project structure

Create directory `gemini-review-mcp/` at the same level as `traffic-control/`.

```bash
mkdir gemini-review-mcp
cd gemini-review-mcp
npm init -y
```

### Step 2: Install dependencies

```bash
npm install @google/generative-ai @modelcontextprotocol/sdk zod dotenv
npm install -D typescript @types/node vitest
```

**Dependencies explained:**
- `@google/generative-ai` - Official Google AI SDK for Gemini
- `@modelcontextprotocol/sdk` - MCP server SDK for building tools
- `zod` - Schema validation for tool parameters
- `dotenv` - Environment variable loading
- `vitest` - Testing framework (consistent with traffic-control)

### Step 3: Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 4: Create .env.example

```
# Google AI API Configuration
GOOGLE_AI_API_KEY=your-api-key-here

# Model Configuration (optional, defaults shown)
GEMINI_MODEL=gemini-2.5-pro-latest
GEMINI_FLASH_MODEL=gemini-2.5-flash-latest

# MCP Server Configuration
MCP_SERVER_NAME=gemini-review
MCP_SERVER_VERSION=1.0.0
```

### Step 5: Create .gitignore

```
node_modules/
dist/
.env
*.log
```

### Step 6: Create package.json scripts

Update `package.json`:

```json
{
  "name": "gemini-review-mcp",
  "version": "1.0.0",
  "description": "MCP server for Gemini adversarial code review",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "gemini-review-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "keywords": ["mcp", "gemini", "code-review", "claude"],
  "license": "ISC"
}
```

### Step 7: Create placeholder entry point

Create `gemini-review-mcp/src/index.ts`:

```typescript
#!/usr/bin/env node
import 'dotenv/config';

console.log('Gemini Review MCP Server starting...');
console.log('Phase 1 - Basic Implementation');

// Placeholder - will be replaced with actual MCP server
async function main() {
  console.log('Server initialized');
}

main().catch(console.error);
```

### Step 8: Verify setup

```bash
npm run build
npm run start
```

Expected: "Gemini Review MCP Server starting..." printed to console.

### Step 9: Commit

```bash
git add gemini-review-mcp/
git commit -m "feat(gemini-mcp): initialize project structure"
```

---

## Task 2: Types and Interfaces

**Files:**
- Create: `gemini-review-mcp/src/types.ts`

### Step 1: Define core types

Create `gemini-review-mcp/src/types.ts`:

```typescript
/**
 * Severity levels for review findings.
 * Implements tiered merge blocking policy.
 */
export type FindingSeverity = 'critical' | 'major' | 'minor' | 'suggestion';

/**
 * Categories of issues that can be found during review.
 */
export type FindingCategory =
  | 'security'
  | 'performance'
  | 'correctness'
  | 'design'
  | 'maintainability'
  | 'error-handling'
  | 'edge-case'
  | 'type-safety'
  | 'concurrency'
  | 'resource-leak';

/**
 * Focus areas for targeted review.
 */
export type ReviewFocusArea = 'security' | 'performance' | 'correctness' | 'design';

/**
 * Who originally wrote the code being reviewed.
 */
export type CodeAuthor = 'claude' | 'human' | 'unknown';

/**
 * Location of a finding within the code.
 */
export interface CodeLocation {
  /** File path (if provided in context) */
  file?: string;
  /** Starting line number (1-indexed) */
  lineStart?: number;
  /** Ending line number (1-indexed, inclusive) */
  lineEnd?: number;
  /** Relevant code snippet */
  snippet?: string;
}

/**
 * A single finding from the code review.
 */
export interface ReviewFinding {
  /** Unique identifier for this finding */
  id: string;
  /** Severity level - determines merge blocking behavior */
  severity: FindingSeverity;
  /** Category of the issue */
  category: FindingCategory;
  /** Description of the finding */
  finding: string;
  /** Location in the code where the issue was found */
  location?: CodeLocation;
  /** Suggested fix or improvement */
  suggestion?: string;
  /** Confidence score (0-1) - how confident Gemini is in this finding */
  confidence: number;
  /** Whether this is likely something Claude would miss (adversarial insight) */
  claudeBlindSpot: boolean;
  /** Reasoning for why this might be a Claude blind spot */
  blindSpotReason?: string;
}

/**
 * Input parameters for the review-code tool.
 */
export interface ReviewCodeInput {
  /** The code to review */
  code: string;
  /** Additional context about the code (purpose, surrounding code, etc.) */
  context?: string;
  /** Optional file path for the code */
  filePath?: string;
  /** Programming language (auto-detected if not provided) */
  language?: string;
  /** Specific areas to focus the review on */
  focusAreas?: ReviewFocusArea[];
  /** Who wrote this code - enables adversarial prompting */
  originalAuthor?: CodeAuthor;
}

/**
 * Result of a code review.
 */
export interface ReviewResult {
  /** Whether the review completed successfully */
  success: boolean;
  /** List of findings from the review */
  findings: ReviewFinding[];
  /** Summary statistics */
  summary: ReviewSummary;
  /** Model used for the review */
  model: string;
  /** Time taken for the review in milliseconds */
  durationMs: number;
  /** Error message if review failed */
  error?: string;
}

/**
 * Summary statistics for a review.
 */
export interface ReviewSummary {
  /** Total number of findings */
  totalFindings: number;
  /** Count by severity */
  bySeverity: Record<FindingSeverity, number>;
  /** Count by category */
  byCategory: Partial<Record<FindingCategory, number>>;
  /** Number of potential Claude blind spots identified */
  claudeBlindSpots: number;
  /** Overall assessment */
  assessment: 'clean' | 'minor-issues' | 'needs-attention' | 'critical-issues';
  /** Merge recommendation based on tiered policy */
  mergeRecommendation: MergeRecommendation;
}

/**
 * Merge recommendation based on findings.
 */
export interface MergeRecommendation {
  /** Whether merge should be blocked */
  blocked: boolean;
  /** Whether acknowledgment is required before merge */
  requiresAcknowledgment: boolean;
  /** Reason for the recommendation */
  reason: string;
}

/**
 * Configuration for the Gemini client.
 */
export interface GeminiConfig {
  /** API key for Google AI */
  apiKey: string;
  /** Model to use for reviews (default: gemini-2.5-pro-latest) */
  model?: string;
  /** Temperature for generation (default: 0.2 for consistency) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxOutputTokens?: number;
}
```

### Step 2: Commit

```bash
git add gemini-review-mcp/src/types.ts
git commit -m "feat(gemini-mcp): add types and interfaces for code review"
```

---

## Task 3: Google AI Client Integration

**Files:**
- Create: `gemini-review-mcp/src/gemini-client.ts`
- Create: `gemini-review-mcp/src/gemini-client.test.ts`

### Step 1: Write the failing test

Create `gemini-review-mcp/src/gemini-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiClient } from './gemini-client.js';

// Mock the Google AI SDK
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            findings: [],
            summary: 'No issues found'
          })
        }
      })
    })
  }))
}));

describe('GeminiClient', () => {
  let client: GeminiClient;

  beforeEach(() => {
    client = new GeminiClient({ apiKey: 'test-key' });
  });

  it('should create a client instance', () => {
    expect(client).toBeDefined();
  });

  it('should have default configuration', () => {
    const config = client.getConfig();
    expect(config.model).toBe('gemini-2.5-pro-latest');
    expect(config.temperature).toBe(0.2);
  });

  it('should accept custom configuration', () => {
    const customClient = new GeminiClient({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash-latest',
      temperature: 0.5
    });
    const config = customClient.getConfig();
    expect(config.model).toBe('gemini-2.5-flash-latest');
    expect(config.temperature).toBe(0.5);
  });

  it('should generate review for code', async () => {
    const result = await client.reviewCode({
      code: 'function test() { return 1; }',
      context: 'A simple test function'
    });

    expect(result).toBeDefined();
    expect(result.findings).toBeDefined();
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm run test -- src/gemini-client.test.ts
```

Expected: FAIL - module not found

### Step 3: Create the Gemini client

Create `gemini-review-mcp/src/gemini-client.ts`:

```typescript
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import {
  GeminiConfig,
  ReviewCodeInput,
  ReviewFinding,
  FindingSeverity,
  ReviewSummary,
  MergeRecommendation
} from './types.js';

/**
 * Raw response structure from Gemini.
 */
interface GeminiReviewResponse {
  findings: Array<{
    severity: string;
    category: string;
    finding: string;
    location?: {
      lineStart?: number;
      lineEnd?: number;
      snippet?: string;
    };
    suggestion?: string;
    confidence: number;
    claudeBlindSpot: boolean;
    blindSpotReason?: string;
  }>;
  overallAssessment: string;
}

/**
 * Client for interacting with Google's Gemini AI for code review.
 */
export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private config: Required<GeminiConfig>;

  constructor(config: GeminiConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model ?? 'gemini-2.5-pro-latest',
      temperature: config.temperature ?? 0.2,
      maxOutputTokens: config.maxOutputTokens ?? 4096
    };

    this.genAI = new GoogleGenerativeAI(this.config.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: this.config.model,
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxOutputTokens
      }
    });
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Required<GeminiConfig> {
    return { ...this.config };
  }

  /**
   * Review code and return findings.
   */
  async reviewCode(input: ReviewCodeInput): Promise<{
    findings: ReviewFinding[];
    summary: ReviewSummary;
    rawResponse: string;
  }> {
    const prompt = this.buildPrompt(input);
    const startTime = Date.now();

    const result = await this.model.generateContent(prompt);
    const responseText = result.response.text();

    const parsed = this.parseResponse(responseText, input.filePath);
    const summary = this.buildSummary(parsed.findings);

    return {
      findings: parsed.findings,
      summary,
      rawResponse: responseText
    };
  }

  /**
   * Build the adversarial review prompt.
   */
  private buildPrompt(input: ReviewCodeInput): string {
    const authorContext = input.originalAuthor === 'claude'
      ? `This code was written by Claude (Anthropic's AI assistant).
Your goal is to be ADVERSARIAL - find problems, security issues, bugs, and design flaws that Claude's similar reasoning patterns might have overlooked.

Focus especially on:
1. Assumptions Claude might make without validating
2. Edge cases in error handling
3. Security vulnerabilities (injection, auth bypass, etc.)
4. Race conditions and concurrency issues
5. Resource leaks and cleanup failures
6. Type coercion edge cases
7. Boundary conditions`
      : `Review this code critically for issues.`;

    const focusContext = input.focusAreas?.length
      ? `\n\nFocus particularly on: ${input.focusAreas.join(', ')}`
      : '';

    const languageContext = input.language
      ? `\n\nLanguage: ${input.language}`
      : '';

    const additionalContext = input.context
      ? `\n\nAdditional context:\n${input.context}`
      : '';

    const fileContext = input.filePath
      ? `\n\nFile: ${input.filePath}`
      : '';

    return `You are an expert code reviewer performing an adversarial code review.

${authorContext}
${focusContext}
${languageContext}
${fileContext}
${additionalContext}

CODE TO REVIEW:
\`\`\`
${input.code}
\`\`\`

Respond with a JSON object containing:
1. "findings" - array of issues found, each with:
   - "severity": "critical" | "major" | "minor" | "suggestion"
   - "category": "security" | "performance" | "correctness" | "design" | "maintainability" | "error-handling" | "edge-case" | "type-safety" | "concurrency" | "resource-leak"
   - "finding": description of the issue
   - "location": { "lineStart": number, "lineEnd": number (optional), "snippet": string (optional) }
   - "suggestion": how to fix it (optional)
   - "confidence": 0-1 how confident you are
   - "claudeBlindSpot": boolean - is this something Claude might miss?
   - "blindSpotReason": why Claude might miss this (if claudeBlindSpot is true)

2. "overallAssessment": "clean" | "minor-issues" | "needs-attention" | "critical-issues"

Be thorough but avoid false positives. Only report genuine issues with reasonable confidence.
Return ONLY valid JSON, no markdown formatting.`;
  }

  /**
   * Parse the Gemini response into structured findings.
   */
  private parseResponse(responseText: string, filePath?: string): {
    findings: ReviewFinding[];
    assessment: string;
  } {
    try {
      // Clean up response - remove markdown code blocks if present
      let cleanedResponse = responseText.trim();
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.slice(7);
      }
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.slice(3);
      }
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      cleanedResponse = cleanedResponse.trim();

      const parsed: GeminiReviewResponse = JSON.parse(cleanedResponse);

      const findings: ReviewFinding[] = (parsed.findings || []).map((f, index) => ({
        id: `gemini-${Date.now()}-${index}`,
        severity: this.validateSeverity(f.severity),
        category: this.validateCategory(f.category),
        finding: f.finding,
        location: f.location ? {
          file: filePath,
          lineStart: f.location.lineStart,
          lineEnd: f.location.lineEnd,
          snippet: f.location.snippet
        } : undefined,
        suggestion: f.suggestion,
        confidence: Math.max(0, Math.min(1, f.confidence)),
        claudeBlindSpot: Boolean(f.claudeBlindSpot),
        blindSpotReason: f.blindSpotReason
      }));

      return {
        findings,
        assessment: parsed.overallAssessment || 'needs-attention'
      };
    } catch (err) {
      console.error('Failed to parse Gemini response:', err);
      console.error('Raw response:', responseText);

      // Return empty findings on parse error
      return {
        findings: [],
        assessment: 'needs-attention'
      };
    }
  }

  /**
   * Validate and normalize severity value.
   */
  private validateSeverity(severity: string): FindingSeverity {
    const valid: FindingSeverity[] = ['critical', 'major', 'minor', 'suggestion'];
    const normalized = severity?.toLowerCase() as FindingSeverity;
    return valid.includes(normalized) ? normalized : 'minor';
  }

  /**
   * Validate and normalize category value.
   */
  private validateCategory(category: string): ReviewFinding['category'] {
    const valid = [
      'security', 'performance', 'correctness', 'design',
      'maintainability', 'error-handling', 'edge-case',
      'type-safety', 'concurrency', 'resource-leak'
    ];
    const normalized = category?.toLowerCase().replace(/\s+/g, '-');
    return valid.includes(normalized) ? normalized as ReviewFinding['category'] : 'correctness';
  }

  /**
   * Build summary statistics from findings.
   */
  private buildSummary(findings: ReviewFinding[]): ReviewSummary {
    const bySeverity: Record<FindingSeverity, number> = {
      critical: 0,
      major: 0,
      minor: 0,
      suggestion: 0
    };

    const byCategory: Partial<Record<ReviewFinding['category'], number>> = {};

    let claudeBlindSpots = 0;

    for (const finding of findings) {
      bySeverity[finding.severity]++;
      byCategory[finding.category] = (byCategory[finding.category] || 0) + 1;
      if (finding.claudeBlindSpot) {
        claudeBlindSpots++;
      }
    }

    // Determine assessment
    let assessment: ReviewSummary['assessment'];
    if (bySeverity.critical > 0) {
      assessment = 'critical-issues';
    } else if (bySeverity.major > 0) {
      assessment = 'needs-attention';
    } else if (bySeverity.minor > 0 || bySeverity.suggestion > 0) {
      assessment = 'minor-issues';
    } else {
      assessment = 'clean';
    }

    // Build merge recommendation based on tiered policy
    const mergeRecommendation = this.buildMergeRecommendation(bySeverity);

    return {
      totalFindings: findings.length,
      bySeverity,
      byCategory,
      claudeBlindSpots,
      assessment,
      mergeRecommendation
    };
  }

  /**
   * Build merge recommendation based on tiered policy.
   */
  private buildMergeRecommendation(
    bySeverity: Record<FindingSeverity, number>
  ): MergeRecommendation {
    if (bySeverity.critical > 0) {
      return {
        blocked: true,
        requiresAcknowledgment: true,
        reason: `${bySeverity.critical} critical issue(s) must be addressed before merge`
      };
    }

    if (bySeverity.major > 0) {
      return {
        blocked: false,
        requiresAcknowledgment: true,
        reason: `${bySeverity.major} major issue(s) require acknowledgment before merge`
      };
    }

    return {
      blocked: false,
      requiresAcknowledgment: false,
      reason: 'No blocking issues found'
    };
  }
}
```

### Step 4: Run test to verify it passes

```bash
npm run test -- src/gemini-client.test.ts
```

Expected: PASS

### Step 5: Commit

```bash
git add gemini-review-mcp/src/gemini-client.ts gemini-review-mcp/src/gemini-client.test.ts
git commit -m "feat(gemini-mcp): add Gemini client with adversarial prompting"
```

---

## Task 4: MCP Server Implementation

**Files:**
- Create: `gemini-review-mcp/src/server.ts`
- Create: `gemini-review-mcp/src/server.test.ts`
- Update: `gemini-review-mcp/src/index.ts`

### Step 1: Write the failing test

Create `gemini-review-mcp/src/server.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpServer, GeminiReviewServer } from './server.js';

// Mock the Gemini client
vi.mock('./gemini-client.js', () => ({
  GeminiClient: vi.fn().mockImplementation(() => ({
    reviewCode: vi.fn().mockResolvedValue({
      findings: [],
      summary: {
        totalFindings: 0,
        bySeverity: { critical: 0, major: 0, minor: 0, suggestion: 0 },
        byCategory: {},
        claudeBlindSpots: 0,
        assessment: 'clean',
        mergeRecommendation: {
          blocked: false,
          requiresAcknowledgment: false,
          reason: 'No blocking issues found'
        }
      },
      rawResponse: '{}'
    }),
    getConfig: vi.fn().mockReturnValue({ model: 'gemini-2.5-pro-latest' })
  }))
}));

describe('GeminiReviewServer', () => {
  let server: GeminiReviewServer;

  beforeEach(() => {
    vi.stubEnv('GOOGLE_AI_API_KEY', 'test-key');
    server = createMcpServer();
  });

  it('should create a server instance', () => {
    expect(server).toBeDefined();
  });

  it('should have server info', () => {
    const info = server.getServerInfo();
    expect(info.name).toBe('gemini-review');
    expect(info.version).toBeDefined();
  });

  it('should list available tools', () => {
    const tools = server.listTools();
    expect(tools).toContainEqual(expect.objectContaining({
      name: 'review-code'
    }));
  });

  it('should handle review-code tool call', async () => {
    const result = await server.callTool('review-code', {
      code: 'function test() { return 1; }'
    });

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm run test -- src/server.test.ts
```

Expected: FAIL - module not found

### Step 3: Create the MCP server

Create `gemini-review-mcp/src/server.ts`:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { GeminiClient } from './gemini-client.js';
import {
  ReviewCodeInput,
  ReviewResult,
  ReviewFocusArea,
  CodeAuthor
} from './types.js';

/**
 * Schema for the review-code tool input.
 */
const ReviewCodeInputSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  context: z.string().optional(),
  filePath: z.string().optional(),
  language: z.string().optional(),
  focusAreas: z.array(z.enum(['security', 'performance', 'correctness', 'design'])).optional(),
  originalAuthor: z.enum(['claude', 'human', 'unknown']).optional()
});

/**
 * Tool definition for review-code.
 */
const REVIEW_CODE_TOOL: Tool = {
  name: 'review-code',
  description: `Adversarial code review by Google's Gemini model. Specifically designed to find issues that Claude might miss due to similar reasoning patterns.

Returns findings with severity levels:
- critical: Blocks merge until addressed
- major: Requires acknowledgment before merge
- minor: Informational only
- suggestion: Optional improvements

The review is optimized for code written by Claude, looking for:
- Assumptions made without validation
- Edge cases in error handling
- Security vulnerabilities
- Race conditions and concurrency issues
- Resource leaks
- Type coercion edge cases`,
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The code to review'
      },
      context: {
        type: 'string',
        description: 'Additional context about the code (purpose, surrounding code, etc.)'
      },
      filePath: {
        type: 'string',
        description: 'Optional file path for the code'
      },
      language: {
        type: 'string',
        description: 'Programming language (auto-detected if not provided)'
      },
      focusAreas: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['security', 'performance', 'correctness', 'design']
        },
        description: 'Specific areas to focus the review on'
      },
      originalAuthor: {
        type: 'string',
        enum: ['claude', 'human', 'unknown'],
        description: 'Who wrote this code - enables adversarial prompting for claude-written code'
      }
    },
    required: ['code']
  }
};

/**
 * Server info type.
 */
interface ServerInfo {
  name: string;
  version: string;
}

/**
 * Gemini Review MCP Server.
 */
export class GeminiReviewServer {
  private server: Server;
  private geminiClient: GeminiClient;
  private serverInfo: ServerInfo;

  constructor(apiKey: string) {
    this.serverInfo = {
      name: process.env.MCP_SERVER_NAME || 'gemini-review',
      version: process.env.MCP_SERVER_VERSION || '1.0.0'
    };

    this.geminiClient = new GeminiClient({
      apiKey,
      model: process.env.GEMINI_MODEL
    });

    this.server = new Server(
      {
        name: this.serverInfo.name,
        version: this.serverInfo.version
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  /**
   * Get server info.
   */
  getServerInfo(): ServerInfo {
    return { ...this.serverInfo };
  }

  /**
   * List available tools.
   */
  listTools(): Tool[] {
    return [REVIEW_CODE_TOOL];
  }

  /**
   * Call a tool by name.
   */
  async callTool(name: string, args: unknown): Promise<ReviewResult> {
    if (name !== 'review-code') {
      return {
        success: false,
        findings: [],
        summary: {
          totalFindings: 0,
          bySeverity: { critical: 0, major: 0, minor: 0, suggestion: 0 },
          byCategory: {},
          claudeBlindSpots: 0,
          assessment: 'clean',
          mergeRecommendation: {
            blocked: false,
            requiresAcknowledgment: false,
            reason: 'Unknown tool'
          }
        },
        model: 'unknown',
        durationMs: 0,
        error: `Unknown tool: ${name}`
      };
    }

    return this.handleReviewCode(args);
  }

  /**
   * Setup MCP request handlers.
   */
  private setupHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.listTools()
    }));

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'review-code') {
        const result = await this.handleReviewCode(args);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    });
  }

  /**
   * Handle the review-code tool call.
   */
  private async handleReviewCode(args: unknown): Promise<ReviewResult> {
    const startTime = Date.now();

    try {
      // Validate input
      const parsed = ReviewCodeInputSchema.parse(args);

      // Convert to internal type
      const input: ReviewCodeInput = {
        code: parsed.code,
        context: parsed.context,
        filePath: parsed.filePath,
        language: parsed.language,
        focusAreas: parsed.focusAreas as ReviewFocusArea[] | undefined,
        originalAuthor: parsed.originalAuthor as CodeAuthor | undefined
      };

      // Perform review
      const result = await this.geminiClient.reviewCode(input);

      return {
        success: true,
        findings: result.findings,
        summary: result.summary,
        model: this.geminiClient.getConfig().model,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('Review code error:', error);

      return {
        success: false,
        findings: [],
        summary: {
          totalFindings: 0,
          bySeverity: { critical: 0, major: 0, minor: 0, suggestion: 0 },
          byCategory: {},
          claudeBlindSpots: 0,
          assessment: 'clean',
          mergeRecommendation: {
            blocked: false,
            requiresAcknowledgment: false,
            reason: 'Review failed'
          }
        },
        model: this.geminiClient.getConfig().model,
        durationMs: Date.now() - startTime,
        error
      };
    }
  }

  /**
   * Start the server with stdio transport.
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`${this.serverInfo.name} MCP server running on stdio`);
  }
}

/**
 * Create and return a new MCP server instance.
 */
export function createMcpServer(): GeminiReviewServer {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_AI_API_KEY environment variable is required');
  }

  return new GeminiReviewServer(apiKey);
}
```

### Step 4: Update the entry point

Update `gemini-review-mcp/src/index.ts`:

```typescript
#!/usr/bin/env node
import 'dotenv/config';
import { createMcpServer } from './server.js';

async function main() {
  try {
    const server = createMcpServer();
    await server.start();
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();
```

### Step 5: Run tests

```bash
npm run test -- src/server.test.ts
```

Expected: PASS

### Step 6: Commit

```bash
git add gemini-review-mcp/src/
git commit -m "feat(gemini-mcp): add MCP server with review-code tool"
```

---

## Task 5: Integration Test and Manual Verification

**Files:**
- Create: `gemini-review-mcp/src/integration.test.ts`
- Create: `gemini-review-mcp/README.md`

### Step 1: Create integration test

Create `gemini-review-mcp/src/integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GeminiReviewServer, createMcpServer } from './server.js';

/**
 * Integration tests that require actual API key.
 * Skip in CI unless GOOGLE_AI_API_KEY is available.
 */
const SKIP_INTEGRATION = !process.env.GOOGLE_AI_API_KEY;

describe.skipIf(SKIP_INTEGRATION)('Integration: Gemini Review', () => {
  let server: GeminiReviewServer;

  beforeAll(() => {
    server = createMcpServer();
  });

  it('should review simple code', async () => {
    const result = await server.callTool('review-code', {
      code: `
function divide(a, b) {
  return a / b;
}
      `.trim(),
      language: 'javascript',
      originalAuthor: 'claude'
    });

    expect(result.success).toBe(true);
    expect(result.model).toContain('gemini');
    expect(result.durationMs).toBeGreaterThan(0);

    // Should find the division by zero issue
    console.log('Findings:', JSON.stringify(result.findings, null, 2));
  }, 30000); // 30 second timeout for API call

  it('should review code with security focus', async () => {
    const result = await server.callTool('review-code', {
      code: `
function queryUser(userId) {
  const query = "SELECT * FROM users WHERE id = " + userId;
  return db.query(query);
}
      `.trim(),
      language: 'javascript',
      focusAreas: ['security'],
      originalAuthor: 'claude'
    });

    expect(result.success).toBe(true);

    // Should find SQL injection vulnerability
    const securityFinding = result.findings.find(f => f.category === 'security');
    expect(securityFinding).toBeDefined();

    console.log('Security findings:', JSON.stringify(result.findings.filter(f => f.category === 'security'), null, 2));
  }, 30000);

  it('should return merge recommendation', async () => {
    const result = await server.callTool('review-code', {
      code: 'const x = 1;',
      originalAuthor: 'human'
    });

    expect(result.success).toBe(true);
    expect(result.summary.mergeRecommendation).toBeDefined();
    expect(result.summary.mergeRecommendation).toHaveProperty('blocked');
    expect(result.summary.mergeRecommendation).toHaveProperty('requiresAcknowledgment');
    expect(result.summary.mergeRecommendation).toHaveProperty('reason');
  }, 30000);
});

describe('Unit: Tool Validation', () => {
  it('should reject empty code', async () => {
    const server = createMcpServer();
    const result = await server.callTool('review-code', {
      code: ''
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should reject unknown tools', async () => {
    const server = createMcpServer();
    const result = await server.callTool('unknown-tool', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });
});
```

### Step 2: Run integration tests

```bash
# Set your API key first
export GOOGLE_AI_API_KEY=your-key-here

npm run test -- src/integration.test.ts
```

### Step 3: Create README

Create `gemini-review-mcp/README.md`:

```markdown
# Gemini Review MCP Server

An MCP (Model Context Protocol) server that provides adversarial code review using Google's Gemini AI model.

## Purpose

This server is designed to review code written by Claude, finding issues that Claude might miss due to similar reasoning patterns. It implements a "second pair of eyes" approach using a different AI architecture.

## Installation

```bash
npm install
npm run build
```

## Configuration

Create a `.env` file with:

```
GOOGLE_AI_API_KEY=your-google-ai-api-key
GEMINI_MODEL=gemini-2.5-pro-latest
```

## Usage with Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gemini-review": {
      "command": "node",
      "args": ["/path/to/gemini-review-mcp/dist/index.js"],
      "env": {
        "GOOGLE_AI_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Available Tools

### review-code

Performs adversarial code review.

**Parameters:**
- `code` (required): The code to review
- `context`: Additional context about the code
- `filePath`: File path for location reporting
- `language`: Programming language
- `focusAreas`: Array of `['security', 'performance', 'correctness', 'design']`
- `originalAuthor`: `'claude' | 'human' | 'unknown'`

**Returns:**
- `success`: Whether the review completed
- `findings`: Array of issues found
- `summary`: Statistics and merge recommendation
- `model`: Gemini model used
- `durationMs`: Time taken

## Merge Blocking Policy

Findings have severity levels that determine merge behavior:

| Severity | Merge Impact |
|----------|--------------|
| `critical` | Blocks merge until addressed |
| `major` | Requires acknowledgment before merge |
| `minor` | Informational only |
| `suggestion` | Optional improvements |

## Development

```bash
npm run dev      # Watch mode
npm run test     # Run tests
npm run build    # Build for production
```

## Phase 1 Scope

This is Phase 1 - basic MCP server implementation:
- Manual triggering only (no automatic review)
- Single `review-code` tool
- Basic adversarial prompting for Claude-authored code

Future phases will add:
- Adversarial prompt refinement
- TrafficControl integration
- Learning and optimization
```

### Step 4: Commit

```bash
git add gemini-review-mcp/
git commit -m "feat(gemini-mcp): add integration tests and documentation"
```

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `gemini-review-mcp/package.json` | Create | Project configuration and dependencies |
| `gemini-review-mcp/tsconfig.json` | Create | TypeScript configuration |
| `gemini-review-mcp/.env.example` | Create | Environment variable template |
| `gemini-review-mcp/.gitignore` | Create | Git ignore rules |
| `gemini-review-mcp/src/index.ts` | Create | Entry point for MCP server |
| `gemini-review-mcp/src/types.ts` | Create | Type definitions for review system |
| `gemini-review-mcp/src/gemini-client.ts` | Create | Google AI SDK integration |
| `gemini-review-mcp/src/gemini-client.test.ts` | Create | Gemini client unit tests |
| `gemini-review-mcp/src/server.ts` | Create | MCP server implementation |
| `gemini-review-mcp/src/server.test.ts` | Create | Server unit tests |
| `gemini-review-mcp/src/integration.test.ts` | Create | Integration tests |
| `gemini-review-mcp/README.md` | Create | Documentation |

---

## Definition of Done

- [ ] Project structure created with all dependencies
- [ ] Types and interfaces defined for review system
- [ ] GeminiClient implemented with adversarial prompting
- [ ] MCP server implemented with `review-code` tool
- [ ] Tiered merge blocking policy implemented in summary
- [ ] Unit tests pass for all components
- [ ] Integration tests pass with real API (when key available)
- [ ] README documentation complete
- [ ] Server can be started and responds to tool calls
- [ ] Manual verification: test with Claude Desktop or MCP inspector

---

## Out of Scope (Future Phases)

- Phase 2: Adversarial prompt optimization and Claude blind spot patterns
- Phase 3: TrafficControl integration, automatic triggering
- Phase 4: Learning from feedback, prompt tuning based on false positive rates

---

## Test Strategy

### Unit Tests

1. **GeminiClient tests:**
   - Configuration handling (defaults, custom values)
   - Prompt building for different scenarios
   - Response parsing (valid JSON, malformed JSON, edge cases)
   - Severity/category validation

2. **Server tests:**
   - Tool listing
   - Tool call validation (missing required fields, invalid types)
   - Error handling

### Integration Tests

1. **Real API tests** (skipped without API key):
   - Simple code review
   - Code with obvious issues (division by zero, SQL injection)
   - Focus area filtering
   - Merge recommendation generation

### Manual Verification

1. **MCP Inspector:**
   ```bash
   npx @modelcontextprotocol/inspector node dist/index.js
   ```

2. **Claude Desktop:**
   - Add server to config
   - Request code review via Claude
   - Verify findings are returned

---

## Parallel Execution Opportunities

This phase can be split into parallel tasks:

1. **Core Types and Client** (Tasks 1-3): Project setup, types, Gemini client
2. **MCP Server** (Task 4): Server implementation and tool registration
3. **Testing and Docs** (Task 5): Integration tests, README, manual verification

---

## Starter Prompts for Parallel Execution

### Prompt 1: Core Types and Gemini Client

```
You are implementing the Gemini adversarial code review client.

**Context:**
- Building an MCP server that uses Google's Gemini for code review
- Designed to find issues Claude might miss
- Tiered merge blocking: critical blocks, major needs ack, minor is info only

**Your Task:**
Create the following files in `gemini-review-mcp/`:

1. Set up project structure:
   - `package.json` with dependencies: @google/generative-ai, @modelcontextprotocol/sdk, zod, dotenv
   - `tsconfig.json` for ES2022/NodeNext modules
   - `.env.example` with GOOGLE_AI_API_KEY template

2. `src/types.ts` - All type definitions:
   - FindingSeverity: 'critical' | 'major' | 'minor' | 'suggestion'
   - ReviewFinding with severity, category, finding, location, suggestion, confidence, claudeBlindSpot
   - ReviewCodeInput with code, context, focusAreas, originalAuthor
   - ReviewResult with findings, summary, mergeRecommendation

3. `src/gemini-client.ts` - Google AI integration:
   - Constructor accepting GeminiConfig (apiKey, model, temperature)
   - reviewCode() method that builds adversarial prompts
   - buildSummary() that calculates merge recommendation based on tiered policy
   - JSON response parsing with error handling

4. `src/gemini-client.test.ts` - Unit tests

**Reference:** See traffic-control/docs/plans/gemini-mcp-phase1.md for detailed specifications.
```

### Prompt 2: MCP Server Implementation

```
You are implementing the MCP server for Gemini adversarial code review.

**Context:**
- Building on top of GeminiClient (already implemented)
- MCP server exposes tools that Claude can call
- Phase 1: single 'review-code' tool, manual triggering only

**Your Task:**
Create the following files in `gemini-review-mcp/src/`:

1. `server.ts` - MCP server implementation:
   - Use @modelcontextprotocol/sdk Server class
   - Define 'review-code' tool with proper schema
   - Handle ListToolsRequest and CallToolRequest
   - Input validation using zod
   - Return ReviewResult as JSON

2. `server.test.ts` - Unit tests:
   - Server creation
   - Tool listing
   - Tool call handling
   - Error cases (invalid input, unknown tool)

3. Update `index.ts` - Entry point:
   - Create server instance
   - Start with stdio transport
   - Error handling for missing API key

**Success Criteria:**
- Server starts without errors
- `review-code` tool appears in tool list
- Tool calls return ReviewResult JSON
- Invalid inputs return error responses

**Reference:** See traffic-control/docs/plans/gemini-mcp-phase1.md for detailed specifications.
```

### Prompt 3: Testing and Documentation

```
You are completing the testing and documentation for Gemini MCP server.

**Context:**
- MCP server is implemented and basic unit tests exist
- Need integration tests and manual verification steps
- Need comprehensive README

**Your Task:**

1. `src/integration.test.ts` - Integration tests:
   - Test real API calls (skip if no API key)
   - Test with code that has obvious issues (SQL injection, division by zero)
   - Test merge recommendation generation
   - 30 second timeouts for API calls

2. `README.md` - Complete documentation:
   - Installation and configuration
   - Claude Desktop setup instructions
   - Tool documentation with examples
   - Merge blocking policy explanation
   - Development commands

3. Manual verification steps:
   - Document how to test with MCP Inspector
   - Document how to test with Claude Desktop

**Success Criteria:**
- Integration tests pass with real API key
- README is complete and accurate
- Manual testing steps are documented and work

**Reference:** See traffic-control/docs/plans/gemini-mcp-phase1.md for detailed specifications.
```
