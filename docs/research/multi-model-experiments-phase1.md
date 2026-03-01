# Research: Multi-Model Experiments — Phase 1

**Status:** Research complete — awaiting experiment execution
**Created:** 2026-03-01
**Author:** Worker session (dispatch: 2026-03-01-traffic-control-multi-model-experiments-research)
**Source:** [Multi-Model Collaboration Experiments backlog item](../backlog/multi-model-experiments.md)

---

## Executive Summary

TrafficControl already runs adversarial review (Claude writes → Gemini reviews → Claude addresses). The highest-value next step is extending that into an **iterative refinement loop**: a second Gemini review pass after Claude addresses Phase 1 findings. This experiment is runnable with existing infrastructure (Gemini MCP + adversarial prompting), requires one new table column, and produces a directly measurable quality signal: what fraction of Phase 1 findings survive after Claude's remediation.

---

## Section 1: Landscape

Five multi-model collaboration patterns are relevant to autonomous software engineering agents in 2026. All are runnable with Claude + Gemini only.

### Pattern 1 — Adversarial Review (Baseline, Already In Place)

```
Claude writes code → Gemini reviews → Claude addresses findings
```

**How it works:** Gemini is adversarially prompted to find issues Claude might miss due to shared training assumptions. Findings are tiered (critical/major/minor); critical findings block merge.

**2026 context:** "AI-on-AI" code reviews are now mainstream in production pipelines. GitHub Copilot Agent Mode, Google ADK, and OpenAI's Agents SDK all support cross-model review as a first-class workflow. Industry data suggests cross-model review catches a different class of issues than same-model self-review — researchers attribute this to **architectural blind spots** (different training data → different assumption failures). See: [Blueprint2Code, Frontiers in AI, 2025](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1660912/full); [ACM survey on LLM-based multi-agent systems](https://dl.acm.org/doi/10.1145/3712003).

**TC status:** Phase 1 MCP server complete. Phase 2 (adversarial prompting templates) queued. Phase 3 (dynamic triggering) designed. This is the baseline all other patterns are compared against.

---

### Pattern 2 — Iterative Refinement Loop

```
Claude v1 → Gemini critique → Claude v2 → Gemini critique → ... → convergence
```

**How it works:** Multiple rounds of cross-model critique and revision. The loop terminates when Gemini finds no new major/critical findings, or a max-iteration limit is hit (typically 2–3 rounds before diminishing returns).

**2026 context:** Research on self-debugging (2024–2025) shows LLMs improve accuracy by up to **+12%** when given execution traces or review feedback to iterate against. The PAIR algorithm demonstrates that iterative refinement loops converge within 3–5 rounds. Blueprint2Code (2025) achieves highest SWE-bench scores using a spec → implement → repair loop. The pattern is well-validated. Key constraint: cost grows linearly with rounds; 3 rounds is the practical ceiling given TC's cost model. See: [Self-Debugging, emergentmind.com](https://www.emergentmind.com/topics/self-evolving-large-language-models-llms); [Blueprint2Code, PMC 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12575318/).

**TC status:** Not yet implemented. Directly extends existing adversarial review infrastructure.

---

### Pattern 3 — Spec-Build-Verify Pipeline

```
Claude creates spec + prompts → Gemini implements → Claude verifies against spec
```

**How it works:** Claude's strength (planning, specification, verification) handles bookend stages; Gemini handles implementation to avoid Claude's implementation assumptions being baked into the spec. Claude then checks whether the implementation matches the spec it wrote.

**2026 context:** Multi-stage CoT pipelines (CodeCoT, AlphaCodium) outperform single-pass generation on SWE-bench by dividing the problem into reasoning phases. The key insight is that **planning and execution have different failure modes** — a model that writes a spec may inject assumptions that corrupt its own implementation. Cross-model implementation breaks this feedback loop. See: [LLM Agent Survey, arxiv 2508.00083](https://arxiv.org/html/2508.00083v1); [Google Developers Blog on multi-agent frameworks](https://developers.googleblog.com/architecting-efficient-context-aware-multi-agent-framework-for-production/).

**TC status:** Not yet implemented. Requires orchestrator changes to route tasks to Gemini for implementation — significantly more complex than review-only integration.

---

### Pattern 4 — Adversarial Red Team

```
Claude builds → Gemini tries to break it → Claude fixes → Gemini attacks again
```

**How it works:** Gemini is explicitly prompted to *find exploits and break the code*, not just review it. More aggressive than Pattern 1 — Gemini generates attack inputs, identifies failure modes, probes for security holes. Runs as a post-build step, not inline.

**2026 context:** RedCoder (2025) formalizes multi-turn adversarial probing for code LLMs and consistently outperforms single-pass review at finding vulnerabilities. The multi-agent gaming dynamic (attacker → defender → evaluator) is now a standard pattern in security-oriented pipelines. For TC's task types (software engineering agents, Supabase writes, Slack integrations), injection and auth bypass are the realistic attack surface. See: [RedCoder, arxiv 2507.22063](https://arxiv.org/html/2507.22063v1); [OWASP LLM Top 10, 2025](https://venturebeat.com/security/red-teaming-llms-harsh-truth-ai-security-arms-race).

**TC status:** Not yet implemented. Requires different Gemini prompt templates (attack-mode vs. review-mode) and a test harness for Gemini to generate attack inputs.

---

### Pattern 5 — Parallel Implementation + Consensus

```
Spec → [Claude implements | Gemini implements] → diff, compare, merge best parts
```

**How it works:** Both models implement the same spec independently. Diff the outputs; flag divergence for human review or automatic merge (taking the better-scored solution). Useful when there are multiple valid approaches and divergence highlights architectural uncertainty.

**2026 context:** Ensemble approaches reduce individual model error rates but at 2x cost. Research on "Language Model Council" ensembles shows ensemble judges reduce self-enhancement bias in evaluation. The main finding: ensembles are most valuable when tasks have multiple valid solutions (ambiguous specs) — but autonomous agent tasks typically have clearer correctness criteria (tests pass / don't pass). See: [LLM Ensemble evaluation, NAACL 2025](https://aclanthology.org/2025.naacl-long.617.pdf).

**TC status:** Not yet implemented. Highest cost and complexity of all five patterns; lowest incremental value given TC's task profile.

---

## Section 2: TrafficControl Fit

Ranked from most to least applicable. Adversarial Review (Pattern 1) is already in place; rankings reflect what to build **next**.

| Rank | Pattern | Applicability | Rationale |
|------|---------|--------------|-----------|
| 1 (baseline) | Adversarial Review | **Already running** | MCP Phase 1 complete; generates `tc_review_log` data |
| 2 | Iterative Refinement Loop | **High** | Builds directly on existing Gemini MCP; minimal orchestration changes; directly measurable quality delta |
| 3 | Adversarial Red Team | **Medium** | High value for security-sensitive tasks; requires new Gemini prompt templates but same MCP infrastructure; lower task coverage than iterative loop |
| 4 | Spec-Build-Verify | **Medium-Low** | High value in theory; requires routing Gemini as *implementer* not reviewer — significant orchestrator changes; no existing infrastructure |
| 5 | Parallel Implementation | **Low** | 2x cost, high complexity, marginal expected gain for TC's task types (most tasks have clear correctness signals, not ambiguous specs) |

**Key constraints driving these rankings:**

1. **Infrastructure reuse:** Patterns that extend the Gemini MCP review tool have near-zero setup cost. Patterns that route Gemini as an implementer require new agent spawning logic.

2. **TC task profile:** TC agents do software engineering tasks with concrete acceptance criteria (tests, database state, Slack messages). This profile favors quality-verification patterns (Patterns 1, 2, 4) over exploration patterns (Pattern 5).

3. **Claude+Gemini only:** Patterns 5 and role-specialization approaches with GPT-4 are out of scope for Phase 1.

4. **Cost ceiling:** TC's existing daily review budget ($2/day) limits auto-triggered patterns. The proposed experiment (Section 3) is designed to stay within this budget.

---

## Section 3: Proposed Experiment

### Experiment: Two-Pass Iterative Refinement

**Pattern:** Iterative Refinement Loop (Pattern 2), limited to exactly 2 passes.

**Why this, not Red Team or Spec-Build-Verify?**
Adversarial Red Team is highest-value for security tasks but covers a narrower task set than iterative refinement. Spec-Build-Verify requires routing Gemini as implementer — too much infra work to be the *first* experiment. The iterative refinement loop extends the existing review pipeline with one extra step and produces a directly measurable output.

---

### Hypothesis

A second Gemini review pass (after Claude addresses Phase 1 findings) will reduce the count of remaining major/critical findings by ≥30% compared to single-pass review — i.e., Claude's remediation of Phase 1 findings is incomplete often enough to warrant a second look.

**Null hypothesis:** Pass 2 finds no new major/critical findings in ≥80% of tasks (iterative refinement adds cost without value).

---

### What to Measure

| Metric | Baseline | Target | How to Collect |
|--------|----------|--------|----------------|
| Pass-2 critical/major findings per task | Unknown | Establish baseline | Count from `tc_review_log.findings_critical + findings_major` for pass-2 rows |
| Pass-1 → Pass-2 finding reduction rate | Unknown | ≥30% reduction in surviving major/critical issues | Compare pass-1 and pass-2 finding counts for same `task_id` |
| False positive rate (pass 2) | <20% (target from Phase 2) | Same | `findings_validated / total_findings` in `tc_review_log` |
| Cost per task (2-pass vs 1-pass) | ~$0.05–0.15 (1-pass Flash) | <2x single-pass | `sum(cost_usd)` grouping by `task_id` and `pass_number` |
| Pass-2 trigger rate (tasks where pass-2 finds something) | Unknown | Establish baseline | `count(pass_number=2 and total_findings > 0) / total tasks` |

**Minimum sample:** 20 tasks running 2-pass review to detect a 30% quality improvement with acceptable confidence.

---

### Input / Output Spec

**Input to experiment (per task):**
- Task is in `complete` or `review` status
- Task has a code diff available (same requirement as existing Gemini review)
- Task is auto-selected by dynamic triggering (any trigger criterion matches) OR has `gemini-required` tag

**Pass 1 (existing behavior):**
```
Claude writes code → Gemini reviews → Claude addresses findings → task transitions to next state
```

**Pass 2 (new behavior):**
```
After Claude's remediation: call Gemini review-code again with the SAME code diff context
plus a "remediation context" string summarizing what Claude changed in response to Pass 1.
```

**Pass 2 Gemini call parameters:**
```typescript
{
  code: revisedDiff,          // diff after Claude's remediation
  context: task.description + '\n\nPrevious review summary: ' + pass1Summary,
  focusAreas: pass1.findings_by_category,  // focus on same categories as pass 1
  originalAuthor: 'claude',
  reviewPass: 2               // new field; signals adversarial prompt to focus on remediation gaps
}
```

**Output:**
- Standard `ReviewResult` array written to `tc_review_log` with `pass_number = 2`
- If pass-2 finds new critical findings → re-open task (same merge-blocking policy as pass-1)
- If pass-2 finds only minor/suggestions → proceed with merge

---

### Cost Estimate

| Item | Model | Est. Cost | Notes |
|------|-------|-----------|-------|
| Pass 1 review (existing) | Gemini 2.5 Flash | $0.05–0.15 | Already budgeted |
| Pass 2 review per task | Gemini 2.5 Flash | $0.05–0.15 | +same context size as pass 1 |
| 20-task experiment total | Flash | ~$2.00–6.00 | Over 1–2 weeks at normal TC velocity |
| Per-task overhead (Claude addressing pass-1 findings) | Claude Sonnet | ~$0.20–0.50 | Normal task cost, not incremental |

**Net experiment cost: $2–6 over 1–2 weeks, well within existing $10/week budget cap.**

If pass-2 trigger rate is low (≤30% of tasks have pass-2 findings), ongoing 2-pass cost adds ≤$0.15/task average — acceptable.

---

### Data Collection Within TC's Existing Infrastructure

**Supabase:**
- All experiment data written to `tc_review_log` (once the table exists — see Section 4)
- Query to track experiment progress:
  ```sql
  SELECT
    pass_number,
    count(*) as tasks,
    avg(total_findings) as avg_findings,
    avg(findings_critical + findings_major) as avg_major_plus_critical,
    avg(cost_usd) as avg_cost
  FROM tc_review_log
  WHERE created_at > now() - interval '30 days'
  GROUP BY pass_number
  ORDER BY pass_number;
  ```

**Slack:**
- Existing review notification extended to include pass number: "Gemini review (pass 2) completed — 2 new findings"
- Weekly Slack report (already planned in reporter module) should include: pass-2 trigger rate, pass-2 finding rate, 2-pass vs 1-pass cost ratio

**Experiment conclusion criteria:**
- ≥20 tasks with pass-2 reviews collected
- Review `findings_validated` field for pass-2 entries (confirms real findings vs. false positives)
- If pass-2 finding rate < 15% → stop iterative refinement, return to single-pass
- If pass-2 finding rate ≥ 30% → iterative refinement is valuable; extend to all triggered tasks by default

---

## Section 4: Gaps

What TC needs to add before running the proposed experiment. Items are ordered by dependency.

### 4.1 — `tc_review_log` Table (Blocking)

**Status:** Designed in `docs/research/gemini-dynamic-triggering-design.md`, not yet created.
**Required change:** Run the `CREATE TABLE tc_review_log` DDL from that document against the Supabase instance.
**Experiment dependency:** Pass-1 and Pass-2 results must be stored here with a `pass_number` column to enable comparison queries.

**Additional column needed for this experiment (not in current design):**
```sql
ALTER TABLE tc_review_log ADD COLUMN pass_number INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_tc_review_log_pass ON tc_review_log(task_id, pass_number);
```

---

### 4.2 — Gemini MCP Phase 2: Adversarial Prompting Templates (Blocking)

**Status:** Queued, not started.
**Required change:** Adversarial prompting must be in place before meaningful comparison across passes. Without Phase 2 prompting, Gemini reviews are friendly reviews — the blind-spot detection that motivates multi-pass is not active.
**Experiment dependency:** Pass-1 findings must be generated with adversarial prompts for pass-2 comparison to be meaningful.

---

### 4.3 — Orchestrator Multi-Pass Review Hook

**Status:** Not started. Phase 3 of Gemini adversarial review designs the single-pass hook; 2-pass is an extension.
**Required change:** After Claude addresses Pass-1 findings and completes remediation, the orchestrator must:
1. Detect that a pass-2 review is warranted (based on pass-1 finding count or task tags)
2. Call `review-code` again with the revised diff and remediation context string
3. Write results to `tc_review_log` with `pass_number = 2`
4. Apply merge-blocking policy from pass-2 results

**Estimated scope:** ~100–150 LoC addition to the Phase 3 `ReviewTrigger` class. No new MCP tools needed.

---

### 4.4 — Gemini MCP Phase 3: Dynamic Triggering (Non-blocking but recommended)

**Status:** Designed (this document's sibling), not implemented.
**Required for what:** Without dynamic triggering, 2-pass review must be manually requested via task tags. The experiment can begin with tag-based opt-in but will only reach 20+ samples automatically once triggering is enabled.
**Experiment dependency:** Can start experiment manually with `gemini-required` tags; auto-triggering accelerates sample collection.

---

### 4.5 — `pass_number` Field in Gemini MCP `review-code` Tool

**Status:** Not in current MCP interface design.
**Required change:** Add optional `reviewPass?: number` parameter to `review-code` tool input. The adversarial prompt should vary slightly for pass-2: "This code has already been reviewed once and the author addressed the findings. Your job is to find remaining issues and issues introduced during remediation."
**Estimated scope:** 1-line parameter addition + prompt template variant.

---

### Summary of Gaps by Priority

| Gap | Blocking? | Estimated Effort |
|-----|-----------|-----------------|
| Create `tc_review_log` table + `pass_number` column | Yes | 30 min (SQL + migration) |
| Gemini MCP Phase 2 adversarial prompting | Yes | Separate backlog item |
| Orchestrator multi-pass hook | Yes | ~150 LoC, 1 session |
| `pass_number` param in review-code tool | Yes (small) | 30 min |
| Gemini MCP Phase 3 dynamic triggering | No (can use tags) | Separate backlog item |

The experiment is runnable with manual `gemini-required` tags once gaps 1, 2, and 3 are closed. Dynamic triggering (gap 5) accelerates sample collection but is not required to start.

---

## References

- [ACM survey on LLM-based multi-agent systems for software engineering](https://dl.acm.org/doi/10.1145/3712003)
- [Blueprint2Code: multi-agent spec→build→verify, Frontiers in AI 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12575318/)
- [Survey on Code Generation with LLM-based Agents, arxiv 2508.00083](https://arxiv.org/html/2508.00083v1)
- [RedCoder: Multi-turn adversarial red teaming for Code LLMs, 2025](https://arxiv.org/html/2507.22063v1)
- [Google Developers Blog: Multi-agent context architecture](https://developers.googleblog.com/architecting-efficient-context-aware-multi-agent-framework-for-production/)
- [LLM ensemble evaluation, NAACL 2025](https://aclanthology.org/2025.naacl-long.617.pdf)
- TC internal: [gemini-adversarial-code-review.md](../backlog/gemini-adversarial-code-review.md)
- TC internal: [gemini-dynamic-triggering-design.md](./gemini-dynamic-triggering-design.md)
