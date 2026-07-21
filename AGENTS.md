# Agent Routing & Orchestration — FullStack Pilot

> This file defines how Claude Code routes queries to specialist agents across the
> Angular / .NET / SQL Server / Azure stack and how agents coordinate with each other.

---

## Agent Roster

### Stack Specialists (one trio per plugin)

| Agent | Domain | Plugin |
|-------|--------|--------|
| `@angular-reviewer` | Angular / TypeScript review (read-only) | pilot-angular |
| `@angular-implementor` | Angular / TypeScript fixes and features | pilot-angular |
| `@angular-support` | Angular symptom triage | pilot-angular |
| `@dotnet-reviewer` | C# / ASP.NET Core review (read-only) | pilot-dotnet |
| `@dotnet-implementor` | C# / ASP.NET Core fixes and features | pilot-dotnet |
| `@dotnet-support` | .NET symptom triage | pilot-dotnet |
| `@sql-reviewer` | EF Core / SQL Server review (read-only) | pilot-sql |
| `@sql-implementor` | EF Core / SQL Server fixes and schema changes | pilot-sql |
| `@sql-support` | Database symptom triage | pilot-sql |
| `@infra-reviewer` | Azure / Bicep / CI-CD review (read-only) | pilot-azure |
| `@infra-implementor` | Azure / Bicep / CI-CD fixes | pilot-azure |
| `@infra-support` | Infrastructure symptom triage | pilot-azure |

### Pipeline Agents (pilot-core)

| Agent | Role | Model |
|-------|------|-------|
| `@fsp-analyst` | Business analyst — spec writer | sonnet |
| `@fsp-scout` | Codebase explorer — context briefs | haiku |
| `@fsp-architect` | Solution architect — assessment and planning | opus |
| `@fsp-qa` | QA engineer — test generation and traceability | sonnet |
| `@fullstack-reviewer` | Cross-stack diff review orchestrator | sonnet |
| `@fullstack-implementor` | Cross-stack fix orchestrator | inherits |
| `@fullstack-support` | Production incident triage | sonnet |

### Persona Agents (pilot-core)

Optimised for a specific enterprise role. Each has different permissions and output formats.

| Agent | Persona | Model | Write Scope |
|-------|---------|-------|-------------|
| `@fsp-feature-builder` | Fullstack Developer | inherits (sonnet/opus per complexity) | All layers — scaffold + implement a full vertical slice |
| `@fsp-incident-responder` | Production Support Engineer | sonnet | `.claude/pilot/` + one local fix branch only. **Never deploys or pushes.** |
| `@fsp-tpo-intake` | Technical Product Owner | sonnet | `.claude/specs/` and `.claude/pilot/specs/` only. Never writes code. |

---

## Routing Table

Match user intent to the first agent that fits. When multiple match, the first row wins.

### Feature & Architecture Requests

| User Intent Pattern | Primary Agent | Support Agents |
|---|---|---|
| "what should we build", "spec this feature", "requirements" | `@fsp-analyst` | — |
| "write a spec", "acceptance criteria", "user story", "TPO", "product owner" | `@fsp-tpo-intake` | `@fsp-analyst` (if formal pipeline spec needed) |
| "plan this", "architecture for", "how should we structure" | `@fsp-architect` | `@fsp-analyst` |
| "build feature", "scaffold feature", "new feature", "vertical slice" | `@fsp-feature-builder` | stack specialists |
| "scaffold", "generate the feature end-to-end", "implement the plan" | `@fullstack-implementor` | stack specialists |
| "build pipeline", "/fsp-build" | pipeline (`/fsp-build`) | all specialists |

### Review Requests

| User Intent Pattern | Primary Agent | Notes |
|---|---|---|
| "review this PR", "review all changed files", touches >1 layer | `@fullstack-reviewer` | delegates to per-layer specialists |
| "review this Angular component / service / module" | `@angular-reviewer` | — |
| "review this C# / ASP.NET Core / EF Core code" | `@dotnet-reviewer` | — |
| "review this migration / SQL query / schema" | `@sql-reviewer` | — |
| "review this Bicep / GitHub Actions / AKS config" | `@infra-reviewer` | — |

### Fix Requests (after a review finding)

| User Intent Pattern | Primary Agent |
|---|---|
| Fix spans >1 layer or involves cross-layer contract drift | `@fullstack-implementor` |
| Fix is Angular-only | `@angular-implementor` |
| Fix is .NET-only | `@dotnet-implementor` |
| Fix is SQL / EF Core-only | `@sql-implementor` |
| Fix is Azure / Bicep / CI-only | `@infra-implementor` |

### Production Support / Incidents

| Symptom | Route to |
|---|---|
| Engineer has error artifacts (paste, stack trace, alert) and needs root cause + fix branch | `@fsp-incident-responder` (persona-specific, full workflow) |
| No layer identified yet, or "the app is broken" | `@fullstack-support` (triage first) |
| Browser console error, NG0xxx, blank UI, wrong render | `@angular-support` |
| HTTP 4xx/5xx, exception stack trace, API wrong response | `@dotnet-support` |
| Slow query, deadlock, failed migration, missing rows | `@sql-support` |
| Deployment failure, unreachable resource, RBAC/Key Vault denial | `@infra-support` |

> **`@fsp-incident-responder` vs `@fullstack-support`:** Use `@fsp-incident-responder` when the
> engineer is in active incident response mode and needs a root-cause analysis, a proposed fix
> branch, a rollback plan, and a shift-handoff note in a single workflow. Use `@fullstack-support`
> for quick layer-classification triage when you already know it will route to a single specialist.

### Meta Workflows

| Intent | Command / Agent |
|---|---|
| "detect conventions", "what does this project do" | `/fsp-learn` (convention-learner + fsp-scout) |
| "audit the codebase", "find vulnerabilities" | `/fsp-audit` |
| "fix all findings", "batch remediate" | `/fsp-fix` |
| "health report", "how is the project" | `/fsp-health` |
| "verify before PR", "final checks" | `/fsp-verify` |
| "save progress", "checkpoint", "done for today" | `/fsp-checkpoint` |
| "show instincts", "what patterns have you learned" | session — trigger phrase |

---

## Cross-Agent Coordination

### When to Use Subagents

**Use subagents for:**
- Parallel research across multiple layers (e.g., scouting Angular and .NET simultaneously)
- Protecting the main context window from large file reads (`@fsp-scout` for briefs)
- Independent tasks that do not need prior-step output (e.g., lint + migration check in parallel)

**Do not use subagents for:**
- Single-step lookups where a direct tool call (Grep, Glob, Read) suffices
- Tasks under 3 tool calls — the spawn overhead is not worth it

### Subagent Pattern — Cross-Layer Feature

```
@fullstack-implementor receives work item
  → spawns @fsp-scout for each layer (parallel)
  → reads context briefs from .claude/pilot/context/
  → delegates SQL changes to @sql-implementor
  → delegates .NET changes to @dotnet-implementor
  → delegates Angular changes to @angular-implementor
  → handles cross-layer glue (API client regeneration, contract alignment) directly
  → runs /fsp-verify before declaring done
```

### Handoff Format

When routing to a specialist, always include:
```
## Handoff → @<agent>
Layer:    <angular | dotnet | sql | azure>
Finding:  <rule-id or description>
File:     <path:line>
Context:  <1-2 sentences of why>
Ruled out: <other layers / agents considered>
```

---

## MCP-First Principle

All agents must prefer MCP tool reads over direct file reads to reduce token consumption.

| Task | Use MCP First | Instead Of |
|---|---|---|
| Search documentation, Microsoft docs | `microsoft_docs_search` | Glob + Read across docs/ |
| Code samples for a pattern | `microsoft_code_sample_search` | Grep across .cs / .ts files |
| Detailed reference for a specific page | `microsoft_docs_fetch` | — |

When no MCP tool covers the need, fall back to: Grep → Glob → Read (smallest scope first).

---

## Skill Load Order

Agents load skills in dependency order before starting work. Never start implementation without checking whether a relevant skill exists in the plugin manifest.

### Default Order for Implementors

1. `stack-detection` — understand what stacks are active (skip if stack-profile.json is current)
2. Domain skill(s) — e.g. `angular-signals-and-state`, `dotnet-cqrs`, `sql-schema-design`
3. `api-design-standards` — if the work touches a REST API boundary
4. `architecture-decision-records` — if the work might override a prior decision

### Default Order for Reviewers / Support

1. Domain skill(s) — all relevant to the files under review
2. `audit-orchestration` — if the review scope includes security findings

---

## Autonomous Loop Caps

When running any fix or build loop autonomously:

- **Hard cap: 10 iterations per loop.** Stop at 10 regardless of remaining errors. Report what was fixed, what remains, and the next recommended action.
- Never force-push, never reset --hard, never drop migrations — even inside a loop.
- Every loop iteration that modifies files must end with a `git status` check.
- If a loop hits the cap, write a `.claude/loop-stopped.md` with the iteration count and remaining issues before exiting.

---

## Hard Rules

These apply to every agent without exception:

1. **No changes to live environments.** Agents produce branch changes and stop. Deploy only after human review.
2. **No force-push ever.** `git push --force` and `git push -f` are blocked by the bash-guard hook. Do not attempt to bypass it.
3. **No DROP TABLE, DELETE without WHERE, or destructive migrations in non-feature branches.** The dangerous-patterns hook blocks them. Investigation only — no silent fixes.
4. **Never silently return a degraded result** when a read budget is insufficient. Stop, state what more is needed, and wait.
5. **Reviewer and support agents never modify files.** `disallowedTools: Write, Edit` is enforced in their manifests and by CI.
6. **Pipeline artifacts are files, not chat.** Specs, plans, scout briefs, and QA reports are written to `.claude/pilot/` and handed off by path.

---

## Persona Agent Priority

When multiple agents could match an intent, resolve as follows:

| Priority | Rule |
|----------|------|
| 1 | `@fsp-incident-responder` wins for any P0/P1 incident or active outage — do not route to specialists first |
| 2 | `@fsp-tpo-intake` wins for "spec this", "acceptance criteria", "user story" before any feature build starts |
| 3 | `@fsp-feature-builder` wins for "build feature", "scaffold", "new feature" once a spec exists |
| 4 | Cross-stack pipeline agents (`@fullstack-reviewer`, `@fullstack-implementor`) handle layer-agnostic work |
| 5 | Stack-specialist trios handle within-layer work |

### Escalation Paths

| Agent | Boundary hit | Escalation |
|-------|-------------|------------|
| `@fsp-feature-builder` | Build fails after 10 tries | Writes SUMMARY.md → engineer decides; route failing test to `@dotnet-support` or `@angular-support` |
| `@fsp-incident-responder` | Deployment action required | Outputs `BOUNDARY VIOLATION`, writes handoff → human with access executes |
| `@fsp-tpo-intake` | Clarification loop > 10 turns | Escalates to `@fsp-analyst` for formal pipeline spec |

### Skill Load Order Additions (Persona Agents)

- `@fsp-feature-builder`: stack-detection → api-design-standards → domain skills → **cross-stack-review last**
- `@fsp-incident-responder`: **incident-correlation first** → incident-response-runbook → session-handoff → domain skills
- `@fsp-tpo-intake`: no skills at start; spec-validation only when PR/diff is provided

---

## Conflict Resolution

1. **Architecture questions win over implementation** — "How should we structure the payment module?" → `@fsp-architect`, not `@dotnet-implementor`
2. **Specific beats general** — "Optimize this EF query" → `@sql-support`, not `@fullstack-support`
3. **Security concerns are always surfaced** — even when another agent is primary, flag security findings for the appropriate reviewer
4. **Triage before fix** — for production symptoms, `@fullstack-support` classifies the layer before any implementor is engaged
5. **Persona beats general** — when the user identifies themselves as a Developer, Support Engineer, or TPO, route to the persona agent, not the pipeline agent
