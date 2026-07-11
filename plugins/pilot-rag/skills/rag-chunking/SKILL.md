---
name: rag-chunking
description: Phase 3 of the pilot-rag scaffold. Implements the RagPilot.Ingestion pipeline — the five IChunker strategies (CSharpChunker via Roslyn, TypeScriptChunker via regex/brace, MarkdownChunker, OpenApiChunker, ConfigChunker with redaction), the Qdrant ragpilot_chunks schema, deterministic-UUID idempotency (skip unchanged, delete removed), and embedding/upsert batching. Use for /fsp-rag-init Phase 3.
when_to_use: rag chunking, IChunker, CSharpChunker Roslyn, TypeScriptChunker, MarkdownChunker, OpenApiChunker, ConfigChunker redaction, chunk context header, Qdrant collection ragpilot_chunks, contentHash SHA-256, deterministic UUID point id, idempotent ingestion, skip unchanged delete removed, batch embeddings upserts, phase 3 rag, ingestion pipeline
---

## Purpose

Phase 3 of the pilot-rag build: the ingestion pipeline in `RagPilot.Ingestion`,
run as `dotnet run -- --repo <TARGET_REPO_PATH>`. Scan → chunk → embed → upsert,
idempotently. All embedding calls go through the `IEmbeddingGenerator` resolved
by the Phase 2 provider factory — **no vendor type appears here.**

## Chunkers — one `IChunker` per manifest source type

Every chunk carries a **context header** prefix (file path, and the
type-specific breadcrumb described below) so retrieval and the model see where
each fragment came from.

### `CSharpChunker` (source type `code-csharp`)

- Split at **type and method boundaries** using `Microsoft.CodeAnalysis`
  (Roslyn).
- Context header per chunk: **file path, namespace, containing type, XML-doc
  summary if present.**
- Max **~600 tokens**. Oversized methods split at **statement boundaries** with
  the header **repeated** on each split.

### `TypeScriptChunker` (source type `code-typescript`)

- **Regex/brace-based** splitting at **class, function, and Angular decorator
  boundaries** — **no TS compiler dependency**, keep it simple.
- Same context-header convention (file path + containing symbol).

### `MarkdownChunker` (source type `docs`)

- Split at **heading boundaries**, target **300–500 tokens**, **50-token
  overlap**.
- Context header: **heading breadcrumb** (the chain of ancestor headings).

### `OpenApiChunker` (source type `api-spec`)

- **One chunk per path+verb**, with **schema refs resolved inline**.
- **One chunk per named schema.**

### `ConfigChunker` (source type `config`)

- **One chunk per file**, **post-redaction** (the
  `(?i)(secret|password|key|token|connectionstring)` rule from `rag-discovery`
  is applied again here — values become `"[REDACTED]"`).
- **Flattened key paths** (e.g. `Logging:LogLevel:Default`).

## Storage — Qdrant collection `ragpilot_chunks`

- **Dense vector** from the `IEmbeddingGenerator`.
- **Payload:** `sourceType`, `filePath`, `symbol` (nullable),
  `contentHash` (SHA-256 of the chunk text), `chunkText`, `ingestedAtUtc`.

## Idempotency (non-negotiable)

- **Point ID = deterministic UUID** derived from `filePath + chunkIndex`.
- **Skip upsert** when `contentHash` is unchanged.
- **Delete** points whose source file no longer exists.
- Re-running ingestion on an **unchanged repo must be a near-no-op.**

## Batching

- Batch **embeddings ≥ 16 per call**.
- Batch **upserts ≥ 64 per call**.
- Log a summary: **files scanned / chunks written / skipped / deleted, elapsed
  time.**

## Gate (must pass before Phase 4)

- Full ingestion of the target repo **completes**.
- A **second run reports 0 written** (idempotency proven).
- **Unit tests cover each chunker** with fixture files — **including the
  redaction rule** (a `ConfigChunker` fixture with a secret-shaped key must
  emit `"[REDACTED]"`).

If the gate cannot pass, **stop and report why** — do not proceed to Phase 4.

## Read budget

≤ 12 files: the `IChunker` interface, the five chunker implementations, the
Qdrant client wrapper, and the ingestion entry point. Read the
`INGESTION_MANIFEST.md` for source-type assignments instead of re-scanning the
target repo. Fixtures are small by construction. Budgets bound exploration, not
quality — if a chunker genuinely needs more context to be correct, say what and
why and continue rather than guessing.
