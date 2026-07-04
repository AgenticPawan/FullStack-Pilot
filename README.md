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

`pilot-core` is required by every other plugin — install it first. `pilot-dotnet` is
also listed in the marketplace but is a manifest-only placeholder today (see
[Plugins](#plugins) below); skip it until it ships skills.

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
| `pilot-core` | Implemented | Stack detection, scaffold, audit/fix pipelines, MCP discovery, `/pilot-init` `/pilot-audit` `/pilot-fix` `/pilot-learn` |
| `pilot-angular` | Implemented | 7 skills + reviewer agent: signals & state, performance, a11y (WCAG 2.2 AA), security (XSS/CSP), HTTP resilience, memory-leak detection, v15→v20 upgrade path |
| `pilot-sql` | Implemented | 4 skills + reviewer agent: SQL injection defense, migration safety, multitenancy isolation, performance review |
| `pilot-azure` | Implemented | 4 skills + reviewer agent: CAF naming, security baseline, Well-Architected Framework review, Bicep patterns |
| `pilot-dotnet` | **Manifest only** | No skills or agents yet. `/pilot-init` wires the official `dotnet/skills` marketplace for actual .NET coverage; this plugin will hold house conventions (Serilog policy, resilience policy) in a future release — see [Relationship to dotnet/skills](#relationship-to-dotnetskills) |

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
minimal-API endpoint work route to `dotnet/skills`. `pilot-dotnet` (once implemented) is
reserved for conventions Microsoft's skills intentionally leave to each team — logging
policy, resilience policy — not a duplicate of what they already cover.

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
