# Changelog

All notable changes to FullStack Pilot are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
