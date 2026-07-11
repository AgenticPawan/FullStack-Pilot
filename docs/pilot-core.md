# pilot-core

Shared governance utilities every other pilot plugin depends on. Install this first.

## Commands

| Command | Purpose |
|---|---|
| `/fsp-init` | Detects your stack (`stack-detection` skill), confirms with you, then scaffolds `CLAUDE.md` and `.claude/rules/` (`pilot-scaffold` skill). Phase 3 wires `dotnet/skills` for .NET projects; Phase 4 runs MCP discovery. |
| `/fsp-audit` | Runs the `audit-orchestration` skill: available scanners + a bounded Claude semantic pass, normalized into `.claude/pilot/audit/findings.json` and `AUDIT-REPORT.md`. |
| `/fsp-fix --batch <tier>` | Runs the `batched-remediation` skill: fixes one severity tier (`P0`–`P3`) at a time on its own branch, verifies with a build, rolls back on regression. |
| `/fsp-learn [--conventions] [--lessons] [--diff-only]` | Distills durable, project-specific knowledge from the session into `conventions.md` / `lessons.md`. Never runs git; you review and commit. |

## Skills

- **stack-detection** — evidence-based Angular/.NET/SQL Server/Azure detector. Every
  conclusion cites a file path. Writes `.claude/pilot/stack-profile.json`.
- **pilot-scaffold** — Phase 2 of `/fsp-init`: interview + `CLAUDE.md` generation
  (hard 100-line limit) + rules materialization from `rules-catalog/`.
- **audit-orchestration** — scanner orchestration + semantic triage for `/fsp-audit`.
- **batched-remediation** — branch-per-tier fix pipeline for `/fsp-fix`.
- **convention-learner** — used by `/fsp-learn --conventions`.
- **mcp-discovery** — scans your dependency graph for companion MCP servers and proposes
  them; never auto-registers a server without per-server consent.
- **dependency-supply-chain** — the policy layer over `audit-orchestration`'s raw dotnet/npm
  vulnerability scan output: severity-to-patch-cadence SLA, version-pinning discipline,
  private-feed/allow-list policy, SBOM generation for release artifacts.
- **incident-response-runbook** — the response layer over `azure-observability`'s alerts:
  runbook-per-alert convention, severity-to-response-time SLA, blameless-postmortem
  template, tracked action-item follow-through.
- **dependency-license-compliance** — the legal-compliance sibling to
  `dependency-supply-chain`'s security-vulnerability scanning: OSS license scanning,
  copyleft (GPL/AGPL) risk review, a documented license allow-list/deny-list policy,
  license metadata in the SBOM.
- **test-data-management** — closes the gap `dotnet-data-protection`/`sql-data-protection`
  leave open if a raw prod backup is restored into a less-protected environment:
  anonymization/masking for prod-to-lower-environment refreshes, synthetic-data seeding
  as a lighter-weight alternative, and a documented policy for what's safe to copy at all.

## Hooks

`hooks/hooks.json` registers three matcher-scoped hooks on `Write|Edit`:

| Hook | Event | Purpose |
|---|---|---|
| `secret-guard.js` | PreToolUse | Blocks writes that look like they contain hardcoded secrets |
| `dangerous-patterns.js` | PreToolUse | Blocks known-dangerous patterns (see `rules-catalog/`) |
| `formatter.js` | PostToolUse | Normalizes formatting after a write |

## Rules catalog

`rules-catalog/` holds the version-gated rules `pilot-scaffold` materializes into a
project's `.claude/rules/` based on the confirmed stack profile — e.g.
`angular-gte17-control-flow.md` only applies if Angular ≥17 was detected,
`angular-lt17-ngmodule.md` only if <17.

## MCP servers

`pilot-core` bundles five MCP servers in `.mcp.json` (GitHub, Microsoft Learn,
Playwright, Azure, SQL/DAB). See [mcp-setup.md](../plugins/pilot-core/docs/mcp-setup.md)
for required environment variables and per-server prerequisites.
