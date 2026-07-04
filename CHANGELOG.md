# Changelog

All notable changes to FullStack Pilot are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
