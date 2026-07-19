# FullStack Pilot — Codex Agent Config

> Minimal Codex-compatible config for the AgenticPawan/FullStack-Pilot plugin.
> Full agent definitions, skill load maps, and routing rules live in `AGENTS.md` at the repo root.

## Stack Coverage

This plugin governs Angular, .NET/ASP.NET Core, SQL Server/EF Core, and Azure/Bicep projects.
All commands are prefixed `fsp-`. All agents are prefixed `@<stack>-` or `@fsp-`.

## Agent Roster (by intent)

| When you need to… | Route to |
|-------------------|----------|
| Review a multi-layer diff | `@fullstack-reviewer` |
| Fix after a multi-layer review | `@fullstack-implementor` |
| Triage a production symptom | `@fullstack-support` |
| Write an Angular component or service | `@angular-implementor` |
| Review Angular/TypeScript diff | `@angular-reviewer` |
| Debug a browser or RxJS issue | `@angular-support` |
| Write or fix C#/ASP.NET Core code | `@dotnet-implementor` |
| Review .NET diff | `@dotnet-reviewer` |
| Debug an API or startup exception | `@dotnet-support` |
| Write an EF Core migration or query | `@sql-implementor` |
| Review a migration or schema diff | `@sql-reviewer` |
| Debug a slow query or deadlock | `@sql-support` |
| Write or fix Bicep / GitHub Actions | `@infra-implementor` |
| Review infrastructure diff | `@infra-reviewer` |
| Debug a deployment or scaling issue | `@infra-support` |
| Turn a feature ask into a spec | `@fsp-analyst` |
| Design or assess architecture | `@fsp-architect` |
| Scout a codebase region cheaply | `@fsp-scout` |
| Run QA against acceptance criteria | `@fsp-qa` |

## Core Skills (loaded by agents automatically)

- `pilot-core:stack-detection` — identifies which stacks are present
- `pilot-core:project-instincts` — three-tier learning (instincts / corrections / discoveries)
- `pilot-core:session-handoff` — writes `.claude/handoff.md` at session end
- `pilot-core:quality-gate` — 7-phase build/test/security/migration gate
- `pilot-core:stack-health` — A–F graded health report (6 dimensions)
- `pilot-core:convention-learner` — captures codebase-specific conventions
- `pilot-core:mcp-discovery` — surfaces relevant MCP tools for the task

## Key Commands

| Command | Purpose |
|---------|---------|
| `/fsp-init` | Detect stacks, write `stack-profile.json`, scaffold baseline |
| `/fsp-bootstrap` | Scaffold governance baselines before feature work |
| `/fsp-audit` | Run security and governance audit |
| `/fsp-fix` | Apply remediation from audit findings |
| `/fsp-learn` | Capture conventions into `knowledge/conventions.md` |
| `/fsp-build` | Full 8-step build pipeline (analyst → architect → implement → QA) |
| `/fsp-architect` | Architecture assessment or planning only |
| `/fsp-verify` | 7-phase quality gate before PR |
| `/fsp-health` | A–F graded stack health report |
| `/fsp-checkpoint` | Save session state and write handoff note |

## Hard Rules (enforced by hooks in pilot-core)

1. **No hardcoded secrets** — blocked at write time by `secret-guard.js`
2. **No dangerous SQL/Azure patterns** — blocked by `dangerous-patterns.js`
3. **No `git push --force`** or `git reset --hard` — blocked by `bash-guard.js`
4. **No `new HttpClient()`**, `async void`, `DateTime.Now` — warned by `antipattern-guard.js`
5. **No Angular `[innerHTML]`** without DomSanitizer — blocked via `dangerous-patterns.json`
6. **Autonomous loops capped at 10 iterations** — agent must write `.claude/loop-stopped.md` and stop

## MCP-First Principle

Before reading source files for documentation or API surface questions, use:
1. `microsoft_docs_search` — quick structured lookup in official docs
2. `microsoft_code_sample_search` — official code examples
3. `microsoft_docs_fetch` — full page fetch when search is insufficient

## Pipeline Artifacts

Agents hand off via files under `.claude/pilot/` — never by pasting content into chat:

| Path | Written by |
|------|-----------|
| `.claude/pilot/stack-profile.json` | `@fsp-init` / stack-detection skill |
| `.claude/pilot/context/<scope>.md` | `@fsp-scout` |
| `.claude/pilot/specs/<feature>.md` | `@fsp-analyst` |
| `.claude/pilot/architecture/ASSESSMENT.md` | `@fsp-architect` |
| `.claude/pilot/builds/<feature>/PLAN.md` | `@fsp-architect` plan mode |
| `.claude/pilot/builds/<feature>/QA-REPORT.md` | `@fsp-qa` |
| `.claude/pilot/audit/findings.json` | `/fsp-audit` |
| `.claude/handoff.md` | `session-handoff` skill / `/fsp-checkpoint` |

## Knowledge Base

- `plugins/pilot-core/knowledge/stack-antipatterns.md` — multi-stack antipatterns (ANG-*, NET-*, SQL-*, AZR-*)
- `plugins/pilot-core/knowledge/stack-packages.md` — vetted packages for all stacks
- `plugins/pilot-core/knowledge/decisions/` — ADRs (ADR-001 through ADR-005)
- `.claude/pilot/knowledge/conventions.md` — project-specific conventions captured by `/fsp-learn`

## Install

```
/plugin marketplace add AgenticPawan/FullStack-Pilot
```

See `AGENTS.md` at the repo root for full routing logic, model assignments, and conflict resolution rules.
