---
description: Apply /fsp-audit findings for one severity tier on a safe, reviewable git branch.
argument-hint: "--batch <P0|P1|P2|P3> [--max-files <n>]"
---

# /fsp-fix — Batched Security Remediation

Apply fixes for findings produced by `/fsp-audit`. Creates a reviewable git branch
per severity tier, verifies with build + tests, and rolls back automatically if
verification fails.

## Usage

```
/fsp-fix --batch <tier> [--max-files <n>]
```

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--batch` | yes | — | Severity tier to fix: `P0`, `P1`, `P2`, or `P3` |
| `--max-files` | no | `10` | Abort if batch would touch more distinct files than this |

**Examples:**

```
/fsp-fix --batch P0
/fsp-fix --batch P1 --max-files 5
/fsp-fix --batch P0 --max-files 20
```

## Prerequisites

- `.claude/pilot/audit/findings.json` must exist. Run `/fsp-audit` first if absent.
- Working tree must be clean (no uncommitted changes) before the branch is created.
- `dotnet` CLI must be available for .NET projects; `node`/`npm` for Angular projects.

## What this command does

1. **Filter** — selects open, batchable findings matching the requested tier exactly (never mixes tiers).
2. **Group by root cause** — collapses findings that share the same fix into one edit (e.g., 30 findings referencing the same vulnerable package → one `.csproj` line change).
3. **Validate batch size** — counts distinct files across all groups. If it exceeds `--max-files`, presents sub-batches and asks which to run. Does not proceed until the user chooses.
4. **API surface gate** — if any fix adds `[Authorize]`, removes an endpoint, or changes a public method signature, stops and requires explicit human sign-off per group before writing any code.
5. **Baseline capture** — runs `dotnet build` (and `tsc --noEmit` for Angular) before touching files so rollback can distinguish pre-existing failures from regressions.
6. **Create branch** — `git checkout -b pilot/fix-<tier>-<n>`.
7. **Apply fixes** — targeted edits per group using recipes from `fix-strategies.md`.
8. **Verify** — build + affected tests. Routes test execution through the `dotnet-test` plugin skill when installed; falls back to `dotnet test` directly.
9. **Rollback on failure** — if build or tests introduce regressions, the branch is deleted and `startBranch` is restored. Partial changes are never left in the tree.
10. **Update findings.json** — marks fixed findings `status: "fixed"` with branch name; deferred/declined findings get `status: "deferred"` with reason.
11. **PR description** — writes `.claude/pilot/audit/PR-<tier>-<n>.md` with finding table, verification steps, and breaking-change notes.

## Hard rules

| Rule | What happens if violated |
|------|--------------------------|
| No mixed severity tiers | Command refuses; tells user to run separate `/fsp-fix --batch` per tier |
| `--max-files` exceeded | Presents sub-batches; waits for user to pick one |
| Build/test regression | Branch deleted, rollback to `startBranch`, failure report printed |
| API surface change | Full stop before any code written; sign-off required per group |
| No mega-PRs | `--max-files` default of 10 enforces this; lower it for sensitive areas |

## Branch naming

`pilot/fix-P0-1`, `pilot/fix-P0-2`, … — sequential per tier.

## Output

On success:
- Branch `pilot/fix-<tier>-<n>` ready for PR
- `.claude/pilot/audit/findings.json` — statuses updated
- `.claude/pilot/audit/PR-<tier>-<n>.md` — PR description
- `git diff --stat HEAD` printed in chat

On failure:
- Branch deleted, working tree unchanged
- Failure summary with baseline vs post-fix build/test status

## Execution

Run the `batched-remediation` skill now, following every step in order (Step 0 through Step 11).

- Extract `--batch` and `--max-files` from the user's invocation.
- `PROJECT_ROOT` is the current working directory of the user's project.
- Read fix recipes from `fix-strategies.md` in the same directory as `batched-remediation/SKILL.md`.
- Never recurse into `node_modules/`, `bin/`, `obj/`, `dist/`, `.git/`.
