---
name: rag-provider-abstraction
description: Phase 2 of the pilot-rag scaffold. Builds the RagPilot.sln skeleton (Core/Ingestion/Api/Tests) and the provider-abstraction layer — a single static factory mapping appsettings to Microsoft.Extensions.AI IChatClient + IEmbeddingGenerator, with an architecture test asserting RagPilot.Core references no vendor SDK. Enforces the core rule: swapping Ollama<->Azure OpenAI is appsettings-only, zero code changes. Use for /fsp-rag-init Phase 2.
when_to_use: rag provider abstraction, Microsoft.Extensions.AI, IChatClient, IEmbeddingGenerator, provider factory, appsettings Ai Provider Ollama AzureOpenAI, architecture test no vendor refs, RagPilot.Core RagPilot.Api RagPilot.Ingestion, DefaultAzureCredential, swap provider zero code change, phase 2 rag, solution skeleton
---

## Purpose

Phase 2 of the pilot-rag build: the solution skeleton plus the
**provider-abstraction layer** — the single most important constraint in the
whole system. Everything else exists to serve this: **switching providers must
require only an `appsettings.json` change, zero code changes.**

> Prerequisite (Phase 1 infrastructure) must be green first: Qdrant healthy via
> `pilot-rag/docker-compose.yml`, both Ollama models pulled by
> `pilot-rag/scripts/setup-ollama.(sh|ps1)`. Do not start Phase 2 with Phase 1
> red. The `/fsp-rag-init` command runs Phase 1 inline before invoking this skill.

## Non-negotiable constraints (carried unchanged)

1. **Provider abstraction is the core requirement.** All LLM and embedding
   calls go through `Microsoft.Extensions.AI` abstractions — `IChatClient` and
   `IEmbeddingGenerator<string, Embedding<float>>`. **No code outside the
   provider registration layer may reference Ollama, Azure OpenAI, or any vendor
   SDK type.**
2. **.NET-only orchestration.** No Python, no LangChain, no Semantic Kernel.
   The RAG loop is simple; own it.
3. **Everything runs locally** via Docker Compose + Ollama. Azure OpenAI is a
   *configuration target*, not a runtime dependency.
4. **Read-only against the target app.** pilot-rag lives entirely in its own
   `pilot-rag/` folder; it never modifies the user's application code.

## Step 1 — Solution skeleton

Create `pilot-rag/RagPilot.sln` with four projects. Target: **.NET 8 (LTS)
minimal API, C# 12, nullable enabled, warnings as errors.**

```
RagPilot.Core/          # chunking, retrieval, prompt assembly — NO vendor refs
RagPilot.Ingestion/     # console app: scan -> chunk -> embed -> upsert
RagPilot.Api/           # minimal API: /ask (SSE), /health, /index/stats
RagPilot.Tests/         # xUnit
```

`RagPilot.Core` is the boundary the architecture test defends. It may reference
`Microsoft.Extensions.AI` (the abstractions package) but **never** a concrete
provider package (`OllamaSharp`, `Azure.AI.OpenAI`, etc.).

## Step 2 — Provider configuration

Provider registration lives **only** in the composition roots of
`RagPilot.Api` and `RagPilot.Ingestion` — nowhere else.

```json
"Ai": {
  "Provider": "Ollama",              // "Ollama" | "AzureOpenAI"
  "Ollama":      { "Endpoint": "http://localhost:11434", "ChatModel": "qwen2.5:7b-instruct", "EmbeddingModel": "nomic-embed-text" },
  "AzureOpenAI": { "Endpoint": "", "ChatDeployment": "", "EmbeddingDeployment": "" }
}
```

## Step 3 — Provider factory

One **static factory class** maps config → `IChatClient` +
`IEmbeddingGenerator<string, Embedding<float>>`:

- `Provider = "Ollama"` → construct the Ollama-backed `IChatClient` /
  `IEmbeddingGenerator` from the `Ollama` config block.
- `Provider = "AzureOpenAI"` → use `Azure.AI.OpenAI` +
  `DefaultAzureCredential` (**no keys in config** — credential-based auth only).

The factory is the *only* file in the entire solution allowed to name a vendor
type. It returns the `Microsoft.Extensions.AI` interfaces; every consumer
(`RagPilot.Core`, endpoints, ingestion) depends solely on those interfaces.

## Step 4 — Architecture test (the proof)

Add an architecture test in `RagPilot.Tests` (NetArchTest or reflection-based)
asserting that **`RagPilot.Core` references no vendor packages** — no
`Ollama*`, no `Azure.AI.OpenAI`, no other provider SDK type appears in any type
`RagPilot.Core` depends on. This test is what makes "swap by appsettings only"
verifiable rather than aspirational; it is re-asserted in Phase 6's
provider-swap proof.

## Gate (must pass before Phase 3)

- Solution builds with **zero warnings** (warnings-as-errors is on).
- Architecture test is **green** — `RagPilot.Core` has no vendor references.

If the gate cannot pass, **stop and report why** — do not proceed to Phase 3.

## Read budget

≤ 12 files: the four `.csproj` files, both composition roots (`Program.cs` /
ingestion entry point), the factory, and the architecture test. Read the
`INGESTION_MANIFEST.md` header for the confirmed paths; do not re-scan the
target repo here. Budgets bound exploration, not quality — if a correct
provider wiring needs more context, say what and why and continue rather than
guessing.
