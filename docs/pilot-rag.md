# pilot-rag

A local, self-hosted **RAG (retrieval-augmented generation) scaffold** for full-stack
Microsoft codebases. Run `/fsp-rag-init` inside your own project and pilot-rag builds a
provider-agnostic question-answering system into `./pilot-rag/` — so your Claude Code
sessions (and your team) can ask natural-language questions about *your* Angular / .NET /
SQL / Azure code and get answers cited to real files.

Unlike the other pilot plugins, pilot-rag is not an ongoing reviewer — it has **one job**:
scaffold the RAG system, once, on request. It ships a single `rag-implementor` agent and
five phase skills, no reviewer/support trio.

## What it builds

Running `/fsp-rag-init` produces, entirely under `pilot-rag/` in your project:

| Artifact | What it is |
|---|---|
| `INGESTION_MANIFEST.md` | Classified inventory of ingestible sources + redaction rules + known blind spots |
| `docker-compose.yml` | Qdrant vector DB (ports 6333/6334, healthcheck on `/readyz`) |
| `scripts/setup-ollama.(sh\|ps1)` | Pulls the `qwen2.5:7b-instruct` chat + `nomic-embed-text` embedding models |
| `RagPilot.sln` | Four .NET 8 projects: `RagPilot.Core` (no vendor refs), `.Ingestion`, `.Api`, `.Tests` |
| Five `IChunker`s | Roslyn (C#), regex (TypeScript), Markdown, OpenAPI, config-with-redaction |
| `/ask` (SSE), `/health`, `/index/stats` | Streaming retrieval endpoint + operational endpoints |
| `pilot-rag/ui` | Standalone Angular 18+ Signals chat component |
| `eval/questions.json` + eval runner | 20 manifest-derived questions gating retrieval hit-rate ≥ 80% |
| `README.md` | Quickstart, Mermaid architecture diagram, provider-swap diff, blind spots |

### The 7-phase pipeline

`/fsp-rag-init` runs the build gated — **no phase starts while the previous phase's gate
is red.** Five phases are governed by skills; infrastructure (Phase 1) and the Angular UI
(Phase 5) are inline steps in the command.

| Phase | Skill | Gate |
|---|---|---|
| 0 Discovery | `rag-discovery` | manifest exists; every glob resolves or is marked absent; redaction in force |
| 1 Infrastructure | *(inline)* | Qdrant healthy; setup script exits 0 with both models present |
| 2 Provider abstraction | `rag-provider-abstraction` | zero-warning build; architecture test green |
| 3 Chunking & ingestion | `rag-chunking` | ingestion completes; second run writes 0; per-chunker tests incl. redaction |
| 4 Retrieval | `rag-retrieval` | `/ask` streams answer + `sources`; off-corpus → not-found |
| 5 Angular UI | *(inline)* | `ng build` clean; 3-question smoke passes |
| 6 Eval & swap proof | `rag-eval` | hit-rate ≥ 80%; provider-swap test green |

**Cross-cutting:** [`rag-security`](../plugins/pilot-rag/skills/rag-security/SKILL.md) hardens
the live surface the phases above build — prompt injection via indexed content, `/ask` authZ +
rate limiting + input caps, secret redaction *before* embedding and a Qdrant purge path, and
answer/error leakage. Applied during phases 3–5 and run as a security gate before shipping.
[`rag-llm-cost-safety`](../plugins/pilot-rag/skills/rag-llm-cost-safety/SKILL.md) is its cost twin —
per-request token/output ceilings, incremental+batched embedding on ingestion, bounded
provider-failure handling, and per-request token logging. It matters most the moment the
Ollama↔Azure OpenAI swap points the system at a metered provider.

## The provider-swap guarantee

pilot-rag's core design constraint: **switching the LLM/embedding provider is an
`appsettings.json` change only — zero code changes.**

- Every LLM and embedding call goes through `Microsoft.Extensions.AI` abstractions
  (`IChatClient`, `IEmbeddingGenerator<string, Embedding<float>>`).
- A single static factory in the `RagPilot.Api` / `RagPilot.Ingestion` composition roots
  is the **only** place a vendor SDK type is named. Local runs use Ollama; Azure OpenAI
  uses `Azure.AI.OpenAI` + `DefaultAzureCredential` (no keys in config).
- A **Phase 2 architecture test** asserts `RagPilot.Core` references no vendor package,
  and a **Phase 6 test** builds the Azure provider from sample config and asserts a
  non-null `IChatClient` without a network call.

Swap providers by editing one block:

```jsonc
"Ai": {
  "Provider": "AzureOpenAI",         // was "Ollama"
  "AzureOpenAI": { "Endpoint": "https://…", "ChatDeployment": "…", "EmbeddingDeployment": "…" }
}
```

## Constraints (never waived)

- **.NET-only orchestration** — no Python, no LangChain, no Semantic Kernel.
- **Everything runs locally** via Docker Compose + Ollama; Azure OpenAI is a configuration
  target, not a runtime dependency.
- **Read-only against your app** — pilot-rag reads your code to index it but writes only
  under `pilot-rag/`; it never modifies, moves, or deletes your application files.
- **Secrets are redacted at ingestion** — any config key matching
  `(?i)(secret|password|key|token|connectionstring)` is stored as `"[REDACTED]"` before it
  can reach the manifest or the vector store.
- **Question-answering only** — the scaffolded system has no agents, no tool calling, no
  write actions. It answers questions; that is all.

## Known blind spots

pilot-rag indexes **static source files only**. It cannot answer questions about:

- **Runtime data** — actual rows in your database, request/response payloads, user state.
- **Production logs and telemetry** — what happened at runtime, errors in the field.
- **Live Azure state** — deployed resource config, secrets in Key Vault, running metrics.
- **Anything not committed as a file** in the indexed repo.

Retrieval quality is judged by **retrieval hit-rate only** (does the correct file appear
in the cited sources?) — there is no LLM-as-judge scoring answer prose. A low score floor
hit or an off-corpus question returns a fixed *"not found in the indexed sources"* answer;
the model is forbidden by its system prompt from answering out of its own knowledge.

## Quickstart

From a Claude Code session in **your** project's root:

```shell
/plugin install pilot-rag@fullstack-pilot
/fsp-rag-init
```

Then, once the scaffold completes and its gates are green, from `pilot-rag/`:

```shell
docker compose up -d                 # Qdrant
./scripts/setup-ollama.sh            # pull models (or .ps1 on Windows)
dotnet run --project RagPilot.Ingestion -- --repo ..   # index your repo
dotnet run --project RagPilot.Api    # serve /ask
cd ui && ng serve                    # chat UI
```

Ask a code question, a docs question, and an off-corpus question to confirm all three
behaviors (answer + sources, answer + sources, not-found).
