# Offline Claude Code Implementation Plan

**Project:** Local Hardware AI Stack for Offline Claude Code Functionality
**Created:** 2026-01-26
**Status:** Research Complete - Ready for Implementation
**Priority:** Strategic Infrastructure

---

## Executive Summary

This document outlines a comprehensive plan to build an offline version of Claude Code running on local hardware, providing full vertical control of the AI stack with all the same functionality without an internet connection.

Based on extensive research into the current landscape (January 2026), this is now highly feasible due to:
1. Open-source code models matching Claude Sonnet quality (GLM-4.7, Qwen3-Coder, Kimi K2)
2. Mature inference engines (vLLM, SGLang, llama.cpp)
3. Consumer hardware capable of running 70B+ models (RTX 5090, dual 4090s)
4. Open-source Claude Code alternatives with local model support (OpenCode, Aider)
5. MCP protocol compatibility with local LLMs

---

## Part 1: Current Landscape Analysis

### 1.1 Open-Source Code Models (2026 State of the Art)

| Model | Parameters | SWE-bench Score | License | Best For |
|-------|-----------|-----------------|---------|----------|
| **GLM-4.7** | ~100B | 73.8% | MIT | Agentic coding, tool use |
| **DeepSeek V3.2-Speciale** | 671B (MoE) | 73.1% | Open | Complex reasoning |
| **MiniMax M2.1** | ~100B | 77% | Open | Best quality/cost ratio |
| **Qwen3-Coder** | 480B/30B | 70.6% | Apache 2.0 | Local deployment |
| **Kimi K2** | ~200B | 65.4%+ | Open | Speed (5x faster) |
| Claude Sonnet 4.5 (ref) | - | 77.2% | Proprietary | Baseline comparison |

**Key Finding:** Open-source models now achieve 90-95% of Claude Sonnet's coding performance.

**Recommended Primary Model:** **Qwen3-Coder-30B-A3B** (30B total, 3.3B activated)
- Apache 2.0 license (commercial use OK)
- 256K context window (extendable to 1M)
- Optimized for local inference
- Strong tool/function calling support
- ~18GB VRAM with Q4 quantization

**Recommended Fallback:** **GLM-4.7** for complex agentic tasks requiring multi-turn reasoning

### 1.2 Existing Local LLM Coding Tools

| Tool | Stars | Local Model Support | Tool Use | Best For |
|------|-------|---------------------|----------|----------|
| **OpenCode** | 48K+ | 75+ providers, Ollama | Full | Claude Code replacement |
| **Aider** | 25K+ | Ollama, any OpenAI API | Edit-based | Git-integrated pair programming |
| **Cline** | 48K+ | Ollama (limited) | Partial | VS Code integration |
| **Continue.dev** | 20K+ | Ollama, LM Studio | Full | IDE autocomplete + chat |
| **Open Interpreter** | 60K+ | Ollama, LM Studio | Full | System automation |

**Key Finding:** OpenCode is the most promising base - it's essentially an open-source Claude Code with provider flexibility.

### 1.3 Inference Engines Comparison

| Engine | Best For | Throughput | Ease of Setup | GPU Support |
|--------|----------|------------|---------------|-------------|
| **vLLM** | Production serving | Highest (15K+ tok/s) | Medium | NVIDIA, AMD |
| **SGLang** | Structured output | Very High (16K+ tok/s) | Complex | NVIDIA |
| **llama.cpp** | CPU/Edge/Hybrid | Good | Easy | NVIDIA, AMD, Apple, CPU |
| **Ollama** | Getting started | Good | Very Easy | NVIDIA, AMD, Apple |
| **LMDeploy** | Production alternative | Very High | Easy | NVIDIA |

**Recommendation:**
- **Development/Testing:** Ollama (easiest setup)
- **Production:** vLLM or LMDeploy (best throughput)
- **Apple Silicon:** llama.cpp with MLX backend

### 1.4 Hardware Options

#### Option A: Consumer Budget (~$3,500)
```
GPU: NVIDIA RTX 5090 (32GB GDDR7)
     - 213 tok/s on 8B models, 61 tok/s on 32B models
     - Runs 70B Q4 models with 32K context
     - 1.79 TB/s memory bandwidth
CPU: AMD Ryzen 9 7950X or Intel i9-14900K
RAM: 64GB DDR5-6000
Storage: 2TB NVMe Gen4
PSU: 1000W 80+ Gold
Total: ~$3,500
```

#### Option B: Enthusiast (~$6,000)
```
GPU: 2x NVIDIA RTX 4090 (48GB combined)
     - No NVLink needed (model splits over PCIe)
     - Runs 70B models at ~27 tok/s
     - Full 70B at Q4 with large context
CPU: AMD Ryzen 9 7950X3D
RAM: 128GB DDR5
Storage: 4TB NVMe RAID
PSU: 1600W
Total: ~$6,000
```

#### Option C: Apple Silicon (~$4,500)
```
Mac Studio M4 Max (128GB unified memory)
     - Runs 70B models at 30-45 tok/s
     - Silent operation, low power (~180W)
     - Native MLX optimization
     - Excellent for development
Total: ~$4,500
```

#### Option D: Maximum Local Capability (~$15,000)
```
GPU: 2x NVIDIA RTX 5090 (64GB combined)
     - Matches H100 performance for 70B models
     - 27 tok/s for 70B, full context support
CPU: AMD Threadripper 7970X
RAM: 256GB DDR5 ECC
Storage: 8TB NVMe RAID
Total: ~$15,000
```

---

## Part 2: Architecture Design

### 2.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Interface Layer                         │
├──────────────────────────┬──────────────────────────────────────────┤
│     OpenCode CLI         │         TrafficControl Integration       │
│  (Claude Code compat)    │      (Scheduler, Orchestrator, Slack)    │
├──────────────────────────┴──────────────────────────────────────────┤
│                       Abstraction Layer                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Unified Provider Interface                      │   │
│  │   - Cloud backends (Claude, GPT, Gemini)                    │   │
│  │   - Local backends (Ollama, vLLM, LMDeploy)                 │   │
│  │   - Hybrid routing based on task complexity                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│                      MCP Server Layer                                │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────┐   │
│  │Filesystem │ │   Git     │ │ Database  │ │ Custom Tools      │   │
│  │  Server   │ │  Server   │ │  Server   │ │ (Browser, etc)    │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│                     Local Inference Layer                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Inference Router                          │   │
│  │   - Model selection based on task type                       │   │
│  │   - Load balancing across GPUs                               │   │
│  │   - Request queuing and batching                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │ Primary Model│ │  Fast Model  │ │  RAG Engine  │               │
│  │ Qwen3-Coder  │ │  Qwen2.5-7B  │ │  + Embeddings│               │
│  │    32B       │ │              │ │              │               │
│  └──────────────┘ └──────────────┘ └──────────────┘               │
├─────────────────────────────────────────────────────────────────────┤
│                      Hardware Layer                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  RTX 5090 (32GB) or 2x RTX 4090 (48GB) or Mac Studio M4    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Model Strategy

#### Multi-Model Approach
```
Task Type               → Model Selection
─────────────────────────────────────────────
Simple code completion  → Qwen2.5-7B (fast, ~200 tok/s)
Standard coding tasks   → Qwen3-Coder-30B (~60 tok/s)
Complex reasoning       → GLM-4.7 or cloud fallback
Multi-file refactoring  → Qwen3-Coder with extended context
Code review             → Primary model with RAG context
```

#### Context Window Strategy
```
Short tasks (<8K tokens)    → Full local, fast model
Medium tasks (<32K tokens)  → Primary model, full VRAM
Large tasks (<128K tokens)  → Primary model + RAG retrieval
Huge tasks (>128K tokens)   → Chunked processing + summaries
```

### 2.3 RAG Integration for Codebase Awareness

```
┌─────────────────────────────────────────────────────┐
│              Codebase Indexing Pipeline              │
├─────────────────────────────────────────────────────┤
│  1. Watch file changes (inotify/fswatch)            │
│  2. Parse code with tree-sitter                      │
│  3. Extract functions, classes, imports              │
│  4. Generate embeddings (nomic-embed-text)           │
│  5. Store in LanceDB/ChromaDB                        │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Query-Time Retrieval                    │
├─────────────────────────────────────────────────────┤
│  1. User query → embedding                           │
│  2. Semantic search for relevant code                │
│  3. Re-rank with LLM (if needed)                    │
│  4. Inject top-K snippets into context              │
│  5. Generate response with context                   │
└─────────────────────────────────────────────────────┘
```

---

## Part 3: Implementation Phases

### Phase 1: Foundation (Week 1-2)
**Goal:** Basic local inference working with OpenCode

#### Tasks:
1. **Hardware Setup**
   - [ ] Acquire RTX 5090 or configure existing hardware
   - [ ] Install Ubuntu 24.04 or Windows 11 with WSL2
   - [ ] Install CUDA 12.x and cuDNN
   - [ ] Verify GPU recognized and working

2. **Inference Engine Setup**
   - [ ] Install Ollama for initial testing
   - [ ] Pull Qwen3-Coder:30b-a3b model
   - [ ] Pull Qwen2.5-coder:7b for fast tasks
   - [ ] Configure context window (32K minimum)
   - [ ] Benchmark performance (should see ~60 tok/s for 30B)

3. **OpenCode Installation**
   - [ ] Clone OpenCode repository
   - [ ] Configure for Ollama backend
   - [ ] Test basic file editing operations
   - [ ] Verify tool calling works with local model

#### Validation:
- [ ] Can edit files via natural language
- [ ] Tool use works (read/write files, run commands)
- [ ] Performance is acceptable (>30 tok/s)

### Phase 2: Production Inference (Week 3-4)
**Goal:** Optimize for production workloads

#### Tasks:
1. **Upgrade to vLLM/LMDeploy**
   - [ ] Install vLLM with CUDA support
   - [ ] Configure AWQ quantization for optimal speed
   - [ ] Set up OpenAI-compatible API endpoint
   - [ ] Benchmark against Ollama baseline

2. **Multi-Model Setup**
   - [ ] Configure fast model (7B) on separate GPU partition
   - [ ] Implement model routing based on task complexity
   - [ ] Set up request queuing for concurrent requests
   - [ ] Test model hot-swapping

3. **Context Window Optimization**
   - [ ] Configure 64K+ context for primary model
   - [ ] Implement context compression for long sessions
   - [ ] Test with real codebase files

#### Validation:
- [ ] Throughput improved vs Ollama
- [ ] Can handle concurrent requests
- [ ] Context window sufficient for file editing

### Phase 3: RAG & Codebase Awareness (Week 5-6)
**Goal:** Local model understands your codebase

#### Tasks:
1. **Embedding Pipeline**
   - [ ] Install nomic-embed-text via Ollama
   - [ ] Set up LanceDB for vector storage
   - [ ] Create file watcher for automatic indexing
   - [ ] Index TrafficControl codebase as test case

2. **Retrieval Integration**
   - [ ] Implement semantic search over codebase
   - [ ] Add retrieval step to OpenCode pipeline
   - [ ] Configure chunk sizes and overlap
   - [ ] Test retrieval quality

3. **Code-Aware Features**
   - [ ] Implement "find similar code" feature
   - [ ] Add "explain this codebase" capability
   - [ ] Create codebase Q&A mode

#### Validation:
- [ ] Can answer questions about codebase structure
- [ ] Retrieves relevant code for editing tasks
- [ ] Understands project conventions

### Phase 4: MCP Integration (Week 7-8)
**Goal:** Full tool ecosystem working locally

#### Tasks:
1. **MCP Server Setup**
   - [ ] Install MCP server framework
   - [ ] Configure filesystem MCP server
   - [ ] Configure git MCP server
   - [ ] Test with local LLM

2. **Custom Tools**
   - [ ] Port existing Claude Code tools to MCP format
   - [ ] Create database MCP server for Supabase
   - [ ] Add browser automation (Playwright MCP)
   - [ ] Test tool calling with Qwen3-Coder

3. **Tool Reliability**
   - [ ] Implement tool call validation
   - [ ] Add retry logic for failed calls
   - [ ] Create tool calling test suite

#### Validation:
- [ ] All standard tools work (file, git, shell)
- [ ] Custom tools accessible via MCP
- [ ] Tool calling reliable (>95% success rate)

### Phase 5: TrafficControl Integration (Week 9-10)
**Goal:** Local inference as capacity pool in scheduler

#### Tasks:
1. **Scheduler Integration**
   - [ ] Add "local" as provider type in CapacityTracker
   - [ ] Implement local model health checks
   - [ ] Configure task routing rules (local vs cloud)
   - [ ] Track local inference costs (electricity)

2. **Hybrid Routing**
   - [ ] Simple tasks → local fast model
   - [ ] Standard tasks → local primary model
   - [ ] Complex tasks → cloud Claude (when available)
   - [ ] Fallback logic when cloud unavailable

3. **Metrics & Monitoring**
   - [ ] Track tokens/second by model
   - [ ] Monitor GPU utilization
   - [ ] Log cost comparisons (local vs cloud)
   - [ ] Create dashboard for local inference stats

#### Validation:
- [ ] TrafficControl routes tasks to local models
- [ ] Automatic fallback works
- [ ] Cost tracking accurate

### Phase 6: Fine-Tuning (Optional, Week 11-12)
**Goal:** Model adapted to your coding style

#### Tasks:
1. **Data Preparation**
   - [ ] Export commit history with diffs
   - [ ] Create training pairs (prompt → code change)
   - [ ] Filter for high-quality examples
   - [ ] Format for fine-tuning

2. **LoRA Fine-Tuning**
   - [ ] Set up Unsloth or PEFT
   - [ ] Configure QLoRA for single GPU training
   - [ ] Train on codebase examples
   - [ ] Evaluate on held-out test set

3. **Deployment**
   - [ ] Merge LoRA weights or keep separate
   - [ ] A/B test fine-tuned vs base model
   - [ ] Document improvements

#### Validation:
- [ ] Fine-tuned model follows project conventions
- [ ] Quality improvement measurable
- [ ] No regression on general coding tasks

---

## Part 4: Configuration & Setup Guides

### 4.1 Ollama Setup (Getting Started)

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull recommended models
ollama pull qwen3-coder:30b-a3b
ollama pull qwen2.5-coder:7b
ollama pull nomic-embed-text

# Set context window (critical!)
export OLLAMA_CONTEXT_LENGTH=32768

# Start server with GPU
ollama serve

# Test
ollama run qwen3-coder:30b-a3b "Write a Python function to calculate fibonacci"
```

### 4.2 vLLM Setup (Production)

```bash
# Install vLLM
pip install vllm

# Start server with AWQ quantization
python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen3-Coder-30B-A3B-Instruct-AWQ \
    --quantization awq \
    --tensor-parallel-size 1 \
    --max-model-len 32768 \
    --port 8000

# Test with OpenAI client
curl http://localhost:8000/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{
        "model": "Qwen/Qwen3-Coder-30B-A3B-Instruct-AWQ",
        "messages": [{"role": "user", "content": "Hello!"}]
    }'
```

### 4.3 OpenCode Configuration

```yaml
# ~/.opencode/config.yaml
providers:
  local-qwen:
    type: ollama
    base_url: http://localhost:11434
    model: qwen3-coder:30b-a3b

  local-fast:
    type: ollama
    base_url: http://localhost:11434
    model: qwen2.5-coder:7b

default_provider: local-qwen

# Route simple tasks to fast model
routing:
  simple_completion: local-fast
  code_edit: local-qwen
  complex_reasoning: local-qwen
```

### 4.4 RAG Setup with LanceDB

```python
# indexer.py
import lancedb
from sentence_transformers import SentenceTransformer
import os
from pathlib import Path

# Initialize
db = lancedb.connect("./codebase.lance")
model = SentenceTransformer("nomic-ai/nomic-embed-text-v1.5")

def index_file(filepath: str):
    """Index a code file into the vector store."""
    with open(filepath) as f:
        content = f.read()

    # Chunk by functions/classes (simplified)
    chunks = content.split("\n\n")

    embeddings = model.encode(chunks)

    records = [
        {"text": chunk, "vector": emb.tolist(), "file": filepath}
        for chunk, emb in zip(chunks, embeddings)
    ]

    db.create_table("code", records, mode="overwrite")

def search(query: str, k: int = 5):
    """Search for relevant code snippets."""
    query_emb = model.encode([query])[0]
    table = db.open_table("code")
    results = table.search(query_emb).limit(k).to_list()
    return results
```

---

## Part 5: Cost Analysis

### 5.1 Hardware Investment

| Option | Initial Cost | Monthly Power | 3-Year TCO |
|--------|-------------|---------------|------------|
| RTX 5090 Build | $3,500 | $50 | $5,300 |
| Dual RTX 4090 Build | $6,000 | $80 | $8,880 |
| Mac Studio M4 Max | $4,500 | $30 | $5,580 |
| Dual RTX 5090 Build | $7,000 | $100 | $10,600 |

### 5.2 Break-Even Analysis

```
Current Claude Usage (estimated):
- Opus: $X/month
- Sonnet: $Y/month
- Total: $Z/month

Break-even for RTX 5090 Build:
- Hardware: $3,500
- Monthly savings: $Z - $50 (power)
- Break-even: 3500 / (Z - 50) months

If Z = $200/month → Break-even in 23 months
If Z = $500/month → Break-even in 8 months
If Z = $1000/month → Break-even in 4 months
```

### 5.3 Value Beyond Cost Savings

1. **Unlimited Usage** - No weekly caps, no rate limits
2. **Data Privacy** - Code never leaves your network
3. **Availability** - Works during internet/API outages
4. **Speed** - No network latency for simple tasks
5. **Customization** - Fine-tune on your codebase

---

## Part 6: Risk Mitigation

### 6.1 Quality Gap Risk

**Risk:** Local models may not match Claude quality for complex tasks.

**Mitigations:**
- Implement hybrid routing (local for simple, cloud for complex)
- Use multi-model approach with larger model fallback
- RAG integration to provide better context
- Fine-tuning on your specific codebase

### 6.2 Tool Calling Reliability

**Risk:** Open models have inconsistent function calling.

**Mitigations:**
- Use models with native tool support (Qwen3-Coder, GLM-4.7)
- Implement structured output parsing with grammar constraints
- Add retry logic with prompt refinement
- Validate tool calls before execution

### 6.3 Context Window Limitations

**Risk:** Local models have smaller context than Claude's 200K.

**Mitigations:**
- Use Qwen3-Coder's 256K context (extendable to 1M)
- Implement RAG for codebase retrieval
- Smart context compression for long sessions
- Chunked processing for huge files

### 6.4 Maintenance Burden

**Risk:** Self-hosted infrastructure requires maintenance.

**Mitigations:**
- Use containerized deployments (Docker)
- Implement health monitoring and auto-restart
- Keep cloud fallback for critical tasks
- Document all configurations

---

## Part 7: Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Task Completion Rate | >85% vs cloud | A/B testing on similar tasks |
| Code Quality Score | >90% of cloud | Automated linting + review |
| Inference Speed | >30 tok/s | Benchmark suite |
| Tool Call Success | >95% | Automated testing |
| Uptime | >99% | Monitoring |
| Monthly Cost | <$100 | Power monitoring |
| Offline Capability | 100% of simple tasks | Manual testing |

---

## Part 8: Next Steps & Parallel Work Streams

This project can be parallelized into the following independent work streams:

### Stream A: Hardware & Infrastructure
**Owner:** Infrastructure specialist
**Duration:** 1-2 weeks
**Tasks:**
- Procure and assemble hardware
- Install OS and drivers
- Set up monitoring
- Configure networking for local API access

### Stream B: Inference Engine Optimization
**Owner:** ML Engineer
**Duration:** 2-3 weeks
**Tasks:**
- Benchmark Ollama vs vLLM vs LMDeploy
- Optimize quantization settings
- Configure multi-model serving
- Performance tuning

### Stream C: OpenCode Customization
**Owner:** Backend Developer
**Duration:** 2-3 weeks
**Tasks:**
- Fork and customize OpenCode
- Add TrafficControl integration points
- Implement hybrid routing
- Create custom tools

### Stream D: RAG System
**Owner:** Search/ML Engineer
**Duration:** 2-3 weeks
**Tasks:**
- Build codebase indexing pipeline
- Implement semantic search
- Integrate with inference pipeline
- Test retrieval quality

### Stream E: TrafficControl Integration
**Owner:** TrafficControl maintainer
**Duration:** 2 weeks
**Tasks:**
- Add local provider to scheduler
- Implement task routing rules
- Create monitoring dashboard
- Update documentation

---

## Appendix A: Starter Prompts for Parallel Agents

### Agent A: Hardware Setup

```
You are setting up a local LLM inference server for an offline Claude Code alternative.

CONTEXT:
- Target hardware: RTX 5090 (32GB) or dual RTX 4090 (48GB combined)
- Primary model: Qwen3-Coder-30B-A3B (~18GB VRAM with Q4)
- Secondary model: Qwen2.5-Coder-7B (~4GB VRAM)
- OS: Ubuntu 24.04 LTS

TASKS:
1. Verify GPU is recognized (nvidia-smi)
2. Install CUDA 12.4 and cuDNN 9
3. Install Ollama and configure for GPU
4. Pull qwen3-coder:30b-a3b and qwen2.5-coder:7b models
5. Set OLLAMA_CONTEXT_LENGTH=32768
6. Benchmark performance and report tokens/second
7. Document any issues encountered

SUCCESS CRITERIA:
- Both models loaded and responding
- Primary model: >50 tok/s
- Fast model: >150 tok/s
- GPU utilization visible in nvidia-smi during inference
```

### Agent B: OpenCode Local Configuration

```
You are configuring OpenCode to work with local LLM backends via Ollama.

CONTEXT:
- OpenCode is an open-source Claude Code alternative
- It supports multiple backends including Ollama
- Local server running at http://localhost:11434
- Models available: qwen3-coder:30b-a3b, qwen2.5-coder:7b

TASKS:
1. Clone OpenCode repository
2. Configure Ollama as the default provider
3. Test basic operations: file read, file write, code edit
4. Verify tool calling works (run shell commands, git operations)
5. Configure model routing (fast model for simple tasks)
6. Document any prompt adjustments needed for local models
7. Create test suite for tool calling reliability

SUCCESS CRITERIA:
- Can edit files via natural language commands
- Tool calling success rate >90%
- Git operations work correctly
- Response time acceptable for interactive use
```

### Agent C: RAG Codebase Indexer

```
You are building a RAG system to give local LLMs awareness of the TrafficControl codebase.

CONTEXT:
- Codebase location: traffic-control/
- Using LanceDB for vector storage
- Using nomic-embed-text for embeddings (via Ollama)
- Goal: Retrieve relevant code snippets for any query

TASKS:
1. Install dependencies: lancedb, sentence-transformers
2. Create file indexer that parses TypeScript files
3. Use tree-sitter to extract functions, classes, imports
4. Generate embeddings for each code chunk
5. Store in LanceDB with metadata (file path, line numbers)
6. Implement semantic search function
7. Create test queries and verify retrieval quality
8. Add file watcher for automatic re-indexing

SUCCESS CRITERIA:
- All .ts files in traffic-control/ indexed
- Search returns relevant code for test queries
- Re-indexing works on file changes
- Query latency <500ms
```

### Agent D: MCP Server Integration

```
You are integrating MCP (Model Context Protocol) servers with the local LLM setup.

CONTEXT:
- MCP is an open protocol for LLM tool integration
- Local LLM (Qwen3-Coder) supports function calling
- Need filesystem, git, and shell MCP servers

TASKS:
1. Install MCP server framework
2. Configure filesystem MCP server
3. Configure git MCP server
4. Test tool calling with local LLM via mcp-cli
5. Verify tools work: read file, write file, git status, shell commands
6. Document any tool calling format differences
7. Create reliability test suite

SUCCESS CRITERIA:
- All standard MCP tools work with local model
- Tool calling format compatible with Qwen3-Coder
- Success rate >95% on test suite
- Documentation complete
```

---

## Appendix B: Research Sources

### Local LLM Tools
- [Aider](https://aider.chat/) - AI pair programming
- [OpenCode](https://github.com/sst/opencode) - Open-source Claude Code alternative
- [Continue.dev](https://continue.dev/) - IDE integration
- [Open Interpreter](https://github.com/openinterpreter/open-interpreter) - Local system automation

### Models
- [Qwen3-Coder](https://github.com/QwenLM/Qwen3-Coder) - Apache 2.0 coding model
- [GLM-4.7](https://huggingface.co/THUDM/glm-4-9b) - MIT licensed agentic model
- [DeepSeek V3](https://github.com/deepseek-ai/DeepSeek-V3) - MoE architecture

### Inference Engines
- [vLLM](https://github.com/vllm-project/vllm) - High-throughput serving
- [SGLang](https://github.com/sgl-project/sglang) - Structured output optimization
- [Ollama](https://ollama.com/) - Easy local deployment
- [llama.cpp](https://github.com/ggerganov/llama.cpp) - CPU/Edge inference

### Hardware Benchmarks
- [RTX 5090 LLM Benchmarks](https://www.runpod.io/blog/rtx-5090-llm-benchmarks)
- [Best GPUs for Local LLMs 2026](https://localllm.in/blog/best-gpus-llm-inference-2025)
- [Apple Silicon LLM Performance](https://apxml.com/posts/best-local-llm-apple-silicon-mac)

### Integration
- [Model Context Protocol](https://github.com/modelcontextprotocol)
- [LangChain MCP Adapters](https://docs.langchain.com/oss/python/langchain/mcp)

---

*Document created: 2026-01-26*
*Last updated: 2026-01-26*
*Status: Ready for Phase 1 Implementation*
