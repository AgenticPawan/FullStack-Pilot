# Changelog

All notable changes to FullStack Pilot are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
