# /pilot-learn — Session Knowledge Distillation

Distil durable, project-specific knowledge from the current session into versioned
knowledge files. The user reviews and commits. This command **never** runs git.

> **NON-NEGOTIABLE:** This command never commits knowledge files itself.
> Unreviewed self-written context is how AI systems poison their own memory.
> Every append must pass human eyes before it enters version control.

## Usage

```
/pilot-learn [--conventions] [--lessons] [--diff-only]
```

| Flag | Effect |
|------|--------|
| *(none)* | Run both `--conventions` and `--lessons` |
| `--conventions` | Run `convention-learner` skill only → update `conventions.md` |
| `--lessons` | Distil session lessons only → append to `lessons.md` |
| `--diff-only` | Show what would be written without writing any files |

## What this command does

### Phase A — Conventions (if `--conventions` or no flags)

Run the `convention-learner` skill. Constraints: ≤50 files, ≥3 evidence paths per
enforced convention. Writes `conventions.md` (full overwrite with revision history entry).

### Phase B — Lesson distillation (if `--lessons` or no flags)

Review the current session and the existing `lessons.md`. Extract durable insights that:

- Will save time in future sessions in this repository
- Are specific to this project (not general best practices)
- Are not already in `CLAUDE.md`, `conventions.md`, or existing `lessons.md` entries
- Will still be true in six months

**Candidate lesson types:**

| Type | Example |
|------|---------|
| Build requirement | "Run `dotnet restore --locked-mode` before build — lock file is checked in" |
| Routing rule | "Tenant filter lives in `AppDbContext.OnModelCreating` — do not reimplement in repositories" |
| Known gotcha | "The `FullStack.Domain` project must never reference `FullStack.Api` — circular dep check is in CI" |
| Dependency constraint | "`IHttpClientFactory` is the only approved way to create `HttpClient` — direct `new HttpClient()` is blocked by the dangerous-patterns hook" |
| Local invariant | "All `DateTime` values stored in UTC; the UI converts to local — do not apply `.ToLocalTime()` server-side" |

**Lessons that are NOT durable (discard):**

- Current branch, current task, in-progress feature state
- "I found X in file Y" — put it in code comments, not lessons
- General design patterns (belong in CLAUDE.md architecture section or rules catalog)
- Anything derivable from reading the code directly in future

### Phase C — CLAUDE.md proposals

Compare session findings against `PROJECT_ROOT/CLAUDE.md`. If any factual updates are
warranted (e.g., a new package was added, architecture style was clarified, a new
compliance requirement was mentioned), propose a minimal diff.

## Output format

### Lessons append (Phase B)

Show the exact lines that would be appended to `lessons.md`:

```
## Proposed append to .claude/pilot/knowledge/lessons.md

+ ---
+ ## <date> — Session lessons
+
+ ### Build
+ - Run `dotnet restore --locked-mode` before `dotnet build`. The NuGet lock file
+   is checked in (`packages.lock.json`). Direct restore without `--locked-mode`
+   will fail in CI if lock file drifts.
+   _Evidence: CI failure observed 2026-07-04; lock file at src/FullStack.Api/packages.lock.json_
+
+ ### Routing
+ - Tenant filter is enforced by `AppDbContext.OnModelCreating` HasQueryFilter on
+   Order and User entities. Do not add WHERE TenantId filters in repositories —
+   they are redundant and create drift risk.
+   _Evidence: src/FullStack.Api/Data/AppDbContext.cs, sql-multitenancy MT-001_
```

Then **write** the appended content to `lessons.md` (do not overwrite existing entries —
use `>>` semantics: existing content is preserved, new section is added at the end).

### CLAUDE.md diff (Phase C)

Show as a unified diff block:

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -12,6 +12,7 @@ ...
  ## Architecture
  - Style: Clean Architecture
+ - NuGet lock file enforced (packages.lock.json checked in)
```

**Do not write the CLAUDE.md diff.** Show it only. The user applies it manually.

### Final output

```
## /pilot-learn complete

Conventions  → .claude/pilot/knowledge/conventions.md  (run --conventions to refresh)
Lessons      → .claude/pilot/knowledge/lessons.md       (<N> new entries appended)
CLAUDE.md    → diff shown above (NOT written — apply manually with your editor)

Review the appended lessons, then:
  git add .claude/pilot/knowledge/lessons.md
  git commit -m "docs(knowledge): append session lessons <date>"

This command did not run any git commands.
```

## Execution

Run Phase A via the `convention-learner` skill (if `--conventions` or no flags).

For Phase B: read `.claude/pilot/knowledge/lessons.md` (or note it does not exist). Review
the current session context for durable insights not already captured. Apply the
lesson-quality filters above. Write the appended block. Show the final `lessons.md` diff.

For Phase C: read `PROJECT_ROOT/CLAUDE.md`. Identify factual gaps or corrections from
this session. Show the proposed unified diff — write nothing.

Constraints:
- Never call `git add`, `git commit`, `git push`, or any git write command.
- Append-only for `lessons.md` — never modify or delete existing entries.
- CLAUDE.md changes are shown as diff only — never written by this command.
- If `--diff-only` is set, skip all writes; show only what would change.
