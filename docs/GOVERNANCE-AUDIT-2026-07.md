# Governance wiring audit — 2026-07-12

Full audit of agent ↔ rule ↔ skill ↔ MCP ↔ command wiring across all 5 plugins, plus three
new capabilities: Angular UI/UX coverage, and a "default modules first" gate for greenfield
projects. Findings below are verified (file:line), not assumed.

## Confirmed bugs

1. **Dangling rule IDs** — `angular-reviewer.md`/`angular-implementor.md`/`angular-security/SKILL.md`
   cite `angular-permission-based-authz`; `angular-security/SKILL.md`'s own rule-reference table
   additionally cites `angular-no-bypass-without-comment`, `angular-csp-nonce`,
   `angular-trusted-types`, `angular-csrf-dotnet`. None have a `rules-catalog/<id>.md` file, so
   `pilot-scaffold` can never materialize them into a project's `.claude/rules/` — they're cited
   as "always enforced" but aren't wired to actually be enforced.
2. **Orphan catalog file** — `rules-catalog/angular-lt17-ngmodule.md` exists but is never cited by
   `angular-reviewer.md`'s Rules table (its `gte17` sibling is cited; this one isn't).
3. **Orphan catalog files** — `dotnet-gte8-resilience.md`, `dotnet-httpclient-factory.md`,
   `dotnet-lt8-legacy.md` exist but `dotnet-reviewer.md`/`dotnet-implementor.md` only list the 3
   generic `always-*` rules — the dotnet-specific ones are invisible to both agents.
4. **Broken command reference** — `/pilot-upgrade` is referenced 3 times (`rules-catalog/angular-lt17-ngmodule.md:8`,
   `rules-catalog/dotnet-lt8-legacy.md:8,26`, `pilot-scaffold/SKILL.md:37,49,253`) but no such
   command exists anywhere. The correct fix is NOT a new command — Angular EOL migration is
   already fully covered by the `angular-upgrade-path` skill, and .NET EOL migration is
   intentionally delegated to the external `dotnet-upgrade@dotnet-agent-skills` plugin
   (`fsp-init.md` Phase 3 already installs it). Fix: point at what actually exists.
5. **sql-mcp under-wired** — `sql-performance-review` skill names `sql-mcp` explicitly, but
   `sql-support.md` (whose entire job is execution-plan/DMV diagnosis) never names it, only
   describing the activity generically.

## Coverage gaps (not bugs, but real gaps)

- No MCP tool is named anywhere in pilot-dotnet — `microsoft-learn` (official Microsoft/.NET
  docs) would ground `dotnet-authentication`/`dotnet-observability`/`dotnet-grpc`/`dotnet-graphql`
  implementation and diagnosis in current guidance.
- `infra-reviewer.md` is 100% static-file-only; azure-mcp's `extension_azqr` (Azure Quick Review)
  and `wellarchitectedframework` tools directly match `azure-waf-review`'s checklist but are never
  invoked anywhere in pilot-azure. `advisor`, `keyvault`, `role`, `aks`, `loadtesting` are also
  unused despite direct skill matches.
- `github` MCP server is bundled in `.mcp.json` but completely unreferenced by any agent/skill/command
  in the repo — dead weight as shipped.
- No dotnet skill covers security headers (HSTS/CSP/X-Frame-Options), anti-forgery/CSRF tokens, or
  safe JSON deserialization.
- No Angular skill covers visual/UI-UX consistency (spacing/typography scale, responsive layout,
  visual hierarchy, design-to-code fidelity) — distinct from `angular-a11y` (ARIA/focus),
  `angular-theming` (color tokens only), and `angular-shared-ui-kit` (dialog/toast architecture only).
- No mechanism ensures a brand-new project gets baseline auth/authz/logging/error-handling/health-checks/CORS
  scaffolded before feature work begins — `/fsp-build` has zero precondition checking this.

## Fix plan

| Phase | What | Where |
|---|---|---|
| A | Create 5 missing angular rule files + wire 2 orphan catalog files (angular-lt17-ngmodule, 3 dotnet rules) into their reviewers/implementors + 2 new deterministic rules (sql destructive-migration, azure public-network-access) | `rules-catalog/`, `*-reviewer.md`, `*-implementor.md` |
| B | Fix the 3 dangling `/pilot-upgrade` references to point at `angular-upgrade-path` skill / the external `dotnet-upgrade` plugin | `rules-catalog/*.md`, `pilot-scaffold/SKILL.md` |
| C | Wire sql-mcp into sql-support/sql-implementor; microsoft-learn into dotnet-support/dotnet-implementor; more azure-mcp tools into infra-reviewer/infra-implementor/infra-support; github MCP into git-workflow-governance; Playwright into angular-implementor | agent files |
| D | New skill `dotnet-security-headers`; new skill `angular-ui-ux-consistency` (wired into existing reviewer/implementor/support tables, no new agent) | `plugins/pilot-dotnet/skills/`, `plugins/pilot-angular/skills/` |
| E | New skill `foundation-bootstrap` + new command `/fsp-bootstrap` that scaffolds baseline auth/authz/logging/error-handling/health-checks/CORS via the stack implementors; hard gate in `fsp-build-orchestration` Step 0 that stops (never silently waived by `--yes`) when a greenfield project has no foundation modules yet | `plugins/pilot-core/skills/foundation-bootstrap/`, `plugins/pilot-core/commands/fsp-bootstrap.md`, `fsp-build-orchestration/SKILL.md` |
| F | plugin.json/marketplace.json/README/docs/CHANGELOG updates, version bumps | manifests + docs |

Executed phase by phase below; each phase is a separate commit, `node scripts/validate.mjs` run
clean after every phase.

## Status

- [x] Phase A — rules-catalog completeness
- [x] Phase B — dangling `/pilot-upgrade` references
- [x] Phase C — MCP wiring
- [x] Phase D — new skills (dotnet-security-headers, angular-ui-ux-consistency)
- [x] Phase E — foundation-bootstrap skill + `/fsp-bootstrap` command + hard gate
- [x] Phase F — manifests, docs, CHANGELOG
