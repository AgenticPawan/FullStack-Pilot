# FullStack Pilot

> Codebase governance for full-stack Microsoft shops — Angular + .NET + SQL Server + Azure

**FullStack Pilot** is a [Claude Code](https://claude.ai/code) plugin marketplace that ships
skills, agents, and hooks enforcing house conventions and security baselines across a
full-stack Microsoft codebase: Angular on the frontend, ASP.NET Core / EF Core on the
backend, SQL Server for data, and Azure/Bicep for infrastructure. It runs a stack-detection
→ governance-scaffold → audit → remediation pipeline so a team gets consistent checks
without every developer hand-writing `CLAUDE.md` rules.

## Install

Three steps: add the marketplace, install the plugins you need, restart.

```shell
/plugin marketplace add AgenticPawan/FullStack-Pilot
```

```shell
/plugin install pilot-core@fullstack-pilot
/plugin install pilot-angular@fullstack-pilot
/plugin install pilot-sql@fullstack-pilot
/plugin install pilot-azure@fullstack-pilot
```

`pilot-core` is required by every other plugin — install it first.

Restart Claude Code (or run `/plugin marketplace update`) so newly installed skills and
commands load.

### Local / development install

```shell
git clone https://github.com/AgenticPawan/FullStack-Pilot
cd FullStack-Pilot
```

Inside a Claude Code session:

```shell
/plugin marketplace add ./
/plugin install pilot-core@fullstack-pilot
```

Or load a single plugin directly without a marketplace entry:

```shell
claude --plugin-dir ./plugins/pilot-core
```

## 60-second quickstart

Run these three commands, in order, against your own Angular/.NET/SQL/Azure project
(not this plugin repo):

```shell
/pilot-init
```
Detects your stack (Angular/.NET/SQL Server/Azure versions, evidence-cited), asks you to
confirm, then scaffolds `CLAUDE.md` and version-gated rules into `.claude/rules/`.

```shell
/pilot-audit
```
Runs available scanners (`dotnet list package --vulnerable`, `npm audit`, `semgrep`,
`eslint`, `az bicep lint`) plus a bounded Claude semantic pass for IDOR, tenant-isolation
gaps, authN/authZ flaws, and secrets. Writes `.claude/pilot/audit/findings.json` and
`AUDIT-REPORT.md`.

```shell
/pilot-fix --batch P0
```
Applies fixes for one severity tier at a time on a dedicated branch, verifies with a
build, and rolls back automatically on regression. Never mixes severity tiers or
touches more than 10 files without asking.

## Plugins

| Plugin | Status | Purpose |
|---|---|---|
| `pilot-core` | Implemented | 10 skills: stack detection, scaffold, audit/fix pipelines, MCP discovery, dependency-supply-chain policy (patch SLAs, SBOM), incident-response runbook/postmortem governance, open-source license compliance, safe test-data management, `/pilot-init` `/pilot-audit` `/pilot-fix` `/pilot-learn` |
| `pilot-angular` | Implemented | 18 skills + reviewer agent: signals & state, performance, a11y (WCAG 2.2 AA), security (XSS/CSP, permissions-ONLY route guards/UI gating), HTTP resilience, memory-leak detection, v15→v20 upgrade path, coding standards, multi-layout shells, theming, JSON-driven dynamic forms, testing conventions, i18n, global error handling, PWA/offline support, frontend telemetry, Nx/module-federation monorepo governance, third-party script governance |
| `pilot-sql` | Implemented | 7 skills + reviewer agent: SQL injection defense, migration safety, multitenancy isolation, performance review, PII data protection (Always Encrypted, Dynamic Data Masking, TDE), index/statistics maintenance, backup/restore-drill verification |
| `pilot-azure` | Implemented | 13 skills + reviewer agent: CAF naming, security baseline, Well-Architected Framework review, Bicep patterns, centralized observability, CI/CD deployment security, multi-region disaster recovery, cost/FinOps guardrails, AKS cluster governance, API Management gateway policy review, enterprise-scale landing-zone topology, SLO/error-budget policy, container image security |
| `pilot-dotnet` | Implemented | 38 skills + reviewer agent: Clean Architecture, SOLID/DRY, performance, caching, permissions-ONLY auth (no role checks, ever; JWT PII/permission hardening), multitenancy, soft delete, Guid-typed audit fields, CORS, repository pattern, shared libraries, document I/O, email service, Guid entity keys, API versioning, modular DI, Hangfire background jobs, DB-backed configuration, localization, HTTP/EF Core resilience, observability, error handling, validation, testing, data protection, concurrency, rate limiting, transactional outbox pattern, feature flags, real-time/SignalR, compliance access-audit logging, financial/currency precision, secrets rotation, API contract testing, connection-pool tuning, GraphQL design, chaos engineering — see [Relationship to dotnet/skills](#relationship-to-dotnetskills) |

## Supported versions

FullStack Pilot draws a hard line between versions it actively governs and versions it
only helps you get off of. EOL runtimes get an upgrade path, not new rules.

| Stack | Deep coverage (active rules + skills) | Upgrade-path only (EOL, no new rules) |
|---|---|---|
| Angular | 17, 18, 19, 20 | 15, 16 — both EOL; `angular-upgrade-path` skill covers migration only |
| .NET | 8, 9, 10, 11 | 6, 7 — both EOL; covered by `dotnet/skills`' `dotnet-upgrade`, not by pilot-dotnet |
| SQL Server | current + prior LTS | — |
| Azure | current API versions per Bicep provider | — |

If `/pilot-init` detects Angular 15/16 or .NET 6/7, it prints an EOL advisory instead of
silently applying rules meant for supported versions.

## Relationship to dotnet/skills

FullStack Pilot **builds on, does not replace**, Microsoft's official
[`dotnet/skills`](https://github.com/dotnet/skills) marketplace. `/pilot-init` detects
.NET projects and, in Phase 3, prints the exact commands to install it:

```shell
/plugin marketplace add dotnet/skills
/plugin install dotnet-data@dotnet-agent-skills
/plugin install dotnet-test@dotnet-agent-skills
/plugin install dotnet-upgrade@dotnet-agent-skills
/plugin install dotnet-aspnetcore@dotnet-agent-skills
/plugin install dotnet-ai@dotnet-agent-skills
```

Routing: EF Core performance/query optimization, test running, framework upgrades, and
minimal-API endpoint work route to `dotnet/skills`. `pilot-dotnet` is reserved for
conventions Microsoft's skills intentionally leave to each team — Clean Architecture
layering, permission-based authorization, multitenancy, audit fields, entity-key design,
API versioning, modular DI, background jobs, dynamic configuration, localization — not a
duplicate of what they already cover.

## IDE support

| Surface | Support |
|---|---|
| Claude Code CLI | Full support — this is the primary target |
| VS Code extension | Full support |
| Visual Studio | No native integration. Works **alongside** Visual Studio via its integrated terminal (View → Terminal), where the Claude Code CLI runs normally |

## Validate locally

The repository ships a zero-dependency Node.js validator. Run it before opening a PR:

```shell
node scripts/validate.mjs
```

It checks `marketplace.json`, every `plugin.json`, every `SKILL.md` frontmatter, and
every `hooks.json` for schema correctness and script existence, then runs
`tests/hooks/run-tests.mjs`. Exits non-zero on any failure.

## Documentation

- [docs/pilot-core.md](docs/pilot-core.md), [docs/pilot-angular.md](docs/pilot-angular.md),
  [docs/pilot-sql.md](docs/pilot-sql.md), [docs/pilot-azure.md](docs/pilot-azure.md),
  [docs/pilot-dotnet.md](docs/pilot-dotnet.md) — per-plugin reference
- [docs/mcp-setup.md](plugins/pilot-core/docs/mcp-setup.md) — MCP server credentials and setup
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common install/runtime issues
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — skill authoring conventions, PR process
- [docs/SECURITY.md](docs/SECURITY.md) — vulnerability reporting
- [CLAUDE.md](CLAUDE.md) — plugin layout, `SKILL.md`/hooks conventions, commit format
- [CHANGELOG.md](CHANGELOG.md) — release history

## License

[MIT](LICENSE) © FullStack Pilot Contributors
