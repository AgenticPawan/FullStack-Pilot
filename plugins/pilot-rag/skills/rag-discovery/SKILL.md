---
name: rag-discovery
description: Phase 0 of the pilot-rag scaffold. Scans the target application repo (the current project, read-only) and produces pilot-rag/INGESTION_MANIFEST.md — a classified inventory of ingestible sources with per-type file counts, token estimates, chunking-strategy assignments, include/exclude rationale, secret-redaction rules applied at ingestion time, and a "Known blind spots" section. Use when running /fsp-rag-init Phase 0, or when the user asks to build the ingestion manifest / discover what a RAG index would cover.
when_to_use: rag discovery, ingestion manifest, INGESTION_MANIFEST, scan repo for RAG, classify ingestible sources, source types code-csharp code-typescript docs api-spec config, redact secrets at ingestion, known blind spots, what can RAG answer, phase 0 rag
---

## Purpose

Phase 0 of the pilot-rag build. Produce `pilot-rag/INGESTION_MANIFEST.md` — the
authoritative inventory that every later phase (chunking, ingestion, eval)
reads. **Read-only against the target app.** This skill never modifies a single
file in the user's application code; it only writes inside `pilot-rag/`.

> Path convention: the scaffold root is `pilot-rag/` inside the user's project
> (`PROJECT_ROOT`, the current working directory). The target repo being indexed
> is `PROJECT_ROOT` itself unless the user passed an explicit `--repo` path.
> Never write outside `pilot-rag/`.

## Inputs (infer and record — never silently assume)

- `TARGET_REPO_PATH` — the repo to index. Defaults to `PROJECT_ROOT`.
- `OUTPUT_PATH` — the scaffold root. Defaults to `./pilot-rag`.

If a value is inferred rather than provided, record the inferred value in the
manifest's header. Never silently assume.

## Step 1 — Inventory ingestible sources, classified by type

Scan `TARGET_REPO_PATH` and classify every ingestible file into exactly one
source type. Never recurse into `node_modules/`, `bin/`, `obj/`, `dist/`,
`.angular/`, or `.git/`.

| Source type | Globs | Excludes |
|---|---|---|
| `code-csharp` | `**/*.cs` | `bin/`, `obj/`, generated files (`*.g.cs`, `*.Designer.cs`, `*.generated.cs`) |
| `code-typescript` | `**/*.ts`, `**/*.html` (Angular templates) | `node_modules/`, `dist/`, `.angular/`, `*.spec.ts` |
| `docs` | `**/*.md` | — |
| `api-spec` | any `swagger.json` / OpenAPI files, `.http` files | — |
| `config` | `appsettings*.json`, `angular.json`, Bicep/ARM/Terraform files | — |

## Step 2 — Redaction rule (config source type)

For every `config` file, **redact the value of any key matching**
`(?i)(secret|password|key|token|connectionstring)` **at ingestion time** —
store `"[REDACTED]"` as the value. This rule is a non-negotiable constraint:
secret-shaped configuration values must never reach the vector store or the
manifest. The redaction is applied again at chunk time by `ConfigChunker`
(see `rag-chunking`); the manifest records that the rule is in force and which
files it touched.

## Step 3 — Per-type manifest entry

For each source type present, record:

- **File count** — number of files matched.
- **Approximate token estimate** — rough total (e.g. chars / 4).
- **Chosen chunking strategy** — the `IChunker` assigned in Phase 3
  (`rag-chunking`): `code-csharp` → `CSharpChunker`, `code-typescript` →
  `TypeScriptChunker`, `docs` → `MarkdownChunker`, `api-spec` → `OpenApiChunker`,
  `config` → `ConfigChunker`.
- **Include/exclude decision** with a one-line rationale.

## Step 4 — Known blind spots

List everything pilot-rag **cannot** answer from these sources, in a explicit
"Known blind spots" section. At minimum: runtime data, production logs, live
Azure state — anything not present as a static file in the indexed repo. This
section is copied verbatim into the generated `README.md` in Phase 6.

## Manifest skeleton

```markdown
# INGESTION_MANIFEST

- Target repo: <TARGET_REPO_PATH> (inferred: yes/no)
- Output path: <OUTPUT_PATH> (inferred: yes/no)
- Generated: <UTC timestamp>

## Sources

### code-csharp
- Files: <n>  |  ~tokens: <n>  |  Chunker: CSharpChunker
- Decision: include — <one-line rationale>

### code-typescript
...

### config
- Files: <n>  |  ~tokens: <n>  |  Chunker: ConfigChunker
- Decision: include — redaction rule applied to keys matching
  (?i)(secret|password|key|token|connectionstring)
- Redacted files: <list>

## Known blind spots
- Runtime data / production logs / live Azure state — not indexed (no static source).
- <anything else the sources cannot answer>
```

## Gate (must pass before Phase 1)

- `pilot-rag/INGESTION_MANIFEST.md` exists.
- Every glob in Step 1 resolves to **≥ 1 file, or is explicitly marked absent**
  in the manifest.
- The redaction rule is recorded as in force for `config` sources.

If the gate cannot pass, **stop and report why** — do not proceed to Phase 1.

## Read budget

Manifest-first, ≤ 40 files: prefer directory listings and glob counts over
opening files. Open a source file only to sample it for token estimation or to
confirm a generated-file exclusion. Never read `node_modules/`, `bin/`, `obj/`,
`dist/`, `.angular/`, or `.git/`. Budgets bound exploration, not quality — if
the manifest genuinely needs more sampling to be accurate, say what and why and
continue; never silently emit a degraded manifest.
