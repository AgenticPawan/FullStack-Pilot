---
name: rag-retrieval
description: Phase 4 of the pilot-rag scaffold. Builds the RagPilot.Api /ask SSE endpoint and RagPilot.Core retrieval loop — embed question, Qdrant topK search with heuristic sourceType filtering, a 0.35 cosine score floor with a fixed not-found answer (model forbidden off-corpus), a 6000-token prompt budget, streamed tokens, a trailing sources event, plus /health and /index/stats. Use for /fsp-rag-init Phase 4.
when_to_use: rag retrieval, /ask endpoint, SSE stream, embed question, Qdrant search topK, sourceType filter heuristics, score floor 0.35 cosine, not found in indexed sources, system prompt forbid own knowledge, context budget 6000 tokens truncate lowest scored, GetStreamingResponseAsync, sources event filePath symbol score, /health /index/stats, CORS Angular dev origin, phase 4 rag
---

## Purpose

Phase 4 of the pilot-rag build: the `/ask` endpoint and the retrieval loop.
Prompt assembly and retrieval logic live in `RagPilot.Core` (no vendor refs);
the endpoint lives in `RagPilot.Api`. All chat calls go through the
`IChatClient` from the Phase 2 factory.

## `POST /ask` — `{ "question": string, "topK"?: int }` → SSE stream

Execute these steps in order:

### 1. Embed the question

Via the `IEmbeddingGenerator` from the provider factory.

### 2. Qdrant search

- `topK` **default 8**.
- Optional **`sourceType` payload filter** inferred from the question by
  **cheap heuristics** — e.g. mentions of "endpoint"/"API" boost `api-spec`;
  "component"/"template" boost `code-typescript`. Keep the heuristics in **one
  testable class** (a single injectable classifier, unit-tested in isolation).

### 3. Score floor 0.35 (cosine)

- Drop every hit below **0.35 cosine similarity**.
- If **nothing survives**, stream a **fixed "not found in the indexed sources"
  answer**. **Never let the model answer from its own knowledge** — the system
  prompt must forbid it.

### 4. Prompt assembly (in `RagPilot.Core`)

- **System prompt:** answer **only from the provided context**; **cite
  sources**; say **"I don't know"** otherwise.
- **Numbered context blocks** + the question.
- **Hard context budget: 6,000 tokens.** When over budget, **truncate the
  lowest-scored chunks first.**

### 5. Stream + sources event

- Stream tokens via `IChatClient.GetStreamingResponseAsync`.
- After the **final token**, emit **one SSE event `sources`** with
  `[{ filePath, symbol, score }]` — for the chunks **actually included** in the
  prompt (post-truncation), not every hit.

## Also required

- `GET /health` — Qdrant **and** provider reachability.
- `GET /index/stats` — point count, last ingestion time.
- **CORS for the Angular dev origin only** (not a wildcard).

## Gate (must pass before Phase 5)

- `curl -N` against `/ask` **streams an answer followed by a `sources` event.**
- An **off-corpus question** ("what is the capital of France") returns the
  **not-found response** — proving the score floor + system-prompt guard work
  together.

If the gate cannot pass, **stop and report why** — do not proceed to Phase 5.

## Non-negotiables carried through

- **Question-answering only.** No tool calling, no agents, no write actions in
  the RAG loop. If tempted to add a feature not specified here, don't.
- The retrieval/prompt code stays vendor-free — only the composition root names
  a provider (see `rag-provider-abstraction`).

## Read budget

≤ 12 files: the `/ask`/`/health`/`/index/stats` endpoint mapping, the
retrieval service, the prompt-assembly class, the sourceType heuristic
classifier, the Qdrant client wrapper, and CORS setup. Do not re-read the
chunkers — reference `rag-chunking` for the payload shape. Budgets bound
exploration, not quality — if correct wiring needs more, say what and why and
continue rather than guessing.
