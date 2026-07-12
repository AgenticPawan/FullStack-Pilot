---
description: Scaffold a local, provider-agnostic RAG system into ./pilot-rag/ that answers questions about your own Angular/.NET/SQL/Azure codebase.
---

# /fsp-rag-init — Scaffold a Local Self-Hosted RAG System

Scaffold **pilot-rag** into the **current working repository** (the user's project, not this plugin repo): a local, provider-agnostic RAG system that answers developer questions about the project's own Angular/.NET/SQL/Azure codebase. Everything lands under `pilot-rag/` inside the project. The target application code is **read-only** — pilot-rag never modifies it.

## What this command does

Runs the original 7-phase build, gated: **do not start phase N+1 with phase N red.** Each phase ends with its verification gate; if a gate cannot pass, stop and report why.

| Phase | Skill / step | Output | Gate |
|---|---|---|---|
| 0 Discovery | `rag-discovery` | `pilot-rag/INGESTION_MANIFEST.md` | manifest exists; every glob resolves or is marked absent; redaction rule in force |
| 1 Infrastructure | inline (below) | `docker-compose.yml`, `scripts/setup-ollama.(sh\|ps1)` | Qdrant healthy; setup script exits 0 with both models present |
| 2 Provider abstraction | `rag-provider-abstraction` | `RagPilot.sln` (Core/Ingestion/Api/Tests) | zero-warning build; architecture test green |
| 3 Chunking & ingestion | `rag-chunking` | `RagPilot.Ingestion` + chunkers | ingestion completes; second run writes 0; per-chunker tests incl. redaction |
| 4 Retrieval | `rag-retrieval` | `/ask` (SSE), `/health`, `/index/stats` | streams answer + `sources`; off-corpus → not-found |
| 5 Angular UI | inline (below) | `pilot-rag/ui` | `ng build` clean; 3-question smoke passes |
| 6 Eval & swap proof | `rag-eval` | `eval/questions.json`, README | hit-rate ≥ 80%; provider-swap test green |

## Non-negotiable constraints (never waive)

1. **Provider abstraction is the core requirement.** All LLM/embedding calls go through `Microsoft.Extensions.AI` (`IChatClient`, `IEmbeddingGenerator<string, Embedding<float>>`). No code outside the provider registration layer references Ollama, Azure OpenAI, or any vendor SDK. Switching providers is an `appsettings.json` change only — zero code changes.
2. **.NET-only orchestration.** No Python, no LangChain, no Semantic Kernel.
3. **Everything runs locally** via Docker Compose + Ollama. Azure OpenAI is a configuration target, not a runtime dependency.
4. **Read-only against the target app.** pilot-rag lives entirely in `pilot-rag/`; it never touches the user's application code.
5. **No scope additions.** Question-answering only — no agents, no tool calling, no write actions in the RAG system. If tempted to add a feature not specified here, don't.
6. **Each phase ends with its gate passing.** Do not start phase N+1 with phase N red.

## Target stack (build with these; flag if the environment differs)

- .NET 8 (LTS) minimal API, C# 12, nullable enabled, warnings as errors
- Angular 18+ standalone components + Signals for the chat UI
- Qdrant (latest stable) in Docker for vectors
- Ollama models: `qwen2.5:7b-instruct` (chat), `nomic-embed-text` (embeddings)
- xUnit for tests

## Execution

Treat the **current working directory as `PROJECT_ROOT`**, per the `/fsp-init` convention — `PROJECT_ROOT` **is** the target repo when this command runs. The scaffold root is `PROJECT_ROOT/pilot-rag/`. Do not write anywhere else.

Delegate the phase build to the **`rag-implementor`** agent (or run the phases directly), invoking each skill in order and stopping at any red gate.

### Phase 0 — Discovery

Run the `rag-discovery` skill against `PROJECT_ROOT`. It writes `pilot-rag/INGESTION_MANIFEST.md`. **Gate:** manifest exists; every source-type glob resolves to ≥1 file or is marked absent; the `(?i)(secret|password|key|token|connectionstring)` redaction rule is recorded as in force for `config` sources. Do not proceed while red.

### Phase 1 — Infrastructure (inline)

Create `pilot-rag/docker-compose.yml`:

- `qdrant` service: image `qdrant/qdrant`, ports 6333/6334, named volume, healthcheck on `/readyz`.
- **Do not containerize Ollama by default** (GPU passthrough friction). Instead write `pilot-rag/scripts/setup-ollama.sh` and `setup-ollama.ps1` that verify the Ollama CLI, pull **both** models (`qwen2.5:7b-instruct`, `nomic-embed-text`), and **fail loudly with install instructions** if missing. Include a **commented-out** `ollama` compose service for teams that want it containerized.

**Gate:** `docker compose up -d` → Qdrant healthy; the setup script exits 0 with both models present. Do not proceed while red.

### Phase 2 — Provider abstraction

Run the `rag-provider-abstraction` skill. It creates `pilot-rag/RagPilot.sln` (Core/Ingestion/Api/Tests), the static provider factory (Ollama | AzureOpenAI via `DefaultAzureCredential`, no keys), and the architecture test asserting `RagPilot.Core` has no vendor references. **Gate:** zero-warning build; architecture test green. Do not proceed while red.

### Phase 3 — Chunking & ingestion

Run the `rag-chunking` skill. It implements the five `IChunker`s (`CSharpChunker`/Roslyn, `TypeScriptChunker`/regex, `MarkdownChunker`, `OpenApiChunker`, `ConfigChunker`/redaction), the Qdrant `ragpilot_chunks` collection, deterministic-UUID idempotency, and embedding/upsert batching. **Gate:** ingestion completes; a second run reports 0 written; unit tests cover each chunker including the redaction rule. Do not proceed while red.

### Phase 4 — Retrieval

Run the `rag-retrieval` skill. It builds `POST /ask` (SSE), the 0.35 cosine score floor + fixed not-found answer, prompt assembly under the 6,000-token budget, the trailing `sources` event, plus `/health`, `/index/stats`, and CORS for the Angular dev origin only. **Gate:** `curl -N /ask` streams an answer then a `sources` event; an off-corpus question returns the not-found response. Do not proceed while red.

### Phase 5 — Angular UI (inline)

Create a standalone Angular app in `pilot-rag/ui` (**do not touch the target app**):

- Single chat component: **Signals** for state; message list; streaming render via `fetch` + `ReadableStream` (**not `EventSource`** — a POST body is needed).
- Render the `sources` event as **collapsible file-path chips** under each answer.
- States: **idle / streaming / error / not-found.** No component libraries; plain CSS. This is a developer tool, not a product.

**Gate:** `ng build` clean; manual smoke — ask one code question, one docs question, one off-corpus question; all three behave per Phase 4 rules. Do not proceed while red.

### Phase 6 — Evaluation & provider-swap proof

Run the `rag-eval` skill. It generates `pilot-rag/eval/questions.json` (20 questions from the manifest, each with `expectedFilePath`), the xUnit `Eval`-category hit-rate runner, and the network-free provider-swap test, and writes `README.md` (quickstart ≤5 commands, Mermaid architecture diagram, provider-swap appsettings diff, Known blind spots copied from the manifest). **Gate:** eval ≥ 80% retrieval hit-rate (tune chunking/topK/filters if below — **never lower the bar**); provider-swap test green.

### Final gate — Security & scaffold review

`rag-security` is applied while building phases 3–5; now run it as a review across the whole
scaffold. Invoke **`@rag-reviewer`** on `pilot-rag/` — it checks the generated code against every
pilot-rag skill (security, provider abstraction, chunking, retrieval, eval, cost safety) and emits
findings with `RAG-*` IDs. **Gate:** the reviewer's three `rag-security` hard gates all pass
(injection probe returns a cited on-corpus/not-found answer; `/ask` authenticated off loopback,
rate-limited, and clamps oversized `topK`/question; a seeded secret appears nowhere in the Qdrant
payload or an answer, and the purge path works). Route any CRITICAL/HIGH finding back to
`@rag-implementor` and re-review — do not ship the scaffold with a failing security gate.

## Reporting

After each phase, print: **phase name, gate result, files created/modified, and any deviation from this pipeline with justification.** Deviations without justification are defects. After Phase 6, print the deliverables recap: `docker-compose.yml`, setup scripts, `RagPilot.sln` (4 projects), Angular UI, `INGESTION_MANIFEST.md`, `eval/questions.json`, `README.md`.
