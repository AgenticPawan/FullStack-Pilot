---
name: rag-eval
description: Phase 6 of the pilot-rag scaffold. Builds the eval harness and provider-swap proof — eval/questions.json (20 questions from the actual manifest, each with an expectedFilePath), an xUnit Eval-category runner asserting retrieval hit-rate >= 80% (tune, never lower the bar), and a network-free test asserting the Azure OpenAI provider resolves a non-null IChatClient. Use for /fsp-rag-init Phase 6.
when_to_use: rag eval, evaluation harness, eval/questions.json, expectedFilePath, retrieval hit-rate 80 percent, xUnit Eval category, retrieval hit rate gate, provider swap proof, appsettings diff Azure OpenAI, IChatClient non-null no network, tune chunking topK do not lower bar, phase 6 rag, no LLM-as-judge
---

## Purpose

Phase 6 of the pilot-rag build: prove the system actually retrieves the right
sources, and prove the provider swap is real. Retrieval quality is judged by
**retrieval hit-rate only — no LLM-as-judge here.**

## Step 1 — `pilot-rag/eval/questions.json`

Generate **20 questions from the actual `INGESTION_MANIFEST.md` content**,
spread **across source types**. Each entry has an **`expectedFilePath`** — the
file a correct answer must cite.

```json
[
  { "question": "How does the OrdersController authorize requests?",
    "expectedFilePath": "src/Api/Controllers/OrdersController.cs" }
]
```

Questions must be answerable from indexed sources — generate them *from* the
manifest so `expectedFilePath` always points at a file that was actually
ingested.

## Step 2 — Eval runner (xUnit, category `Eval`)

In `RagPilot.Tests`, a runner tagged with the `Eval` category:

- For each question: run retrieval and **assert the `expectedFilePath` appears
  in the retrieved sources** (the `sources` set from `rag-retrieval`).
- **Retrieval hit-rate target ≥ 80%.**
- **Report per-question results to console** (pass/fail per question).
- **Answer quality is judged by retrieval hit-rate only** — no LLM-as-judge.

## Step 3 — Provider-swap proof

1. Document in the generated `README.md` the **exact appsettings diff** to
   switch from Ollama to Azure OpenAI (change `Ai.Provider` and fill the
   `AzureOpenAI` block — no code edits).
2. Add a test that **builds the Azure OpenAI provider from sample config** and
   **asserts the resolved `IChatClient` is non-null — without making a network
   call.** This, together with the `rag-provider-abstraction` architecture
   test (no vendor refs in `RagPilot.Core`), is the complete proof that
   swapping providers is an appsettings-only change.

## Gate (final)

- **Eval ≥ 80% retrieval hit-rate.** If below, **tune chunking / topK /
  filters and re-run — do NOT lower the bar.**
- **Provider-swap test green.**

If the gate cannot pass after tuning, **stop and report why** — do not lower
the threshold to make it pass.

## Deliverables recap (verify all present)

`docker-compose.yml`, setup scripts, `RagPilot.sln` (4 projects), Angular UI,
`INGESTION_MANIFEST.md`, `eval/questions.json`, `README.md` with: quickstart
(≤ 5 commands), architecture diagram (Mermaid), provider-swap instructions,
and the **Known blind spots** section copied from the manifest.

## Read budget

≤ 10 files: the eval runner, the provider-swap test, `questions.json`, the
manifest (to source the questions), and the retrieval service under test.
Budgets bound exploration, not quality — if reaching the hit-rate bar
legitimately needs deeper analysis of why a question misses, do that and report
it; never fabricate questions to inflate the rate.
