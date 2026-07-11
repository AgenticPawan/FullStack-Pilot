---
user-invocable: false
name: foundation-bootstrap
description: The /fsp-bootstrap pipeline engine. Detects which baseline modules (authentication, authorization, logging, error handling, health checks, CORS, and stack-appropriate recommended modules) already exist in a project, scaffolds the missing required ones via the stack implementors on a dedicated branch, and writes .claude/pilot/foundation/STATUS.md — the marker fsp-build-orchestration checks before allowing feature work on a greenfield project.
when_to_use: Invoke via /fsp-bootstrap only. Runs when the user asks to scaffold baseline/default modules for a new project, or when fsp-build-orchestration's Step 0 foundation check tells the user to run it.
---

<!-- HARD RULES -->
<!-- RULE 1: Required modules are a fixed, opinionated list (below) — do not let the user
     talk you into silently dropping one; if they don't want a module, that's a Step 2
     gate decision recorded in STATUS.md as "skipped-by-user-choice", never a silent omission. -->
<!-- RULE 2: File handoffs only, same as fsp-build-orchestration. -->
<!-- RULE 3: Never invent detection heuristics beyond what's listed — if a module's presence
     genuinely can't be determined from the checks below, ask the user rather than guessing. -->

## Module checklist

| Module | Tier | Applies when | Governing standard(s) | Detection heuristic |
|---|---|---|---|---|
| Secrets/config management | Required | always | `always-no-hardcoded-secrets` (hook-enforced already) | Already covered by the `secret-guard` hook — never a work item here, just confirm the hook is active |
| Logging | Required | dotnet present | `dotnet-logging` LOG-*, `always-structured-logging` | `Program.cs` wires a durable sink (Serilog/OpenTelemetry) beyond bare `Console` |
| Error handling | Required | dotnet present (+ angular if present) | `dotnet-error-handling` ERR-*, `angular-error-handling` | `Program.cs` registers `IExceptionHandler`/`UseExceptionHandler`; Angular has a global `ErrorHandler` provider |
| Authentication | Required | dotnet present | `dotnet-authentication` AUTH-* | `Program.cs` calls `AddAuthentication(...).AddJwtBearer(...)` or `AddOpenIdConnect(...)` |
| Authorization (permissions-only) | Required | dotnet present | `dotnet-authorization` AZ-* | `Program.cs` calls `AddAuthorization` with a policy-based (not role-based) scheme |
| Health checks | Required | dotnet present | `dotnet-health-checks` HC-* | `Program.cs` calls `AddHealthChecks()`/`MapHealthChecks()` for both liveness and readiness |
| CORS | Required | dotnet present AND angular present | `dotnet-cors` COR-* | `Program.cs` calls `AddCors` with a named, config-sourced policy |
| Rate limiting | Recommended | dotnet present | `dotnet-rate-limiting` RL-* | `Program.cs` calls `AddRateLimiter` |
| Startup validation | Recommended | dotnet present | `dotnet-startup-validation` SV-* | Options bound with `.ValidateOnStart()` |
| Security headers | Recommended | dotnet present | `dotnet-security-headers` SECH-* | HSTS/`X-Content-Type-Options` middleware present |
| Observability | Recommended | dotnet present | `dotnet-observability` OBS-* | OpenTelemetry tracing/metrics wired |
| CI/CD pipeline skeleton | Recommended | azure present | `azure-cicd-security`, `git-workflow-governance` | `.github/workflows/*.yml` exists with OIDC deploy auth |
| DB migration baseline | Recommended | sql present | `sql-schema-design` | An initial EF Core migration exists with naming-convention-compliant tables |

Required modules gate `/fsp-build` on a greenfield project (see `fsp-build-orchestration`
Step 0). Recommended modules are reported but never block anything.

## Read budget (STRICT): detection only, max 15 files

- Detection is a handful of targeted greps/reads per module (`Program.cs`, `app.config.ts`,
  workflow files) — never a full codebase read. If a scout brief already exists for the
  relevant scope, read it first instead of re-deriving file locations.
- Budgets bound exploration, not quality: if a module's presence genuinely can't be
  determined within budget, mark it "unknown — needs manual confirmation" rather than
  guessing either way.

## Step 0 — Parse arguments and load state

- `--yes`: skip the soft confirmation gate (Step 2); never skips the per-module hard gates
  the stack implementors themselves enforce (auth-policy changes, etc. — same as `/fsp-build`).
- Read `.claude/pilot/stack-profile.json` — stop if absent: "run /fsp-init first".
- If `.claude/pilot/foundation/STATUS.md` exists and every Required module is `done` or
  `skipped-by-user-choice`, print its contents and stop — nothing to do.
- `git status --porcelain` must be clean, else stop and ask (never stash silently).

## Step 1 — Detect current status

For each module in the checklist whose "Applies when" condition is met by the stack
profile, run its detection heuristic. Build the status table:

```
## Foundation module status

| Module | Tier | Status | Evidence |
|---|---|---|---|
<one row per applicable module: Present (file:line) | Missing | Unknown>
```

## Step 2 — Gate (user)

Print the status table. If every Required module is Present, write STATUS.md now (Step 4
format) and stop — report "already bootstrapped."

Otherwise list the missing Required modules and any missing Recommended ones separately.
Ask: "Scaffold the missing Required modules now? (YES / SKIP <module> to accept the gap
knowingly / describe changes)". A `SKIP` records that module as `skipped-by-user-choice` in
STATUS.md with the user's stated reason — never silently dropped. Proceed on `--yes` only
for modules with no `SKIP` request.

## Step 3 — Implement (stack implementors)

Create the branch: `git checkout -b pilot/foundation-bootstrap` (skip if already on it, e.g.
resuming).

For each confirmed missing Required module, in this order — secrets/config (usually already
satisfied) → logging → error handling → CORS → authentication → authorization → health
checks:
1. Invoke the owning `@<stack>-implementor` with a fixed work-item description: the module
   name, its governing standard IDs, and "implement it compliant with the pilot-<stack>
   inventory from the start" (this is the implementor's existing "feature request" input
   mode — no new capability required of it).
2. Run the module's own build verification (`dotnet build` / `npx tsc --noEmit`).
3. Commit the verified module (`feat(foundation): scaffold <module>`).
4. Record `done` in the in-memory status; a failure marks it `failed` and stops the
   pipeline (same failure discipline as `fsp-build-orchestration` RULE 7) — a half-scaffolded
   auth module is worse than none.

## Step 4 — Review (paired stack reviewers)

For each stack touched, invoke its `@<stack>-reviewer` scoped to the diff only
(`git diff <startBranch>...HEAD` for that stack's files). Route findings back to the same
implementor for one fix round; re-verify; commit. This mirrors `fsp-build-orchestration`
Step 6 but without the 2-loop escalation machinery — foundation modules are small, known
shapes, not novel feature work.

## Step 5 — Report

Write `.claude/pilot/foundation/STATUS.md`:

```
# Foundation bootstrap status
Date: <iso> | Branch: pilot/foundation-bootstrap (NOT merged)

| Module | Tier | Status | Standard(s) | Notes |
|---|---|---|---|---|
<one row per module in the checklist: done | skipped-by-user-choice (+ reason) | not-applicable>
```

Print in chat: the branch name, the status table, and:

```
Next steps:
  git diff <startBranch>...pilot/foundation-bootstrap   # review
  <merge per the project's git workflow>
  Then run /fsp-build for feature work — the foundation gate will now pass.
```

The branch is left unmerged — merging is the user's decision, same as `/fsp-build`.
