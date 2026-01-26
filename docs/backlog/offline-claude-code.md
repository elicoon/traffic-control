# Backlog Item: Offline Claude Code - Local Hardware AI Stack

**Priority:** Medium (Strategic Infrastructure)
**Type:** Infrastructure / Platform Development
**Status:** Research Complete - Implementation Plan Ready
**Created:** 2026-01-26
**Updated:** 2026-01-26
**Depends On:** None (Greenfield project)
**Implementation Plan:** [offline-claude-code-implementation.md](../plans/offline-claude-code-implementation.md)

---

## Problem Statement

Current Claude Code usage is entirely dependent on:
1. **Internet connectivity** - No work possible without network access
2. **Anthropic API availability** - Subject to outages, rate limits, capacity constraints
3. **Usage limits** - Weekly caps on Opus/Sonnet usage create hard ceilings
4. **Cost** - API calls incur ongoing operational expenses
5. **Data privacy** - All code and context sent to external servers

Building an offline-capable version of Claude Code running on local hardware would provide:
- **Full vertical control** of the AI stack
- **Zero internet dependency** for development work
- **Unlimited usage** (no weekly caps)
- **Complete data sovereignty** - code never leaves local network
- **Predictable costs** - one-time hardware investment vs ongoing API costs
- **Redundancy** - fallback when cloud services unavailable

## Proposed Architecture

### Hardware Requirements

#### Option A: Consumer Hardware (Budget-Friendly)
```
GPU: NVIDIA RTX 4090 (24GB VRAM) or RTX 5090 (32GB VRAM when available)
RAM: 128GB DDR5
CPU: AMD Ryzen 9 / Intel i9 (high core count for inference optimization)
Storage: 2TB NVMe SSD (fast model loading)
Estimated Cost: $4,000 - $6,000
```
- Can run 7B-13B parameter models with good performance
- 70B models possible with quantization (Q4/Q5)

#### Option B: Prosumer Hardware (Best Balance)
```
GPU: 2x NVIDIA RTX 4090 or A6000 (48GB VRAM)
RAM: 256GB DDR5
CPU: AMD Threadripper / Intel Xeon
Storage: 4TB NVMe RAID
Estimated Cost: $10,000 - $15,000
```
- Can run 70B parameter models at good speeds
- Multiple concurrent inference possible

#### Option C: Enterprise Hardware (Maximum Capability)
```
GPU: NVIDIA A100 (80GB) or H100 cluster
RAM: 512GB+
CPU: Dual AMD EPYC / Intel Xeon
Storage: Enterprise NVMe array
Estimated Cost: $30,000 - $100,000+
```
- Can run largest open models (180B+)
- Multi-user/multi-agent concurrent operation

### Software Stack

```
┌─────────────────────────────────────────────────────────┐
│                   Claude Code CLI                        │
│            (Modified to support local backend)           │
├─────────────────────────────────────────────────────────┤
│                  Local Inference API                     │
│         (OpenAI-compatible API interface)                │
├─────────────────────────────────────────────────────────┤
│              Inference Engine Options                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐      │
│  │ llama.cpp│  │  vLLM    │  │ text-generation- │      │
│  │          │  │          │  │ inference (TGI)  │      │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│                   Model Layer                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Primary: DeepSeek Coder V3 / Qwen2.5-Coder-32B  │  │
│  │ Fallback: CodeLlama 70B / Mistral Large         │  │
│  │ Fast: Qwen2.5-7B for simple tasks               │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Model Selection Criteria

| Model | Parameters | VRAM Required | Code Quality | Speed |
|-------|------------|---------------|--------------|-------|
| DeepSeek Coder V3 | 236B (MoE) | 48GB+ (quantized) | Excellent | Medium |
| Qwen2.5-Coder-32B | 32B | 24GB (Q4) | Very Good | Fast |
| CodeLlama 70B | 70B | 40GB (Q4) | Good | Medium |
| Mistral Large | 123B | 64GB (Q4) | Good | Slow |
| Qwen2.5-7B-Instruct | 7B | 8GB | Acceptable | Very Fast |

**Recommended Primary Model:** DeepSeek Coder V3 or Qwen2.5-Coder-32B
- Best open-source code generation quality as of 2026
- Competitive with Claude Sonnet on coding benchmarks
- Active development and frequent improvements

## Implementation Phases

### Phase 1: Research & Benchmarking
- [ ] Benchmark top open-source code models on TrafficControl-style tasks
- [ ] Evaluate inference engines (llama.cpp vs vLLM vs TGI)
- [ ] Test quantization impact on code quality
- [ ] Measure tokens/second on target hardware
- [ ] Compare output quality to Claude Sonnet/Opus baseline

### Phase 2: Local Inference Server
- [ ] Set up inference server with chosen engine
- [ ] Implement OpenAI-compatible API endpoint
- [ ] Add model switching capability (fast vs quality)
- [ ] Implement context window management
- [ ] Add request queuing for multiple agents

### Phase 3: Claude Code Integration
- [ ] Fork/modify Claude Code CLI for local backend
- [ ] Implement backend abstraction layer
- [ ] Support seamless switching between cloud and local
- [ ] Maintain tool/MCP compatibility
- [ ] Handle function calling / tool use format differences

### Phase 4: Feature Parity
- [ ] Implement all Claude Code tools with local model
- [ ] Test and tune prompts for local model quirks
- [ ] Add local model-specific optimizations
- [ ] Implement caching layer for repeated queries
- [ ] Add RAG (Retrieval Augmented Generation) for codebase context

### Phase 5: TrafficControl Integration
- [ ] Add local inference as capacity pool in scheduler
- [ ] Implement hybrid routing (cloud for complex, local for simple)
- [ ] Track cost savings and quality metrics
- [ ] Auto-fallback when cloud unavailable

## Key Technical Challenges

### 1. Tool/Function Calling
Open models have inconsistent function calling capabilities. Solutions:
- Use models with native tool support (Qwen2.5, Mistral)
- Implement structured output parsing with grammar constraints
- Fine-tune on Claude Code's tool format if needed

### 2. Context Window
Most open models have smaller context (32k-128k vs Claude's 200k). Solutions:
- Implement smart context compression
- Use RAG for codebase retrieval instead of full context
- Chain smaller requests instead of single large ones

### 3. Code Quality Gap
Open models may not match Claude's code quality. Mitigations:
- Use larger models (70B+) for complex tasks
- Implement multi-pass generation with self-review
- Route only appropriate tasks to local (simple fixes, boilerplate)
- Use as "draft" generator with cloud review

### 4. Prompt Compatibility
Claude Code prompts are optimized for Claude. Solutions:
- Create prompt translation layer
- Develop local-model-specific system prompts
- A/B test prompt variations for each model

## Cost-Benefit Analysis

### Ongoing Cloud Costs (Current State)
```
Opus usage: ~$X per week (estimated from usage patterns)
Sonnet usage: ~$Y per week
Annual cost: ~$Z
```

### One-Time Hardware Investment
```
Option B setup: $12,000
Electricity: ~$50/month ($600/year)
Maintenance/Upgrades: ~$500/year
3-Year TCO: $13,700
```

### Break-Even Analysis
```
If annual cloud costs > $4,500 → Hardware pays for itself in 3 years
Additional value: Unlimited usage, no caps, privacy, availability
```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Model quality insufficient | Medium | High | Maintain cloud fallback, task routing |
| Hardware maintenance burden | Low | Medium | Redundant components, monitoring |
| Open model development stalls | Low | Medium | Multiple model options, commodity hardware |
| Claude Code breaks compatibility | Medium | High | Abstraction layer, version pinning |
| Power costs exceed estimates | Low | Low | Monitor usage, optimize scheduling |

## Success Metrics

| Metric | Target |
|--------|--------|
| Task completion rate (vs cloud) | >80% |
| Code quality score (vs cloud) | >85% |
| Average latency per request | <30 seconds |
| Uptime | >99% |
| Monthly cost (after hardware) | <$100 |
| Tasks runnable offline | >70% of TrafficControl workload |

## Open Questions

1. Should we prioritize code quality (larger model) or speed (smaller model)?
2. Is custom fine-tuning on our coding style worth the effort?
3. Should we build redundancy (multiple machines)?
4. How to handle multi-modal needs (image understanding)?
5. Should we expose this as a service for other local projects?

## Related Research

- Local LLM communities: r/LocalLLaMA, llama.cpp GitHub
- Model benchmarks: HuggingFace Open LLM Leaderboard, BigCode
- Inference optimization: ExLlamaV2, AWQ, GGUF formats
- Similar projects: Ollama, LM Studio, LocalAI

## Next Steps

1. **Immediate:** Research current state of open-source code models (2026 landscape)
2. **Short-term:** Benchmark top candidates on representative tasks
3. **Medium-term:** Acquire hardware based on benchmark results
4. **Long-term:** Full implementation and TrafficControl integration

## Notes

This project aligns with TrafficControl's core principle of removing constraints. Currently, cloud API limits are a hard constraint. Local inference converts this from a rate limit to a quality tradeoff - we can always make progress, just at potentially lower quality for complex tasks.

The hybrid approach is key: use cloud Claude for complex reasoning and architecture, local models for high-volume simple tasks (formatting, boilerplate, simple fixes). This maximizes value from both systems.

Hardware should be treated as a strategic investment, not just cost savings. The ability to work without internet, without limits, and without sending proprietary code to external servers has value beyond the pure economics.
