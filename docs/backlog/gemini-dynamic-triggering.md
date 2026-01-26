# Backlog Item: Dynamic Gemini Review Triggering

**Priority:** Low
**Type:** Enhancement
**Status:** Proposed
**Created:** 2026-01-26
**Depends On:** [Gemini Adversarial Code Review MCP Server](./gemini-adversarial-code-review.md)

---

## Problem Statement

The initial Gemini adversarial review implementation uses manual triggering only. Once TrafficControl is more mature and we have data on review effectiveness, we should implement smarter automatic triggering to balance coverage vs. API costs.

## Proposed Solution

Design a dynamic triggering system that automatically requests Gemini reviews based on:

### Potential Trigger Criteria

1. **Security-sensitive paths**
   - Auth/authentication code
   - Payment processing
   - Data handling/PII
   - API endpoints
   - Crypto/encryption

2. **Change size thresholds**
   - Lines changed > N (configurable, e.g., 50)
   - Files changed > N
   - Complexity metrics

3. **Risk scoring**
   - Historical bug density in affected files
   - Time since last review
   - Author experience with codebase area

4. **Pattern matching**
   - Changes to error handling
   - New external API integrations
   - Database schema changes
   - Dependency updates

5. **Learning-based**
   - Files where Gemini previously found valid issues
   - Code patterns that correlate with bugs

## Data to Collect First

Before implementing, gather data from manual reviews:
- Which reviews found valid issues?
- What types of code had the most findings?
- False positive rate by code type
- Cost per review type

## Open Questions

1. What's the acceptable cost budget per day/week?
2. Should we have a "review debt" concept for skipped reviews?
3. How to handle review fatigue if too many auto-triggers?

## Related

- Parent feature: [Gemini Adversarial Code Review](./gemini-adversarial-code-review.md)
