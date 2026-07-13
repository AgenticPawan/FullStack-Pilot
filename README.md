# FullStack Pilot

> Codebase governance for full-stack Microsoft shops — Angular + .NET + SQL Server + Azure

**FullStack Pilot** is a [Claude Code](https://claude.ai/code) plugin marketplace that ships
skills, agents, and hooks enforcing house conventions and security baselines across a
full-stack Microsoft codebase: Angular on the frontend, ASP.NET Core / EF Core on the
backend, SQL Server for data, and Azure/Bicep for infrastructure. It runs a stack-detection
→ governance-scaffold → audit → remediation pipeline so a team gets consistent checks
without every developer hand-writing `CLAUDE.md` rules.

## What you need before you start (5-minute primer)

You do **not** need to know anything about plugin development to use this. You just need:

1. **A code editor / terminal** — any computer with a terminal (Mac, Windows, Linux) works.
2. **[Claude Code](https://claude.ai/code) installed** — this is Anthropic's command-line
   coding assistant. If you don't have it yet, follow Anthropic's install guide, then run
   `claude` once in any folder to confirm it starts.
3. **A full-stack project** — either one you already have (Angular + .NET + SQL Server,
   any subset is fine) or a brand-new empty folder if you're starting from scratch.
4. **Git** installed (`git --version` in a terminal should print something, not an error).

That's it. "FullStack Pilot" itself is not software you run directly — it's a pack of
extra knowledge and checklists ("skills") that Claude Code loads and uses automatically
while it helps you code. Think of it like installing a set of house rules and a checklist
for a new employee, except the employee is Claude and the rules are for Angular/.NET/SQL
Server/Azure best practices.

Everything below happens **inside a Claude Code session** — you open a terminal, `cd`
into your project folder, type `claude` to start a session, and then type the commands
shown (they start with `/`).

## Part A — Add FullStack Pilot to Claude Code (do this once)

This step makes the plugin pack available on your machine. You only do this once, ever
(not once per project).

1. Open a terminal.
2. Start Claude Code by typing:
   ```shell
   claude
   ```
3. Inside the Claude Code session, register this plugin pack ("marketplace" just means
   "a catalog of plugins Claude Code knows how to fetch"):
   ```shell
   /plugin marketplace add AgenticPawan/FullStack-Pilot
   ```
4. Install the plugins you want. `pilot-core` is required — it's the shared engine every
   other plugin depends on. Install the others based on what your project actually uses;
   it's fine to skip ones you don't need (e.g. skip `pilot-azure` if you don't deploy to
   Azure).
   ```shell
   /plugin install pilot-core@fullstack-pilot
   /plugin install pilot-angular@fullstack-pilot
   /plugin install pilot-dotnet@fullstack-pilot
   /plugin install pilot-sql@fullstack-pilot
   /plugin install pilot-azure@fullstack-pilot
   /plugin install pilot-rag@fullstack-pilot     # optional: local self-hosted RAG over your own codebase
   ```
5. Restart Claude Code so the newly installed skills load — exit the session (type `exit`
   or press `Ctrl+D`) and run `claude` again. (Alternatively, run
   `/plugin marketplace update` without restarting.)

That's the entire "installation." From here on, Claude Code will quietly consult these
skills whenever it reviews or writes Angular/.NET/SQL/Azure code — you don't invoke them
by name, they just make Claude's suggestions follow your team's conventions.

### Local / development install (only if you cloned this repo yourself)

If you've cloned the FullStack-Pilot repository itself (e.g. to contribute or to preview
changes before they're published), point Claude Code at your local copy instead of GitHub:

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

## Part B — Using FullStack Pilot in a project you already have

Follow this if you already have an existing Angular/.NET/SQL Server/Azure codebase and
want Pilot's governance applied to it.

**Step 1 — Open a terminal in your project's root folder** (the folder that contains
your `.git` folder, `.sln`/`package.json`, etc.) — not the FullStack-Pilot repo.

```shell
cd path/to/your-existing-project
claude
```

**Step 2 — Detect your stack.** Run:
```shell
/fsp-init
```
Claude reads your project (looking at real files — `package.json`, `.csproj`, `.sln`,
Bicep files) to figure out which Angular/.NET/SQL Server/Azure versions you're on. It
shows you a summary table and asks you to confirm it got it right before doing anything
else. Once confirmed, it writes a `CLAUDE.md` file (a plain-English description of your
project's conventions) and a `.claude/rules/` folder (machine-checkable rules matched to
your exact versions — e.g. it won't apply Angular 20 rules to an Angular 16 app).

*Nothing you have is deleted or overwritten without asking.* If it finds an outdated
stack (e.g. Angular 15 or .NET 7), it tells you that instead of silently applying rules
meant for newer versions.

**Step 3 — Find existing problems.** Run:
```shell
/fsp-audit
```
This runs your project's own tools (`dotnet list package --vulnerable`, `npm audit`,
linters) plus a Claude-driven read-through looking for things tools can't catch — broken
permission checks, tenant-data leaks, hardcoded secrets, and so on. It writes a plain
report you can read: `AUDIT-REPORT.md`, plus a machine-readable `findings.json`.

**Step 4 — Fix problems safely, a batch at a time.** Run:
```shell
/fsp-fix --batch P0
```
`P0` means "most severe first." This creates a separate git branch, applies only the
most critical fixes, and runs your build to make sure nothing broke — if it did, Pilot
automatically undoes the change instead of leaving your project broken. Review the
branch's diff like you would any pull request, then repeat with `--batch P1`, `--batch
P2`, etc. for lower-severity issues, at your own pace. Nothing merges to your main branch
without you doing it yourself.

**Step 5 (ongoing) — Just keep coding.** From here on, whenever you ask Claude Code to
add a feature, review a diff, or fix a bug in this project, it automatically applies the
matching skill's conventions (e.g. "never check roles, only permissions" for auth, or
"always use parameterized queries" for SQL) without you having to ask for it by name.

## Part C — Starting a brand-new full-stack project from scratch

Follow this if you don't have a project yet and want to start one with governance built
in from day one, rather than bolted on later.

**Step 1 — Create an empty folder and initialize git.**
```shell
mkdir my-new-app
cd my-new-app
git init
```

**Step 2 — Scaffold the actual application code.** FullStack Pilot governs conventions;
it doesn't generate the initial Angular/.NET project skeleton for you — use the standard
official tools first:
```shell
# Angular frontend
npx @angular/cli new client --routing --style=scss

# .NET backend (example: a Web API)
dotnet new webapi -n Server
dotnet new sln
dotnet sln add Server
```
Adjust these to whatever shape your project needs (a Blazor app, a class library, a
Minimal API — any combination is fine). The important part is that by the end of this
step, you have at least one recognizable Angular and/or .NET project file on disk
(`angular.json`, `*.csproj`) inside `my-new-app`.

**Step 3 — Start Claude Code in this new folder and install Pilot** (skip this if you
already did Part A on this machine before — the marketplace registration is per-machine,
not per-project):
```shell
claude
/plugin marketplace add AgenticPawan/FullStack-Pilot
/plugin install pilot-core@fullstack-pilot
/plugin install pilot-angular@fullstack-pilot
/plugin install pilot-dotnet@fullstack-pilot
```

**Step 4 — Run the same three commands as an existing project**, in the same order:
```shell
/fsp-init
```
On a brand-new project this is fast — there's little to detect and no legacy code to
work around. It writes your `CLAUDE.md` and version-gated rules immediately, matched to
whatever Angular/.NET version you just scaffolded.

```shell
/fsp-audit
```
On a fresh scaffold this usually comes back clean or with a small number of starter-
template nitpicks — that's expected and a good sign.

```shell
/fsp-fix --batch P0
```
Apply any findings the same way as an existing project (there's usually little to fix
this early).

**Step 5 — Commit the scaffold, then build.** Once `CLAUDE.md` and `.claude/rules/`
exist and your first audit is clean, commit everything and start building features
normally. Every piece of code Claude writes for you from this point forward is checked
against the rules Pilot just set up — you're building on governance from commit #1
instead of retrofitting it after the project has grown.

```shell
git add .
git commit -m "chore: scaffold project with FullStack Pilot governance"
```

## Quick reference — the commands you'll use most

| Command | What it does in one sentence |
|---|---|
| `/fsp-init` | Figures out your stack and writes the conventions/rules files |
| `/fsp-bootstrap` | New project? Scaffolds baseline auth/authz/logging/error-handling/health-checks/CORS before any feature work |
| `/fsp-audit` | Scans for existing problems and writes a report |
| `/fsp-fix --batch <tier>` | Fixes one severity tier of problems on a safe, reviewable branch |
| `/fsp-architect` | Assesses the whole solution against the target state and writes a ranked gap register with buildable enhancement plans |
| `/fsp-build <feature>` | Builds a feature end to end — spec → plan → implement → review → test — on a reviewable branch, in one command |

## Agents — review, implement, support

Each stack plugin ships a trio of specialist agents. You talk to them by @-mentioning
their name in any Claude Code prompt — no command needed:

| Role | What it does | Can it edit files? |
|---|---|---|
| **Reviewer** | Checks a diff or file against every rule and skill in its plugin; outputs findings with standard IDs, severity, and fix guidance | No — read-only |
| **Implementor** | Takes a reviewer finding (or a feature request) and writes the fix, compliant with the same rules; verifies with your build; never commits | Yes |
| **Support** | Takes a symptom ("this endpoint returns 500", "this page is blank") and diagnoses it to root cause with cited `file:line` evidence, then proposes a fix | No — read-only |

### Who's who

| Stack | Reviewer | Implementor | Support |
|---|---|---|---|
| Angular | `@angular-reviewer` | `@angular-implementor` | `@angular-support` |
| .NET | `@dotnet-reviewer` | `@dotnet-implementor` | `@dotnet-support` |
| SQL Server / EF Core | `@sql-reviewer` | `@sql-implementor` | `@sql-support` |
| Azure / Bicep | `@infra-reviewer` | `@infra-implementor` | `@infra-support` |
| All layers at once | `@fullstack-reviewer` | `@fullstack-implementor` | `@fullstack-support` |

### The review → implement loop

The reviewer and implementor are designed to work as a pair:

```
> @dotnet-reviewer review src/Api/Controllers/OrdersController.cs
  … findings: [CRITICAL] AZ-001 role check at line 42 …

> @dotnet-implementor fix the AZ-001 finding in OrdersController.cs:42
  … applies the fix, runs dotnet build, reports back …

> @dotnet-reviewer re-check OrdersController.cs
  … confirms the finding is resolved …
```

The implementor never commits and never merges — it leaves the change in your working
tree for you to review like any other diff. It also stops and asks before anything
risky: changing a public API or auth attribute (.NET), a destructive migration (SQL),
deleting or re-permissioning a resource (Azure), or changing a route/guard (Angular).

### The support → implement loop

Support agents are for "something is broken and I don't know why" moments. Describe
the symptom; they gather evidence read-only and hand you a diagnosis:

```
> @dotnet-support POST /api/orders started returning 500 after yesterday's deploy
  … reads the stack trace, Program.cs, the endpoint …
  Root cause: UseAuthorization() moved above UseAuthentication() (MWP-002)
  Evidence: src/Api/Program.cs:31
  To apply this fix, invoke @dotnet-implementor with the finding above.
```

If you don't know which layer owns the problem, start with `@fullstack-support` — it
triages the symptom (browser error? 500? slow query? deploy failure?), rules layers
out with quick evidence checks, and hands off to the right specialist for you.

Two of the support agents can go beyond reading source code when the bundled MCP
servers are configured: `@infra-support` can query live Azure diagnostics
(resource health, metrics, App Lens, log queries), and `@angular-support` can inspect
the running app's browser console and network traffic via Playwright. Both stay
strictly read-only — they never restart, scale, or mutate anything.

### Reviewing and fixing a diff that spans layers

A feature branch touching a migration, an API endpoint, and the Angular page that calls it
is three reviewers' worth of work. `@fullstack-reviewer` and `@fullstack-implementor` do
that as one loop instead of you juggling four @-mentions yourself:

```
> @fullstack-reviewer review this branch
  … classifies the diff: 1 migration (SQL+.NET), 1 controller (.NET), 1 component (Angular) …
  … delegates each file group to @sql-reviewer / @dotnet-reviewer / @angular-reviewer …
  … also checks the seam directly: does the Angular model still match the new DTO? …
  ## Full-Stack Review — 1 critical, 2 warnings, 0 advisory across 3 layers

> @fullstack-implementor fix the findings above
  … sequences the fix SQL → .NET → Angular, delegating each layer to its own implementor …
  … regenerates the NSwag client itself once the backend contract is final (cross-layer glue) …
  ## Full-Stack Implementation Summary — ready for re-review by @fullstack-reviewer
```

Like the stack-specific implementors, `@fullstack-implementor` never commits and stops for
your sign-off before anything a specialist's own hard gate would block (auth changes,
destructive migrations, public-API/route changes). It only edits files directly for glue
that belongs to no single layer (e.g. regenerating a generated API client) — everything
else is delegated to the owning specialist so that specialist's guardrails actually fire.

## The autonomous delivery team — `/fsp-architect` and `/fsp-build`

Beyond the per-stack specialists, `pilot-core` ships a four-role delivery team —
Business Analyst (`@fsp-analyst`), context scout (`@fsp-scout`), Solution Architect
(`@fsp-architect`), and QA engineer (`@fsp-qa`) — wired into two commands:

- **`/fsp-architect`** answers "what should we improve next?" It scouts your solution
  cheaply (haiku), then has the architect (opus) rank the gaps between your codebase
  and the target state the pilot skills encode. Each gap comes with an enhancement
  plan and a ready-to-run `/fsp-build` line.
- **`/fsp-build <feature | spec-file | GAP-id>`** answers "build it." One command runs
  spec → scout → plan → **your confirmation** → implement → paired review → QA test
  traceability → summary. Work lands on a `pilot/build-<feature>` branch that is never
  merged for you; a stopped run resumes with `--resume` without redoing finished steps.

Each role runs on the cheapest model tier that can do its job (haiku to read, sonnet
to analyze, opus only to plan and for complexity-tagged work items), and every handoff
is a file under `.claude/pilot/` rather than pasted chat — the pipeline is built to be
token-frugal by construction. Safety gates are non-negotiable: auth changes,
destructive migrations, public-API contract changes, and resource deletion always stop
for your sign-off, even with `--yes`. See [docs/pilot-core.md](docs/pilot-core.md) for
the full pipeline reference.

## Plugins

| Plugin | Status | Purpose |
|---|---|---|
| `pilot-core` | Implemented | 22 skills + 7 agents (the fsp-analyst/fsp-scout/fsp-architect/fsp-qa delivery team and the fullstack-reviewer/fullstack-implementor/fullstack-support cross-stack trio): stack detection, scaffold, `/fsp-bootstrap` baseline-module scaffolding (auth/authz/logging/error-handling/health-checks/CORS) gated ahead of feature work, audit/fix pipelines, the one-shot build pipeline, MCP discovery, dependency-supply-chain policy (patch SLAs, SBOM), git branching/PR-review workflow governance, CI-level secret scanning, cross-cutting REST API design standards, the cross-layer OIDC auth-token contract (SPA↔API audience/scope/claim agreement, permissions-only both ends), SLO-gated load/performance testing, incident-response runbook/postmortem governance, open-source license compliance, safe test-data management, `/fsp-init` `/fsp-bootstrap` `/fsp-audit` `/fsp-fix` `/fsp-learn` `/fsp-architect` `/fsp-build` |
| `pilot-angular` | Implemented | 32 skills + reviewer, implementor & support agents: signals & state, classic NgRx governance, performance, a11y (WCAG 2.2 AA), UI/UX visual consistency (spacing/type scale, responsive layout, visual hierarchy, design-to-code fidelity), motion/reduced-motion accessibility, security (XSS/CSP, permissions-ONLY route guards/UI gating), HTTP resilience, real-time/SignalR client (typed connection, reconnect, token, teardown), memory-leak detection, v15→v20 upgrade path, coding standards, multi-layout shells, theming, JSON-driven dynamic forms, testing conventions, i18n, global error handling, PWA/offline support, frontend telemetry, Nx/module-federation monorepo governance, third-party script governance, frontend feature-flag governance |
| `pilot-sql` | Implemented | 9 skills + reviewer, implementor & support agents: schema design (naming, keys, constraints), SQL injection defense, migration safety, multitenancy isolation, performance review, PII data protection (Always Encrypted, Dynamic Data Masking, TDE), index/statistics maintenance, backup/restore-drill verification, database-tier HA/failover (Always On AGs, Azure SQL failover groups, read-secondary routing) |
| `pilot-azure` | Implemented | 14 skills + reviewer, implementor & support agents: CAF naming, security baseline, Well-Architected Framework review, Bicep patterns, Key Vault + App Configuration provisioning (Key Vault references, managed-identity access, feature-flag store), centralized observability, CI/CD deployment security, multi-region disaster recovery, cost/FinOps guardrails, AKS cluster governance, API Management gateway policy review, enterprise-scale landing-zone topology, SLO/error-budget policy, container image security |
| `pilot-rag` | Implemented | 7 skills + `rag-implementor` (scaffold) & `rag-reviewer` (read-only) agents: `/fsp-rag-init` builds a local, self-hosted, provider-agnostic RAG system into `./pilot-rag/` inside your own project so Claude Code can answer questions about your Angular/.NET/SQL/Azure code cited to real files — discovery/ingestion manifest with secret redaction, Microsoft.Extensions.AI provider abstraction (swap Ollama↔Azure OpenAI by appsettings only, architecture-tested for zero vendor refs in the core), five chunkers with idempotent Qdrant ingestion, an SSE `/ask` endpoint with score floor and source citation, an Angular Signals chat UI, and a retrieval hit-rate eval gate. .NET-only orchestration (no Python/LangChain), read-only against your app, question-answering only |
| `pilot-dotnet` | Implemented | 57 skills + reviewer, implementor & support agents: Clean Architecture, SOLID/DRY, performance, caching, permissions-ONLY auth (no role checks, ever; JWT PII/permission hardening), security headers (HSTS/CSP/anti-forgery/safe JSON deserialization), multitenancy, soft delete, Guid-typed audit fields, CORS, repository pattern, shared libraries, document I/O, email service, Guid entity keys, API versioning, modular DI, middleware pipeline ordering, Hangfire background jobs, DB-backed configuration, localization, HTTP/EF Core resilience, liveness/readiness health checks, observability, error handling, validation, testing, data protection, concurrency, rate limiting, transactional outbox pattern, Saga orchestration, Service Bus/Event Grid messaging, gRPC, Backend-for-Frontend aggregation, feature flags, real-time/SignalR, compliance access-audit logging, financial/currency precision, secrets rotation, API contract testing, connection-pool tuning, GraphQL design, chaos engineering, NuGet Central Package Management — see [Relationship to dotnet/skills](#relationship-to-dotnetskills) |

## Supported versions

FullStack Pilot draws a hard line between versions it actively governs and versions it
only helps you get off of. EOL runtimes get an upgrade path, not new rules.

| Stack | Deep coverage (active rules + skills) | Upgrade-path only (EOL, no new rules) |
|---|---|---|
| Angular | 17, 18, 19, 20 | 15, 16 — both EOL; `angular-upgrade-path` skill covers migration only |
| .NET | 8, 9, 10, 11 | 6, 7 — both EOL; covered by `dotnet/skills`' `dotnet-upgrade`, not by pilot-dotnet |
| SQL Server | current + prior LTS | — |
| Azure | current API versions per Bicep provider | — |

If `/fsp-init` detects Angular 15/16 or .NET 6/7, it prints an EOL advisory instead of
silently applying rules meant for supported versions.

## Relationship to dotnet/skills

FullStack Pilot **builds on, does not replace**, Microsoft's official
[`dotnet/skills`](https://github.com/dotnet/skills) marketplace. `/fsp-init` detects
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
  [docs/pilot-dotnet.md](docs/pilot-dotnet.md), [docs/pilot-rag.md](docs/pilot-rag.md) — per-plugin reference
- [docs/mcp-setup.md](plugins/pilot-core/docs/mcp-setup.md) — MCP server credentials and setup
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common install/runtime issues
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — skill authoring conventions, PR process
- [docs/SECURITY.md](docs/SECURITY.md) — vulnerability reporting
- [CLAUDE.md](CLAUDE.md) — plugin layout, `SKILL.md`/hooks conventions, commit format
- [docs/GOVERNANCE-AUDIT-2026-07.md](docs/GOVERNANCE-AUDIT-2026-07.md) — agent ↔ rule ↔ skill ↔ MCP ↔ command wiring audit
- [docs/SPLIT-ELIGIBILITY-AUDIT-2026-07.md](docs/SPLIT-ELIGIBILITY-AUDIT-2026-07.md) — per-plugin split-vs-keep review for marketplace submission
- [CHANGELOG.md](CHANGELOG.md) — release history

## License

[MIT](LICENSE) © FullStack Pilot Contributors
