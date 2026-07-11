# Changelog

All notable changes to FullStack Pilot are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
