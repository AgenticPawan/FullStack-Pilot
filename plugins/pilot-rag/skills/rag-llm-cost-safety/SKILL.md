---
name: rag-llm-cost-safety
description: Cost/safety guardrails for the pilot-rag generation path — bounds /ask and ingestion token spend and runaway output. Covers per-request token/cost ceilings (output cap + context budget), embedding-cost control on ingestion, output validation and bounded provider-failure handling, and token/cost observability. Complements rag-security; matters most once the Ollama->Azure OpenAI swap points it at a metered provider.
when_to_use: LLM cost, token budget, max output tokens, context window limit, cost ceiling, per request token cap, embedding cost ingestion, batch embeddings, re-embed unchanged, runaway generation, unbounded retry loop, provider timeout, token usage logging, cost observability, Azure OpenAI metered, Ollama local free, output validation, response length cap, SSE stream cost, cost gate RAG
---

## Purpose

`rag-security` hardens the RAG surface against *attackers*; this skill hardens it against
*spend* — the failure mode where a metered provider quietly runs up a bill or a runaway
generation hangs the stream. It matters specifically because pilot-rag's headline feature is
swapping Ollama (local, effectively free) for **Azure OpenAI (metered per token)** by
`appsettings` alone: the day someone flips that switch, every missing ceiling becomes a cost.
Apply while building phases 3 (ingestion) and 4 (`/ask`), and run the list as a review.

---

## Domain 1 — Per-request token/cost ceilings

- **Cap output tokens.** Every `IChatClient` call sets `ChatOptions.MaxOutputTokens`. Without
  it, one adversarial or degenerate prompt can generate until the provider's own max — the most
  common surprise line item.
- **Enforce the context budget.** The 6,000-token context budget from `rag-retrieval` is a cost
  control as much as a quality one — confirm it is actually applied (truncate lowest-scored
  chunks first) and not silently bypassed when many chunks clear the score floor.
- **Clamp `topK`.** A large `topK` means more chunks embedded into the prompt and more input
  tokens billed. Clamp it (shared with `rag-security`'s abuse cap) — reject oversized values
  rather than honoring them.
- **Reject, don't trim-and-hope, past a hard ceiling.** If a request would exceed the input
  budget even after truncation, return a clear error instead of sending an oversized prompt.

## Domain 2 — Ingestion embedding cost

Embedding the whole corpus is the other metered path, and it runs in bulk.

- **Never re-embed unchanged chunks.** Ingestion is idempotent for content (`rag-chunking`);
  confirm a re-run **skips** unchanged chunks (hash/version check) rather than re-embedding the
  entire repo every time — re-embedding unchanged content is pure waste on a metered provider.
- **Batch embeddings.** Send embeddings in bounded batches, not one HTTP call per chunk (latency
  and per-call overhead) nor one unbounded call for everything.
- **Estimate before a full index.** Log an up-front token/chunk estimate for a full re-index so a
  large run against Azure OpenAI is a visible, intentional choice — not a surprise.

## Domain 3 — Output validation and bounded failure

- **Validate the output.** Enforce the response-length cap and confirm the not-found path returns
  the fixed answer (`rag-retrieval`) rather than a long, unbounded generation.
- **Bound provider failure.** Every provider call has a **timeout** and a **limited** retry
  count — never an unbounded retry loop. A hanging or erroring provider must fail the SSE request
  promptly, not spin (racking up cost and holding the connection open).

## Domain 4 — Cost observability

- **Log token usage per request.** Record input + output token counts per `/ask` (from the
  provider response usage) so cost is attributable, not a monthly mystery.
- **Log ingestion cost.** Record embedding token counts per ingestion run (surface alongside
  `/index/stats` point counts).
- **Document the swap's cost delta.** The `README` provider-swap section (`rag-eval`) states
  plainly that Ollama is local/free and Azure OpenAI is metered, so switching is a known cost
  decision, not a silent one.

---

## Gate (must pass before shipping)

1. **Ceilings wired:** `ChatOptions.MaxOutputTokens` is set; the 6,000-token context budget is
   enforced; an oversized `topK`/question is rejected or clamped, not sent.
2. **Ingestion is incremental + batched:** a second ingestion run re-embeds **zero** unchanged
   chunks; embeddings go out in bounded batches.
3. **Failure is bounded:** provider calls have a timeout and a finite retry count — no unbounded
   loop; per-request token usage is logged.

If any gate fails, **stop and report why** — do not ship an endpoint that can spend without a
ceiling once pointed at a metered provider.

## Read budget

≤ 8 files: the `IChatClient` call site and its `ChatOptions`, the prompt-assembly/context-budget
code, the ingestion embedding loop (batching + skip-unchanged), and the provider factory
(timeout/retry policy). Reference `rag-retrieval` for the score floor/context budget and
`rag-chunking` for idempotent ingestion rather than re-deriving them. Budgets bound exploration,
not quality: if confirming the skip-unchanged path needs the ingestion hash logic, read it and
say why.
