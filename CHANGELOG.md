# Changelog

All notable changes to FullStack Pilot are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2026-07-12 — audit-plugin remediation (dangling-ref fix + CI backstop + four seam skills)

pilot-core 0.25.0 → 0.26.0, pilot-angular 0.22.2 → 0.23.0, pilot-azure 0.16.0 → 0.17.0,
pilot-sql 0.14.3 → 0.15.0. Closes every Vulnerability, Wiring, Standards, and Skill-gap
finding from the pre-submission `/audit-plugin` pass.

### Fixed
- **Dangling `/fix-critical` command references (W1, W2).** `commands/fsp-audit.md` and
  `skills/audit-orchestration/SKILL.md` told users to run `/fix-critical`, a command that
  never existed (the real one is `/fsp-fix`). Both now point at `/fsp-fix --batch P0`.

### Added
- **CI command-reference integrity check (`scripts/validate.mjs`).** New section scans every
  shipped command/skill/agent markdown for slash-command *invocations* and fails the build on
  any `/fsp-*` reference that doesn't resolve to a real command file, plus any legacy `/fix-*`.
  Path segments (`.../pilot/fix-<tier>`) and `/fsp-<verb>` placeholders are excluded by
  construction (invocation must be preceded by whitespace/backtick and followed by an alpha).
  This is the backstop for the dangling-reference class above, which no prior check caught.
- **`angular-realtime` (pilot-angular) — SignalR client, the missing half of `dotnet-realtime`.**
  Typed connection service (ART-001), automatic reconnect + group re-join (ART-002),
  `accessTokenFactory` reading the live token (ART-003), typed hub method contract (ART-004),
  and teardown on destroy (ART-005). The server hub was governed; the browser half wasn't.
- **`azure-keyvault-appconfig` (pilot-azure) — the store the .NET config/secrets skills consume.**
  Key Vault references over inline secrets (KVA-001), managed-identity over keys (KVA-002),
  soft-delete/purge-protection (KVA-003), the App Configuration feature-flag store (KVA-004),
  and locked-down public network access (KVA-005). Complements ASB-IM-2 with the Bicep wiring.
- **`sql-hadr-failover` (pilot-sql) — database-tier HA the app/backup skills don't cover.**
  HA topology vs SLA (HA-001), listener/failover-group connection strings (HA-002),
  read-secondary routing (HA-003), RPO/RTO-driven commit mode (HA-004), and tested failover
  (HA-005). Covers Always On AGs and Azure SQL failover groups.
- **`auth-token-contract` (pilot-core) — the OIDC seam between `angular-authentication` and
  `dotnet-authentication`.** Audience/issuer/scope agreement (ATC-001), claim-name drift
  (ATC-002), token-lifetime vs renew alignment (ATC-003), client-gate-without-server-gate
  (ATC-004), and a single documented contract (ATC-005). Enforces permissions-only on both ends.

### Notes
- **pilot-core breadth (S1) — reviewed, kept intentionally.** The pre-submission audit flagged
  pilot-core bundling the pipeline engine with standalone cross-cutting review skills. These are
  genuinely cross-stack (they belong in no single stack plugin) and pilot-core is the shared base
  every plugin already depends on; splitting it would permanently fragment that dependency graph
  over a Low, defensible finding. Decision recorded in
  [docs/SPLIT-ELIGIBILITY-AUDIT-2026-07.md](docs/SPLIT-ELIGIBILITY-AUDIT-2026-07.md).

## 2026-07-12 — critical-review-2026-07-12 remediation (security floor + wiring + CI backstops)

pilot-core 0.24.0 → 0.25.0, pilot-rag 0.3.0 → 0.4.0, pilot-azure 0.15.2 → 0.16.0,
pilot-angular 0.22.1 → 0.22.2, pilot-dotnet 0.26.1 → 0.26.2, pilot-sql 0.14.2 → 0.14.3.
Closes every finding in [docs/critical-review-2026-07-12.md](docs/critical-review-2026-07-12.md)
— all Fixed or Verified.

### Security (pilot-core hooks — the enforcement floor)
- **secret-guard now detects the secrets an Azure shop actually leaks (V2).** Added seven
  high-signal, placeholder-aware patterns: Azure Storage `AccountKey`, Service Bus/Event Hub
  `SharedAccessKey`, SAS `sig`, AWS `AKIA…`, GitHub `ghp_/ghs_/gho_`, Google `AIza…`, and Stripe
  `sk_live_`. The flagship pre-commit barrier previously missed Azure storage keys and Service Bus
  connection strings entirely.
- **MultiEdit no longer bypasses the floor (V3).** Both PreToolUse hooks match `Write|Edit|MultiEdit`
  and extract the `edits[]` array, so a secret or dangerous pattern introduced via MultiEdit is seen.
- **ReDoS guard on user-extensible config (V6).** `dangerous-patterns.js` sniffs each config regex
  before compiling and skips an over-long (>300 char) or nested-unbounded-quantifier pattern
  (`(a+)+` and friends) with a stderr breadcrumb, so a bad pattern can never hang a write.

### Fixed
- **Formatter silently no-op'd on Windows, the target OS (V1).** `formatter.js` now invokes
  `npx.cmd` on win32, so Prettier actually runs instead of `ENOENT`-failing with zero signal.
- **Silent fail-open is now observable (V5).** Each hook's top-level catch emits a one-line stderr
  breadcrumb, so "the guard did not run" is visible rather than indistinguishable from "clean".
- **SQL-injection rule caught up to the EF-Core era (V4).** Added an interpolated-SQL `warn`
  (`FromSqlInterpolated`/`ExecuteSqlInterpolated`-aware, so the safe parameterizing APIs aren't
  false-flagged) and tightened the concat `deny` so constant-only concatenation no longer trips it
  while variable injection still does.

### Added
- **`rag-reviewer` (pilot-rag) — the missing reviewer over real attack surface (W2).** pilot-rag
  was the only plugin generating production code (a live `/ask` SSE endpoint + Qdrant store) yet
  shipped an implementor with no reviewer. Added a read-only `rag-reviewer` (`disallowedTools:
  Write, Edit`) with a `RAG-*` standard-ID catalog spanning all six pilot-rag skills and the three
  `rag-security` hard gates, wired into `/fsp-rag-init` as a final review gate.

### Changed
- **Azure trio shares one prefix (W3).** Renamed `azure-support` → `infra-support` to match
  `infra-reviewer`/`infra-implementor`, updating every reference across the support agents' routing,
  `fullstack-support`, manifests, `README`, and docs. Removes the routing special-case.
- **Live-diagnostic capability sets honest expectations (W4).** The `infra-support` description and
  the pilot-azure `plugin.json` now state that live Azure MCP diagnostics are opt-in via
  `.mcp.json.example` (only `microsoft-learn` auto-loads), matching the agent body's "when
  available" hedge.

### CI (scripts/validate.mjs)
- **Marketplace description budget (S1).** The 600-char cap that governed `plugin.json` now also
  covers `marketplace.json` per-plugin descriptions (they load on the catalog browse surface). Six
  descriptions trimmed under the cap (pilot-core/-dotnet ran 2x+ over); standard documented in CLAUDE.md.
- **CLAUDE.md "MUST" rules gained CI backstops (S3).** The validator now enforces: hook matchers are
  never `"*"`, hook scripts don't recurse `node_modules/bin/obj`, and every stack plugin declares the
  `pilot-core` dependency.
- **`disallowedTools` parsing normalized (S4).** `parseFrontmatter` understands scalar, inline-flow
  (`[Write, Edit]`), and block-sequence list forms, so the read-only guarantee evaluates correctly
  regardless of authoring style.
- **Verified, no change needed:** the `fullstack-*` orchestrator trio registers correctly (W1 — the
  review's registry snapshot was stale); `effort` and `maxTurns` are documented, honored plugin-
  subagent frontmatter fields, so the reviewers run at intended depth (S2).

## 2026-07-12 — backlog skills: zero-downtime-deployment + llm-cost-safety

pilot-core 0.23.0 → 0.24.0, pilot-rag 0.2.0 → 0.3.0. Completes the skill backlog from
[docs/CRITICAL-REVIEW-2026-07.md](docs/CRITICAL-REVIEW-2026-07.md) §4.

### Added
- **`zero-downtime-deployment`** (pilot-core) — the seam between `sql-migration-safety` and
  `azure-cicd-security`: is a schema change safe while N-1 and N app versions run against one
  database during a rolling/blue-green deploy? Checks destructive-change-with-its-code vs.
  expand/contract (ZDD-001), parallel-change discipline (ZDD-002), N-1 backward compatibility
  (ZDD-003, P0), non-locking migrations (ZDD-004), and migration/rollout ordering gated in CI
  (ZDD-005). Listed in `docs/pilot-core.md`.
- **`llm-cost-safety`** (pilot-rag) — the cost twin of `rag-security` for the generation path:
  per-request token/output ceilings and context-budget enforcement, incremental + batched
  embedding on ingestion (never re-embed unchanged chunks), output validation with bounded
  provider-failure handling (timeout + finite retries), and per-request token/cost logging.
  Matters most once the Ollama↔Azure OpenAI swap points the system at a metered provider.
  Listed in `docs/pilot-rag.md`.

## 2026-07-12 — pilot-core: distributed-tracing-correlation skill

pilot-core 0.22.0 → 0.23.0.

### Added
- **`distributed-tracing-correlation`** — a cross-cutting seam skill (like
  `api-design-standards`) over `angular-telemetry`, `dotnet-observability`, and
  `azure-observability`, which each instrument one layer in isolation. Checks that one user
  action yields **one correlated trace** Angular → .NET → SQL → Azure: W3C `traceparent`
  propagated from the SPA (DTC-001), no bespoke correlation-ID header standing in for it
  (DTC-002), trace context carried across async boundaries — messaging, background jobs —
  (DTC-003, P0), SQL/downstream calls emitted as child spans of the request (DTC-004), and the
  trace id surfaced to the user and enriched into logs (DTC-005). Listed in `docs/pilot-core.md`.

## 2026-07-12 — critical-review remediation (security + wiring hardening)

pilot-core 0.21.0 → 0.22.0, pilot-angular 0.22.0 → 0.22.1, pilot-dotnet 0.26.0 → 0.26.1,
pilot-sql 0.14.1 → 0.14.2, pilot-azure 0.15.1 → 0.15.2, pilot-rag 0.1.0 → 0.2.0. Full findings
in [docs/CRITICAL-REVIEW-2026-07.md](docs/CRITICAL-REVIEW-2026-07.md); tracked fixes in
[docs/REMEDIATION-PLAN-2026-07.md](docs/REMEDIATION-PLAN-2026-07.md).

### Security
- **`.mcp.json` no longer auto-registers third-party servers.** The bundled, auto-loaded
  `plugins/pilot-core/.mcp.json` now contains **only `microsoft-learn`** (first-party HTTP, no
  credentials). `playwright`, `github`, `azure-mcp`, and `sql-mcp` moved to a new
  `plugins/pilot-core/.mcp.json.example`, **version-pinned** (`@playwright/mcp@0.0.78`,
  `@azure/mcp@3.0.0-beta.25`, `ghcr.io/github/github-mcp-server:v1.5.0`) and added to a project
  only through `mcp-discovery`'s per-server consent gate — resolving the contradiction with the
  plugin's own supply-chain and consent policies (no more `@latest`).
- **`rag-security` skill added** to pilot-rag — governs the live `/ask` endpoint and Qdrant
  store: prompt injection via indexed content, `/ask` authZ + rate limiting + `topK`/question
  caps, secret redaction *before* embedding + a Qdrant purge path, and answer/error leakage.

### Fixed
- **Hook severity mis-calibration.** `dangerous-patterns.json` entries now carry an `action`:
  `deny` hard-blocks (security-grade); `warn` surfaces a non-blocking `systemMessage` via
  `permissionDecision: defer` and lets the write proceed. `DateTime.Now` (a testability
  preference) is downgraded from a hard block to `warn`, so developers stop disabling the whole
  hook and losing the P0 security patterns with it.
- **innerHTML remediation no longer recommends the XSS escape hatch.** The
  `UNSAFE_INNERHTML_ASSIGNMENT` message now points at safe `[innerHTML]` binding/interpolation
  instead of `DomSanitizer.bypassSecurityTrustHtml()` (which the `angular-no-bypass-without-comment`
  rule flags).

### Changed
- **Security hooks are guaranteed present.** The security hooks live only in pilot-core, so
  every stack plugin (`pilot-angular`, `pilot-dotnet`, `pilot-sql`, `pilot-azure`, `pilot-rag`)
  now declares `"dependencies": [{ "name": "pilot-core" }]` — Claude Code installs pilot-core
  alongside them, closing the gap where installing a stack plugin alone left its guards inert.
- `scripts/validate.mjs` now validates every `.mcp.json` (valid JSON + `mcpServers` object) and
  **warns on floating references** (`@latest`, untagged / `:latest` docker image) in the
  auto-loaded file; `.mcp.json.example` is JSON-validated but exempt from the pin check.

`node scripts/validate.mjs` exits 0 (24/24 hook tests).

## 2026-07-12 — pilot-rag: self-hosted RAG scaffold plugin

New plugin `pilot-rag` 0.1.0. Added to `marketplace.json`, `CODEOWNERS`, `README.md`
(install list, Plugins table, Documentation section), and `docs/pilot-rag.md`.

### Added
- `pilot-rag` — `/fsp-rag-init` scaffolds a local, provider-agnostic RAG system into
  `./pilot-rag/` **inside the user's own project** so Claude Code can answer questions
  about their Angular/.NET/SQL/Azure codebase, cited to real files. The target
  application is **read-only**; orchestration is **.NET-only** (no Python/LangChain) and
  the system does question-answering only.
- The original 7-phase build is decomposed into five discrete, gated skills (no phase
  N+1 with phase N red) plus two inline command steps:
  - `rag-discovery` (Phase 0) — ingestion manifest + secret redaction.
  - `rag-provider-abstraction` (Phase 2) — `Microsoft.Extensions.AI` factory with a
    no-vendor-refs architecture test (swap Ollama↔Azure OpenAI by `appsettings` only).
  - `rag-chunking` (Phase 3) — five `IChunker`s with idempotent Qdrant ingestion.
  - `rag-retrieval` (Phase 4) — `/ask` SSE endpoint, 0.35 score floor, source citation.
  - `rag-eval` (Phase 6) — ≥80% hit-rate gate + provider-swap proof.
  - Phase 1 (infra) and Phase 5 (Angular Signals chat UI) are inline in `fsp-rag-init`.
- Single `rag-implementor` scaffold agent (no reviewer/support trio).
- `SUBMISSION.json` — marketplace submission manifest pinned to this plugin's commit.

`node scripts/validate.mjs` exits 0 (all checks pass, 23/23 hook tests).

## 2026-07-12 — plugin split-eligibility audit (docs only)

No version bumps — documentation only.

### Added
- [docs/SPLIT-ELIGIBILITY-AUDIT-2026-07.md](docs/SPLIT-ELIGIBILITY-AUDIT-2026-07.md) —
  a submission-readiness review deciding, per plugin, whether it should be split before
  proposing FullStack Pilot to `anthropics/claude-plugins-official`. Verdict: **keep all
  five as-is**. Each is judged on domain coherence and cross-dependency (shared trio,
  shared base skills, cross-references), not skill count — so pilot-dotnet (57 skills) and
  pilot-angular (31) stay whole because every skill governs one artifact under one agent
  trio, and pilot-core stays whole because it is the runtime/glue the other plugins install
  against. Linked from the README Documentation section.

## 2026-07-12 — full governance wiring audit + UI/UX skill + foundation gate

pilot-core 0.20.0 → 0.21.0, pilot-angular 0.21.0 → 0.22.0, pilot-dotnet 0.25.0 → 0.26.0,
pilot-sql 0.14.0 → 0.14.1, pilot-azure 0.15.0 → 0.15.1. Full findings in
[docs/GOVERNANCE-AUDIT-2026-07.md](docs/GOVERNANCE-AUDIT-2026-07.md).

### Fixed
- 5 rule IDs cited by angular-reviewer/angular-implementor/angular-security had no matching
  `rules-catalog/` file, so `pilot-scaffold` could never materialize them into a project's
  `.claude/rules/` despite being cited as "always enforced." Added all 5, plus wired the
  previously-orphaned `angular-lt17-ngmodule` and 3 dotnet-specific rules into their
  reviewers/implementors, and added 2 new deterministic rules
  (`sql-no-destructive-migration`, `azure-public-network-access`).
- Fixed 3 dangling references to a `/pilot-upgrade` command that never existed — pointed at
  what actually exists instead: the `angular-upgrade-path` skill and the external
  `dotnet-upgrade@dotnet-agent-skills` plugin.
- Wired `sql-mcp` explicitly into `sql-support`/`sql-implementor`, `microsoft-learn` into
  `dotnet-support`/`dotnet-implementor` (previously unreferenced anywhere in pilot-dotnet),
  more `azure-mcp` tool namespaces into the pilot-azure trio, Playwright into
  `angular-implementor`, and the previously-orphaned `github` MCP server into
  `git-workflow-governance`.

### Added
- `dotnet-security-headers` skill (SECH-*): HSTS, X-Content-Type-Options, clickjacking
  protection, anti-forgery/CSRF on cookie auth, safe JSON deserialization, and
  mass-assignment/over-posting via entity-bound requests.
- `angular-ui-ux-consistency` skill (UXC-*): spacing/typography scale discipline,
  mobile-first responsive layout, visual hierarchy between actions, cross-feature component
  visual consistency, and a design-to-code fidelity check — wired into the existing
  angular-reviewer/angular-implementor/angular-support trio rather than a new agent.
- `/fsp-bootstrap` command + `foundation-bootstrap` skill: detects which baseline modules
  (authentication, authorization, logging, error handling, health checks, CORS as Required;
  rate limiting, startup validation, security headers, observability, CI/CD skeleton, DB
  migration baseline as Recommended) a project already has, scaffolds the missing Required
  ones via the stack implementors, and writes `.claude/pilot/foundation/STATUS.md`.
- `fsp-build-orchestration` Step 0 now reads that status file: a detected-greenfield project
  with no foundation modules yet stops for explicit sign-off before feature work — never
  silently waived by `--yes`, same discipline as its other hard gates. Existing/brownfield
  projects only get a recommendation, never a block.

## 2026-07-11 — pilot-core: cross-stack fullstack-reviewer/fullstack-implementor agents

pilot-core 0.19.0 → 0.20.0

### Added
- `fullstack-reviewer` (sonnet, read-only) — classifies a full-stack diff by layer
  (Angular/.NET/SQL-EF Core/Azure), delegates each file group to the owning specialist
  reviewer with only that layer's files, and separately checks contract drift across the
  seam (backend contract vs. generated Angular client, migration shape vs. DTO shape) that
  no single specialist can see alone.
- `fullstack-implementor` (model inherited per invocation) — the fixing counterpart:
  sequences a cross-stack fix in dependency order (SQL schema → .NET → Angular → infra),
  delegates each layer to its owning implementor, and handles only genuinely cross-layer
  glue directly (regenerating a generated API client, aligning a Bicep output with its
  consumer) — every stack-specific fix and hard gate still belongs to the owning
  specialist.
- Together with the existing `fullstack-support`, `pilot-core` now ships the full-stack
  counterpart to every stack plugin's own reviewer/implementor/support trio.

## 2026-07-11 — autonomous-team Phase 4: workflow docs + QA-check hardening

### Fixed
- `/fsp-build` QA write-scope enforcement: a scratch-repo verification run proved
  `git diff --name-only` cannot see files the QA step newly *creates* (untracked
  files never appear in a diff), so an out-of-scope new product file would have
  slipped through. Detection now uses `git status --porcelain` — tracked violations
  are reverted via `git checkout <qaBaseSha> -- <path>`, untracked ones are deleted —
  and Steps 5–7 now commit their work per item/fix/QA-run so each step's diff is
  isolated and `--resume` gets clean boundaries.

### Added
- Autonomous-team workflow documentation: README section (delivery-team roles, the
  two commands, safety gates), docs/pilot-core.md pipeline reference with the
  step-by-step /fsp-build walkthrough, TROUBLESHOOTING entries (opus fallback header,
  stale briefs/--refresh, --resume, --yes vs hard gates, QA reverted paths), and a
  CLAUDE.md "Pipeline artifact layout" section fixing the `.claude/pilot/` paths every
  command and agent relies on.
- Plan §10 verification executed: inline Assess dry-run against
  tests/fixtures/mixed-fullstack produced 5 evidence-cited gaps (≥3 required); the
  live /fsp-build fixture dry-run and token spot-checks are recorded as pending a
  session with the plugin installed.

## 2026-07-11 — autonomous-team Phase 3: /fsp-architect and /fsp-build commands

pilot-core 0.18.0 → 0.19.0

### Added
- `/fsp-architect [--scope <area>] [--refresh]` — whole-solution architecture
  assessment: scout briefs (haiku, reused unless `--refresh`) feed fsp-architect's
  Assess mode (opus); chat gets the gap-register table and 3-line verdict, disk gets
  the full `ASSESSMENT.md` with per-gap ready-to-run `/fsp-build` lines and ADR stubs.
- `/fsp-build <feature | spec-file | GAP-id> [--yes] [--max-files <n>] [--resume]` —
  the one-shot pipeline: specify (fsp-analyst) → scout → plan (fsp-architect) → user
  gate → implement (stack implementors; opus only for `complexity: high` items) →
  diff-scoped review (max 2 fix loops, then escalate with both positions) → QA →
  summary. Work lands on `pilot/build-<feature>`, never merged automatically.
- `fsp-build-orchestration` skill (`user-invocable: false`) — the detailed Step 0–8
  pipeline logic: STATE.json checkpoint after every step (`--resume` never re-pays a
  completed step), hard safety gates that `--yes` cannot waive, per-item verification
  commands, `--max-files` enforcement, and the §11.1 deterministic QA write-scope
  check — `git diff --name-only` after the QA step, non-test paths reverted and
  routed back as defects.

## 2026-07-11 — autonomous-team Phase 2: BA, Solution Architect, and QA agents

pilot-core 0.17.0 → 0.18.0

### Added
- `fsp-analyst` (sonnet) — Business Analyst: turns a raw feature ask into a bounded,
  testable spec at `.claude/pilot/specs/<feature>.md` (numbered user stories,
  Given/When/Then acceptance criteria, edge cases, permission implications, out of
  scope, open questions). One batched clarification round, then commit.
- `fsp-architect` (opus, `memory: project`) — Solution Architect with two modes:
  Assess (whole-solution gap register ranked risk×value against the target state the
  pilot skills encode, with per-gap enhancement plans and ADR stubs, written to
  `.claude/pilot/architecture/ASSESSMENT.md`) and Plan (spec → dependency-ordered,
  complexity-tagged work items at `.claude/pilot/builds/<feature>/PLAN.md`; only
  justified `complexity: high` items get opus implementor turns). Prints its resolved
  model in every output header; consumes scout briefs, max 10 source files.
- `fsp-qa` (sonnet) — QA engineer: traces every AC-id to a test, writes/extends tests
  per dotnet-testing/angular-testing conventions, runs them, and writes a traceability
  report to `.claude/pilot/builds/<feature>/QA-REPORT.md`. Test-path-only write
  contract; product defects route back to the owning implementor.
- `fullstack-support`: not-a-defect routing — feature asks → fsp-analyst,
  architecture concerns → fsp-architect.

### Changed (plan amendment)
- §11.1 QA write-scope enforcement: agent-frontmatter hooks are ignored for plugin
  subagents (documented platform restriction), so enforcement moves to the /fsp-build
  pipeline — a deterministic `git diff --name-only` check after the QA step rejects
  any non-test change. Stronger than the hook it replaces.

## 2026-07-11 — Phase 1 quality-first amendments

### Changed
- Reviewers reverted `effort: medium` → `high` — review depth is the product; token
  savings come from scope rules (diff-only, scout briefs, quoting caps), not
  shallower reasoning.
- Skill description warn threshold raised 500 → 800 chars combined: descriptions are
  the skill-routing signal, and compressing all of them to 500 would trade invocation
  quality for marginal savings. The 32 skills over 800 were trimmed — description
  prose only; `when_to_use` keyword lists untouched. Warnings: 116 → 0.
- Every agent gains a quality-guard rule: budgets bound exploration, not quality —
  on budget exhaustion, report what's missing instead of returning a degraded result.
- `stack-detection`, `audit-orchestration`, `batched-remediation`,
  `convention-learner` now carry `user-invocable: false` (command-internal; hidden
  from the /-menu, Skill-tool invocation by /fsp-* commands unaffected).
- Plan §11 open questions decided: fsp-qa write scope will be hook-enforced
  (agent-level PreToolUse), review-loop cap stays 2, fsp-architect will print its
  resolved model, scout write exception confirmed.

## 2026-07-11 — autonomous-team Phase 1: model matrix + token discipline

pilot-core 0.16.0 → 0.17.0 (see docs/AUTONOMOUS-TEAM-PLAN.md for the full roadmap)

### Added
- `fsp-scout` agent (pilot-core, `model: haiku`, `memory: project`) — read-budgeted
  (80 files) context scout that writes compressed briefs to `.claude/pilot/context/`
  for expensive agents to consume instead of re-exploring source.
- Model matrix (CLAUDE.md, CI-enforced): T1 read = haiku (`fsp-scout`), T2
  analyze/review = sonnet (reviewers at `effort: medium`, support), T3 plan/complex
  implement = opus (future `fsp-architect`; implementors via per-invocation override).
- STRICT token discipline: every agent declares a "Read budget"; scout-brief-first
  reading; 10-line source-quoting cap; file-based handoffs under `.claude/pilot/`.
- validate.mjs: plugin description ≤600 chars (fail), SKILL.md description+when_to_use
  ≤1024 combined (fail; the old check measured description alone) with a ≤500 target
  (warn), model-tier policy per agent name, and required Read-budget declarations.

### Changed
- All five plugin.json descriptions rewritten ≤600 chars (pilot-dotnet's was ~2,000) —
  these load into every session, so this is a permanent per-session token saving.
- Reviewers: `effort: high` → `medium`. Implementors: hardcoded `model: sonnet`
  removed so orchestrators can pass opus/sonnet per work-item complexity.
- `dotnet-authorization` skill description trimmed under the combined 1024 cap
  (caught by the new combined check).

### Dropped from plan
- `disable-model-invocation: true` on orchestration skills — verified it would block
  the Skill tool inside /fsp-* commands (skills docs: user-invocable only).

## 2026-07-11 — fsp- command prefix + implementor & support agents (all plugins)

pilot-core 0.15.0 → 0.16.0, pilot-angular 0.20.0 → 0.21.0, pilot-dotnet 0.24.0 → 0.25.0,
pilot-sql 0.13.0 → 0.14.0, pilot-azure 0.14.0 → 0.15.0

### Changed
- **BREAKING (command names)**: all commands renamed with the `fsp-` brand prefix —
  `/pilot-init` → `/fsp-init`, `/pilot-audit` → `/fsp-audit`, `/pilot-fix` → `/fsp-fix`,
  `/pilot-learn` → `/fsp-learn`. All cross-references in skills, templates, docs, and
  test fixtures updated. Convention documented in CLAUDE.md and enforced by
  `scripts/validate.mjs` (a `commands/*.md` file not starting with `fsp-` fails CI).

### Added
- **Implementor agents** (one per stack plugin) — the fixing counterpart to each
  reviewer: `@angular-implementor`, `@dotnet-implementor`, `@sql-implementor`,
  `@infra-implementor`. Each takes a reviewer finding (standard ID + file:line) or a
  feature request, reads the governing SKILL.md before writing code, applies minimal
  targeted edits, verifies (`dotnet build` / `tsc --noEmit` / `az bicep lint`), and
  reports back in a format the paired reviewer can re-check. Hard gates: user sign-off
  required for API-surface, auth, destructive-migration, or resource-deletion changes;
  never commits.
- **Support agents** (one per stack plugin + a triage router) — product-support
  assistants that diagnose a symptom to root cause with cited `file:line` evidence and
  propose a fix referencing the governing skill's standard ID, then hand off to the
  implementor: `@angular-support` (can inspect the live app via bundled Playwright
  tools), `@dotnet-support`, `@sql-support`, `@azure-support` (can run live read-only
  diagnostics via bundled Azure MCP tools: resourcehealth, monitor, applens, kusto),
  and `@fullstack-support` (pilot-core) which classifies any full-stack symptom and
  routes it to the right specialist with a structured handoff. All support agents are
  read-only (`disallowedTools: Write, Edit`).
- `scripts/validate.mjs`: new agent-file checks — `name`/`description` frontmatter
  required; `*-reviewer`/`*-support` agents must declare `disallowedTools: Write, Edit`;
  `*-implementor` agents must not.
- Agent and command conventions sections in CLAUDE.md.

## [0.20.0] — 2026-07-05 (pilot-dotnet), pilot-angular 0.16.0 → 0.17.0

### Added
- Closes the round-3 gap audit's Tier-3 backlog (Tier 1 in `[0.18.0]`, Tier 2 in
  `[0.19.0]`) — the full round-3 audit is now fully shipped.
- `pilot-dotnet`: two new skills, both conditional/narrow by design — `dotnet-graphql`
  (only applies when HotChocolate/GraphQL is present: `DataLoader` batching for N+1
  resolvers, query depth/complexity limits closing a DoS vector unique to GraphQL's
  client-driven query shape, permissions-only field authorization, persisted-query
  allow-list) and `dotnet-chaos-engineering` (fault-injection verification via Polly
  Simmy/Azure Chaos Studio that the resilience policies already established elsewhere —
  `dotnet-resilience`'s retries, `dotnet-outbox-pattern`'s idempotent consumers,
  `dotnet-connection-pool-tuning`'s pool sizing — actually behave as configured under a
  real fault, not just on paper; scheduled game-day cadence; findings feeding back into
  `incident-response-runbook`/`azure-slo-error-budget`).
- `pilot-angular`: `angular-third-party-scripts` — SRI hashes for CDN-loaded scripts, a
  documented third-party tag allow-list/review process, scoped CSP allowances instead of
  vendor-driven wildcards, and monitoring for approved-script behavior drift after
  initial review. A supply-chain concern for code the application doesn't control at
  all, closer in spirit to `dependency-supply-chain` than to `angular-security`'s XSS
  prevention.
- `dotnet-reviewer`/`angular-reviewer` agents: inventory rows and review-checklist
  categories for all three additions.

### Changed
- `plugin.json`: `pilot-dotnet` `0.19.0` → `0.20.0`; `pilot-angular` `0.16.0` → `0.17.0`.
- `docs/pilot-dotnet.md`, `docs/pilot-angular.md`, `README.md`: skill tables and counts
  updated (pilot-dotnet 36→38, pilot-angular 17→18).

## [0.19.0] — 2026-07-05 (pilot-dotnet), pilot-azure 0.13.0 → 0.14.0, pilot-core 0.12.0 → 0.13.0

### Added
- Closes the round-3 gap audit's Tier-2 backlog (Tier 1 in `[0.18.0]`).
- `pilot-azure`: `azure-container-image-security` — the image-build-time layer above
  `azure-aks-governance`'s pod-spec runtime checks: base-image vulnerability scanning
  gate in CI, non-root container user, distroless/minimal runtime images, and
  image-signing/provenance verification before deployment.
- `pilot-dotnet`: `dotnet-connection-pool-tuning` — a distinct failure mode from
  `dotnet-resilience`'s retry/circuit-breaker policies (which handle a connection
  failing, not a pool running out of connections to hand out): explicit `Max`/`Min
  Pool Size` tuned to expected concurrency, dedicated pool-exhaustion monitoring,
  connection/`DbContext` scope tightness, and correct `DbContext` lifetime for the
  hosting model (scoped for web requests, `IDbContextFactory` for background jobs).
- `pilot-core`: `test-data-management` — closes a gap `dotnet-data-protection`/
  `sql-data-protection`'s production PII controls leave open if a raw prod backup is
  restored into a less-protected lower environment: an anonymization/masking step for
  prod-to-lower-environment refreshes, synthetic-data seeding as a lighter-weight
  alternative, environment access-control parity once prod-derived data is present,
  and a documented policy for what's safe to copy at all.
- `infra-reviewer`/`dotnet-reviewer` agents: inventory rows and review-checklist
  categories for all three additions.

### Changed
- `plugin.json`: `pilot-dotnet` `0.18.0` → `0.19.0`; `pilot-azure` `0.13.0` → `0.14.0`;
  `pilot-core` `0.12.0` → `0.13.0`.
- `docs/pilot-azure.md`, `docs/pilot-dotnet.md`, `docs/pilot-core.md`, `README.md`:
  skill tables and counts updated (pilot-azure 12→13, pilot-dotnet 35→36,
  pilot-core 9→10).

## [0.18.0] — 2026-07-05 (pilot-dotnet), pilot-sql 0.11.0 → 0.12.0, pilot-core 0.11.0 → 0.12.0, pilot-azure 0.12.0 → 0.13.0

### Added
- A third senior-architect gap audit (round 3, after 76 skills were already shipped
  across rounds 1–2) identified five more Tier-1 gaps; this release fills all of them.
- `pilot-dotnet`: two new skills — `dotnet-secrets-rotation` (JWT signing-key rotation
  with a grace-period overlap, DB credential rotation cadence, certificate expiry
  monitoring, rotation audit logging — the lifecycle layer above
  `dotnet-dynamic-configuration`'s storage-location rule) and
  `dotnet-api-contract-testing` (Pact consumer-driven contracts between the Angular
  frontend and this API, error-response contract coverage, shared TypeScript-schema
  generation, provider-verification deploy gate — closing a gap `dotnet-api-versioning`
  leaves open since it only protects an *existing* version's contract).
- `pilot-sql`: `sql-backup-recovery` — scheduled restore-drill testing, backup-integrity
  checks (`CHECKSUM`/`RESTORE VERIFYONLY`), point-in-time-restore test cadence, and
  retention-vs-RPO alignment. Distinct from `azure-dr-multiregion`'s cross-region
  replication and `sql-index-maintenance`'s ongoing index health — nothing else verified
  a backup is actually restorable.
- `pilot-core`: `dependency-license-compliance` — the legal-compliance sibling to
  `dependency-supply-chain`'s security-vulnerability scanning: OSS license scanning,
  copyleft (GPL/AGPL) risk review, a documented license allow-list/deny-list policy,
  license metadata in the SBOM.
- `pilot-azure`: `azure-slo-error-budget` — the proactive counterpart to
  `incident-response-runbook`'s reactive severity SLAs: defined SLO/SLI per
  customer-facing service, an error-budget policy that gates release velocity once
  exhausted, user-experience-accurate SLIs, and a live budget-consumption dashboard.
- `dotnet-reviewer`/`sql-reviewer`/`infra-reviewer` agents: inventory rows and
  review-checklist categories for all five additions.

### Changed
- `plugin.json`: `pilot-dotnet` `0.17.0` → `0.18.0`; `pilot-sql` and `pilot-core`
  `0.11.0` → `0.12.0`; `pilot-azure` `0.12.0` → `0.13.0`.
- `docs/pilot-dotnet.md`, `docs/pilot-sql.md`, `docs/pilot-core.md`, `docs/pilot-azure.md`,
  `README.md`: skill tables and counts updated (pilot-dotnet 33→35, pilot-sql 6→7,
  pilot-core 8→9, pilot-azure 11→12).

## [0.17.0] — 2026-07-05 (pilot-dotnet), pilot-sql 0.10.0 → 0.11.0, pilot-azure 0.11.0 → 0.12.0

### Added
- Closes the round-2 gap audit's Tier-3 backlog (Tier 1 in `[0.15.0]`, Tier 2 in
  `[0.16.0]`) — the full round-2 audit is now fully shipped.
- `pilot-dotnet`: `dotnet-financial-precision` — `decimal` vs `double`/`float` for
  currency amounts, a single documented rounding-mode convention (banker's rounding)
  applied consistently, exact `decimal` equality instead of floating-point tolerance
  comparisons, and currency-code-paired `Money` value objects for multi-currency systems.
- `pilot-sql`: `sql-index-maintenance` — the ongoing operational counterpart to
  `sql-performance-review`'s per-query analysis: scheduled fragmentation
  rebuild/reorganize, a proactive statistics-update cadence beyond
  `AUTO_UPDATE_STATISTICS`'s default threshold, unused-index monitoring, and
  online-vs-offline maintenance-window discipline.
- `pilot-azure`: `azure-landing-zone` — enterprise-scale subscription/management-group
  topology, one level above `azure-caf-naming`'s resource-name-string scope: a
  management-group hierarchy separating platform from landing-zone subscriptions,
  production/non-production subscription isolation, tenant-wide Azure Policy
  initiatives, and a documented subscription-vending process.
- `dotnet-reviewer`/`sql-reviewer`/`infra-reviewer` agents: inventory rows and
  review-checklist categories for all three additions.

### Changed
- `plugin.json`: `pilot-dotnet` `0.16.0` → `0.17.0`; `pilot-sql` `0.10.0` → `0.11.0`;
  `pilot-azure` `0.11.0` → `0.12.0`.
- `docs/pilot-dotnet.md`, `docs/pilot-sql.md`, `docs/pilot-azure.md`, `README.md`:
  skill tables and counts updated (pilot-dotnet 32→33, pilot-sql 5→6, pilot-azure
  10→11).

## [0.16.0] — 2026-07-05 (pilot-angular), pilot-azure/pilot-core 0.10.0 → 0.11.0

### Added
- Completes the round-2 gap audit's Tier 2 backlog (Tier 1 shipped in `[0.15.0]`).
- `pilot-azure`: two new skills — `azure-aks-governance` (Pod Security Standards,
  container resource requests/limits, `NetworkPolicy`, Azure Workload Identity — scoped
  to shops running AKS instead of Container Apps) and `azure-api-management` (gateway
  rate-limit/quota policy, JWT validation consistency with the backend, backend
  health/circuit-breaker, thin pass-through policy discipline — a distinct layer from
  `dotnet-rate-limiting`'s app-layer checks).
- `pilot-core`: `incident-response-runbook` — the response layer over
  `azure-observability`'s alert rules: runbook-per-alert convention, severity-to-
  response-time SLA, blameless-postmortem template, tracked action-item follow-through.
- `pilot-angular`: `angular-monorepo-governance` — Nx/module-federation boundary
  enforcement, shared-library ownership and cross-team versioning, independently
  deployable remote apps, no duplicated cross-cutting concerns (auth, theming) across
  apps. Only relevant once a workspace spans multiple apps/teams — a single-app
  codebase remains fully covered by the existing `angular-shared-libraries` skill.
- `infra-reviewer`/`angular-reviewer` agents: inventory rows and review-checklist
  categories for all four additions.

### Changed
- `plugin.json`: `pilot-angular` `0.15.0` → `0.16.0`; `pilot-azure` and `pilot-core`
  `0.10.0` → `0.11.0`.
- `docs/pilot-azure.md`, `docs/pilot-core.md`, `docs/pilot-angular.md`, `README.md`:
  skill tables and counts updated (pilot-core 7→8, pilot-azure 8→10, pilot-angular
  16→17).

## [0.15.0] — 2026-07-05 (pilot-dotnet, pilot-angular), pilot-core 0.9.0 → 0.10.0

### Added
- A second senior-architect gap audit (round 2, following up on the Tier 1–3 batches in
  `[0.13.0]`/`[0.14.0]`) identified six more Tier-1 gaps once the marketplace reached 63
  skills; this release fills all of them.
- `pilot-core`: `dependency-supply-chain` — the triage/policy layer over
  `audit-orchestration`'s raw `dotnet list package --vulnerable`/`npm audit` output:
  severity-to-patch-cadence SLA, version-pinning discipline (no floating ranges on direct
  dependencies), private-feed/allow-list policy against dependency confusion, and SBOM
  generation for release artifacts.
- `pilot-dotnet`: three new skills — `dotnet-feature-flags` (`Microsoft.FeatureManagement`
  vs ad-hoc config checks, percentage/targeting rollout, stale-flag cleanup — extends
  `dotnet-dynamic-configuration`), `dotnet-realtime` (SignalR hub permissions-only
  authorization, scale-out backplane, genuine `IAsyncEnumerable`/SSE streaming, client
  reconnection), and `dotnet-audit-trail` (append-only access-audit log for sensitive-data
  *reads* — distinct from `dotnet-audit-fields`' change tracking — tamper-evident storage,
  compliance query surface). Plus a new check (RES-006) added to the existing
  `dotnet-resilience` skill for EF Core's `EnableRetryOnFailure` connection resiliency.
- `pilot-angular`: `angular-telemetry` — Application Insights JS SDK wiring, consistent
  event-tracking naming, frontend-to-backend trace-ID correlation (joins with
  `dotnet-observability`'s traces), PII-free telemetry properties.
- `dotnet-reviewer`/`angular-reviewer` agents: inventory rows and review-checklist
  categories for all six additions.

### Changed
- `plugin.json`: `pilot-dotnet` and `pilot-angular` `0.14.0` → `0.15.0`; `pilot-core`
  `0.9.0` → `0.10.0` (first content change since Phase 5).
- `docs/pilot-core.md`, `docs/pilot-dotnet.md`, `docs/pilot-angular.md`, `README.md`:
  skill tables and counts updated (pilot-core 6→7, pilot-dotnet 29→32, pilot-angular
  15→16).

## [0.14.0] — 2026-07-04 (pilot-dotnet, pilot-angular), pilot-sql/pilot-azure 0.9.0 → 0.10.0

### Added
- Completes the senior-architect gap audit's Tier 2/3 backlog (see `[0.13.0]` below for
  Tier 1). Ten more skills fill the remaining gaps across all four governed stacks.
- `pilot-azure`: four new skills — `azure-observability` (centralized Log Analytics
  workspace, App Insights sampling, alert rules/action groups), `azure-cicd-security`
  (OIDC federated credentials vs long-lived secrets, environment approval gates,
  least-privilege deployment identity), `azure-dr-multiregion` (paired-region secondary
  deployment, Traffic Manager/Front Door failover, RPO/RTO, cross-region DB replication),
  `azure-cost-finops` (Azure Budget alerting, autoscale right-sizing cadence,
  cost-anomaly detection, orphaned-resource cleanup).
- `pilot-sql`: `sql-data-protection` — Always Encrypted, Dynamic Data Masking, TDE
  verification, backup/restore protection parity (the database-side counterpart to
  `dotnet-data-protection`).
- `pilot-angular`: two new skills — `angular-error-handling` (global `ErrorHandler`,
  `ProblemDetails`-aware HTTP error parsing, recoverable-vs-crash fallback UI) and
  `angular-pwa-offline` (service worker, offline fallback UI, shell-vs-API caching,
  offline-edit conflict resolution — for shops shipping field/offline-capable apps).
- `pilot-dotnet`: `dotnet-outbox-pattern` (transactional outbox for domain events,
  idempotent consumers, dead-letter monitoring) plus two new checks (DOC-007, DOC-008)
  added to the existing `dotnet-document-io` skill for magic-byte upload-signature
  verification and antivirus scanning before durable storage.
- `infra-reviewer`, `sql-reviewer`, `angular-reviewer`, `dotnet-reviewer` agents:
  inventory rows and review-checklist categories for all ten additions.

### Changed
- `plugin.json`: `pilot-dotnet` and `pilot-angular` `0.13.0` → `0.14.0`; `pilot-sql` and
  `pilot-azure` `0.9.0` → `0.10.0` (their first version bump since the 0.9.0-beta release,
  since this is their first content change since Phase 9).
- `docs/pilot-azure.md`, `docs/pilot-sql.md`, `docs/pilot-angular.md`,
  `docs/pilot-dotnet.md`, `README.md`: skill tables and counts updated.

## [0.13.0] — 2026-07-04

### Added
- Senior-architect gap audit of the full marketplace produced a Tier-1 punch list of
  production-readiness gaps; this release fills all 10 Tier-1 items.
- `pilot-dotnet`: eight new skills — `dotnet-resilience` (`IHttpClientFactory`/typed
  clients, Polly retry/circuit-breaker/timeout, correlation-ID propagation — the backend
  counterpart to `angular-http-resilience`), `dotnet-observability` (health checks,
  OpenTelemetry, correlation ID on traces, PII-safe telemetry), `dotnet-error-handling`
  (centralized `IExceptionHandler`, RFC 7807 `ProblemDetails`, typed domain exceptions),
  `dotnet-validation` (consistent FluentValidation strategy, single pipeline behavior),
  `dotnet-testing` (shared `WebApplicationFactory` fixtures, Testcontainers over EF Core
  in-memory provider, test data builders), `dotnet-data-protection` (PII column
  encryption, PII erasure on soft-delete, log redaction, data-classification tagging),
  `dotnet-concurrency` (`RowVersion` optimistic concurrency, `ETag`/`If-Match`), and
  `dotnet-rate-limiting` (auth/admin-endpoint throttling, `AddRateLimiter` baseline).
- `pilot-angular`: two new skills — `angular-testing` (accessible-role component
  queries, `HttpTestingController`, Component Test Harnesses, documented e2e/Playwright
  convention) and `angular-i18n` (i18n library wiring, shared translation-key space with
  `dotnet-localization`, locale-aware formatting, RTL support).
- `dotnet-reviewer`/`angular-reviewer` agents: inventory rows and review-checklist
  categories (K–N for .NET, I–J for Angular) for all ten new skills.

### Changed
- `plugin.json` for `pilot-dotnet` (20→28 skills) and `pilot-angular` (11→13 skills):
  `0.12.0` → `0.13.0`.
- `docs/pilot-dotnet.md`, `docs/pilot-angular.md`, `README.md`: skill tables and counts
  updated for the ten new skills.

## [0.12.0] — 2026-07-04

### Changed
- **Breaking policy change:** access control across both `pilot-dotnet` and
  `pilot-angular` is now permissions-ONLY — role-based checks are no longer acceptable
  under any circumstance, including previously-allowed "coarse" gating (e.g., admin-area
  entry). Roles may still exist purely as a role-to-permission assignment convenience,
  but no runtime authorization decision may ever evaluate a role name.
- `dotnet-authorization`: AZ-001 rewritten — `[Authorize(Roles = "...")]`,
  `User.IsInRole(...)`, and `RequireRole(...)` are flagged everywhere, with no exception.
  Severity raised P1 → P0.
- `dotnet-reviewer`: Category D checklist and severity mapping updated to reflect the
  no-exceptions rule.
- `angular-security`: added a new rule (`angular-permission-based-authz`, OWASP A01,
  block) and a full section covering permission-based `canActivate`/`canMatch` guards
  and structural directives (`*appHasPermission`) — client-side gating must mirror the
  backend's permissions-only model; role-keyed guards/directives are always a finding.
- `angular-reviewer`: Category A (renamed OWASP A01/A03) checklist and rule inventory
  updated accordingly.
- `plugin.json` for `pilot-dotnet` and `pilot-angular`: `0.11.0` → `0.12.0`.

## [0.11.0] — 2026-07-04

### Added
- `pilot-dotnet`: six new skills — `dotnet-entity-keys` (Guid vs int primary keys,
  sequential/v7 GUID generation), `dotnet-api-versioning` (`Asp.Versioning` wiring,
  breaking-change discipline, deprecation/sunset), `dotnet-di-modules` (per-module
  `IServiceCollection` extensions, clean `Program.cs`), `dotnet-background-jobs`
  (Hangfire vs hand-rolled loops, configurable job schedules, admin-endpoint auth,
  idempotency), `dotnet-dynamic-configuration` (DB-backed config vs Key Vault secrets,
  precedence, caching), `dotnet-localization` (XML default + DB-override translation
  layer, culture resolution).
- `pilot-angular`: `angular-dynamic-forms` — JSON-schema-driven reactive forms (field
  descriptor with id/name/validations/enabled/localization key/tooltip), generic renderer,
  descriptor-driven validation and enablement.
- `dotnet-reviewer`/`angular-reviewer` agents: inventory rows and review-checklist
  categories for all of the above.

### Changed
- `dotnet-audit-fields`: added AUD-006 — `CreatedBy`/`ModifiedBy` must be `Guid`-typed,
  resolved once from the `oid`/`sub` claim, not free-text `string`.
- `dotnet-authorization`: added AZ-006/AZ-007 — JWTs must not embed a permission list
  (resolve permissions per-request from a live store) or PII beyond a minimal subject
  identifier.
- `plugin.json` for `pilot-dotnet` and `pilot-angular`: `0.10.0` → `0.11.0`.
- `docs/pilot-dotnet.md`: rewritten — the plugin has shipped 14+ skills for several
  releases; the doc still read as the Phase-1 "manifest only" placeholder.
- `docs/pilot-angular.md`: skills table was missing `angular-coding-standards`,
  `angular-multi-layout`, `angular-theming`, `angular-shared-libraries` (all shipped
  earlier); backfilled, and added `angular-dynamic-forms`.
- `README.md`: `pilot-dotnet` Plugins-table row corrected from "Manifest only" to
  Implemented (20 skills); dropped the stale "skip it until it ships skills" install
  note.

## [0.9.0-beta] — 2026-07-04

First installable beta. All plugins bumped to `0.9.0` in lockstep.

### Added
- `docs/` — per-plugin reference (`pilot-core.md`, `pilot-angular.md`, `pilot-sql.md`,
  `pilot-azure.md`, `pilot-dotnet.md`), `TROUBLESHOOTING.md`, `CONTRIBUTING.md`,
  `SECURITY.md`
- `.github/workflows/release.yml` — gates tag-triggered releases on `scripts/validate.mjs`
  (which runs hook tests) before publishing
- `.github/ISSUE_TEMPLATE/` — bug report, skill request, rule proposal
- `CODEOWNERS`

### Fixed
- Repository was renamed to `AgenticPawan/FullStack-Pilot` — every plugin manifest,
  README reference, and the local git remote now point at that URL. The marketplace's
  *display name* (`fullstack-pilot`, used after `@` in `/plugin install <plugin>@fullstack-pilot`)
  happens to match, but the two fields are independent — the display name comes from
  `.claude-plugin/marketplace.json`'s `name` field, not the repo URL.
- README install commands no longer conflate the marketplace name with the repo name.
- Removed duplicate `version` fields from `marketplace.json` plugin entries — Claude Code
  always prefers `plugin.json`'s version silently, so keeping both is a footgun per the
  plugin-marketplaces docs. `plugin.json` is now the sole version authority.
- `pilot-dotnet`'s description no longer overstates its capability — it ships no skills
  or agents yet and is documented as a placeholder.

### Changed
- All five `plugin.json` files and their `marketplace.json` entries: `0.1.0` → `0.9.0`.

## [0.1.0] — Phase 1–9 (pre-beta, internal)

- Phase 1: marketplace scaffold, five manifest-only plugins, zero-dependency
  `scripts/validate.mjs`, CI validate workflow
- Phase 2: `/pilot-init` command + `stack-detection` skill + test fixtures
- Phase 3: scaffold interview, `CLAUDE.md` generation, version-gated rules
- Phase 4: `pilot-core` hooks (secret guard, dangerous-pattern guard, formatter)
- Phase 5: MCP wiring, `dotnet/skills` routing, `mcp-discovery` skill
- Phase 6: `pilot-angular` — 7 skills + `angular-reviewer` agent
- Phase 7: `/pilot-audit` — scanner orchestration + semantic pass
- Phase 8: `/pilot-fix` — batched remediation pipeline
- Phase 9 (SQL/Azure): `pilot-sql` and `pilot-azure` — 4 skills + reviewer agent each
- Phase 9 (context): `/pilot-learn` self-updating context layer
