---
user-invocable: false
name: batched-remediation
description: Batched remediation pipeline. Reads audit findings.json, filters one severity tier (--batch P0-P3), groups by root cause, validates --max-files (default 10), creates branch pilot/fix-<tier>-<n>, applies fixes, verifies with build/tests, rolls back on failure. Updates finding statuses and writes a PR-ready description. Hard rules: never mix tiers; never exceed --max-files; API-surface changes need explicit human sign-off first.
when_to_use: Invoke via /fsp-fix. Use when the user asks to fix, remediate, or patch findings from a prior audit. Requires findings.json produced by /fsp-audit.
disable-model-invocation: true
---

<!-- HARD RULES — enforce at every step, no exceptions -->
<!-- RULE 1: Never mix severity tiers in one branch/PR -->
<!-- RULE 2: Never exceed --max-files across all groups in the batch -->
<!-- RULE 3: Build or test failure → rollback branch completely, never force-complete -->
<!-- RULE 4: API surface change (adding [Authorize], changing endpoint signature, removing endpoint) → STOP and ask for human sign-off before writing any code -->
<!-- RULE 5: No mega-PRs. If batch exceeds --max-files after grouping, split into sub-batches and ask which to run first -->

See `fix-strategies.md` (same directory) for per-CWE fix recipes.

---

## Step 0 — Parse arguments and load state

**Arguments** (extracted from the user's invocation):
- `--batch <tier>`: required. One of `P0`, `P1`, `P2`, `P3`.
- `--max-files <n>`: optional, default `10`. Maximum distinct files modified across the whole batch.

Read `PROJECT_ROOT/.claude/pilot/audit/findings.json`. If absent, tell the user to run `/fsp-audit` first and stop.

Record `startBranch` (current git branch: `git rev-parse --abbrev-ref HEAD`).

---

## Step 1 — Filter findings

Select findings where:
- `severity == <tier>` (exact match — **never mix tiers**)
- `status` is absent, `null`, or `"open"`
- `batchable == true`

If no findings match: report "No open batchable <tier> findings — nothing to do." and stop.

List excluded findings separately (status already set, batchable: false, different severity).

---

## Step 2 — Group by root cause

Collapse the filtered list into **root-cause groups** before counting files:

| Root cause | Grouping rule |
|------------|---------------|
| Package vulnerability | All findings citing the same `<Package>@<version>` → one group, one `.csproj` edit |
| Same CWE, same file | Multiple findings in the same file with the same CWE → one group (fix together) |
| IDOR (CWE-639) | Each endpoint is its own group — cross-endpoint IDOR fixes are not atomic |
| Missing auth (CWE-862) | Controller-level vs method-level are separate groups |
| All others | One group per finding |

Assign each group a `groupId` (e.g., `G01`, `G02`). Record the finding IDs each group covers.

---

## Step 3 — Batch validation

Count **distinct files** that would be modified across all groups.

**If count > --max-files:**
- Print a table of groups vs files
- Suggest the first N groups that fit within `--max-files` as sub-batch 1
- Ask the user: "This batch touches <M> files, exceeding --max-files=<n>. Run sub-batch 1 (<groups>)? Or adjust --max-files?"
- **Stop and wait.** Do not proceed until the user responds.

**If count ≤ --max-files:** proceed.

**API surface check** — before writing any code, scan each group's proposed fix:
- Does the fix add `[Authorize]`/`[RequireAuthorization]` to a previously public endpoint?
- Does the fix remove or rename a public endpoint or DTO field?
- Does the fix change a public method signature in a shared library?

If YES for any group: print a **breaking-change warning** for each affected group listing the endpoint/type and the callers that would break. Ask: "These fixes change the public API surface. Confirm you want to proceed with each group (Y/N per group)." Stop and wait. Do not write any code until the user responds for every flagged group. Mark any group where the user says N as `status: "deferred"` with `deferReason: "API surface change — human sign-off declined"`.

---

## Step 4 — Capture baseline build status

Before touching any files, run a build to establish baseline:

```
dotnet build <solution-or-project> --no-restore -warnaserror:false 2>&1
```

Record `baselineBuildPassed: true/false`. If baseline build is already failing, note it — this does **not** block remediation, but the rollback trigger in Step 7 changes: roll back only if post-fix build introduces *new* errors not present at baseline.

For Angular projects, run `npx tsc --noEmit` if `angular` is non-null in the stack profile. Record `baselineTscPassed: true/false`.

---

## Step 5 — Create remediation branch

Determine the branch suffix: count existing `pilot/fix-<tier>-*` branches and increment.

```
git checkout -b pilot/fix-<tier>-<n>
```

If this command fails (e.g., uncommitted changes on current branch), report the error and stop. Do not stash without asking.

---

## Step 6 — Apply fixes

For each group, in order:

1. Read the current file(s).
2. Apply the fix using the recipe from `fix-strategies.md` for the group's CWE.
3. Write the file back using the Edit tool (prefer targeted edits over full rewrites).
4. Note the edit: `{ groupId, findingIds, file, linesChanged, fixSummary }`.

**Fix application constraints:**
- Edit only lines cited in the finding plus the minimum surrounding context needed for the fix.
- Do not reformat unrelated code (whitespace, style) — keep the diff reviewable.
- Do not add comments explaining the fix unless the fix itself would be non-obvious to a reviewer.
- If a fix requires a new dependency or import, add only what is needed and no more.

After all groups are applied, run `git diff --stat HEAD` and record `filesModified` and `linesChanged`.

---

## Step 7 — Verify: build + test

### Build verification

```
dotnet build <solution-or-project> --no-restore -warnaserror:false 2>&1
```

**Rollback trigger:** post-fix build has errors that were not present at baseline → trigger rollback (Step 8).

For Angular: `npx tsc --noEmit`. Rollback trigger: new TS errors not present at baseline.

### Test verification

Identify affected test projects: any test project in `dotnet.projects` that references the modified source projects.

**If `dotnet-test` plugin skill is installed** (check with `dotnet skills list 2>/dev/null | grep dotnet-test`):
```
/run dotnet-test --project <affectedTestProject>
```

**Otherwise:**
```
dotnet test <affectedTestProject> --no-build --logger "console;verbosity=normal" 2>&1
```

**Rollback trigger:** any test that was passing at baseline now fails → trigger rollback (Step 8).

If no test projects exist: note "no test projects found — build-only verification" and continue.

---

## Step 8 — Rollback protocol

Triggered when build or tests introduce new failures (not present at baseline).

```
git checkout <startBranch>
git branch -D pilot/fix-<tier>-<n>
```

After rollback, print:

```
## Rollback: pilot/fix-<tier>-<n>

Build/test verification failed — branch deleted, no files changed.

Failure: <error summary>
Baseline status: build=<pass/fail>, tests=<pass/fail/skipped>
Post-fix status: build=<pass/fail>, tests=<pass/fail>

Groups that were applied before failure:
  <groupId>: <files edited>

Recommended action: <targeted advice per failure type>
```

Do not update findings.json statuses. Stop.

---

## Step 9 — Update findings.json

For each finding covered by a group that was successfully fixed, update its entry in findings.json:

```json
{
  "status": "fixed",
  "fixedIn": "pilot/fix-<tier>-<n>",
  "fixSummary": "<one-line description of what was changed>"
}
```

For any finding that was excluded from the batch (deferred or wontfix):

```json
{
  "status": "deferred",
  "deferReason": "<reason>"
}
```

Write the updated findings.json back to `PROJECT_ROOT/.claude/pilot/audit/findings.json`.

---

## Step 10 — Generate PR description

Write to `PROJECT_ROOT/.claude/pilot/audit/PR-<tier>-<n>.md`:

```markdown
## Security: fix <tier> findings (<date>)

**Branch:** pilot/fix-<tier>-<n>  
**Findings fixed:** <count> of <total open>  
**Files changed:** <M>  
**Build:** pass · **Tests:** pass (<N> tests, <P> passed)

### Changes

| ID | Title | File | Fix |
|----|-------|------|-----|
| VULN-NNN | <title> | <file>:<line> | <one-line fix description> |

### Verification

For each finding: how to confirm it is resolved (e.g., "run the search endpoint with `name=' OR 1=1--` and confirm 400 Bad Request").

### Breaking changes

<List any API surface changes, or "None.">

### Deferred / out of scope

<List any findings excluded with reason, or "None.">
```

---

## Step 11 — Final output

Print in chat:

```
## pilot/fix-<tier>-<n> — ready for review

Branch:      pilot/fix-<tier>-<n>
Files:       <M> changed, <L> insertions, <D> deletions
Build:       pass
Tests:       <N> passed, 0 failed

Fixed findings:
  VULN-NNN  <title>  (<file>:<line>)
  ...

PR description → .claude/pilot/audit/PR-<tier>-<n>.md

Run /fsp-audit to verify the updated P<tier> count.
```

Print the `git diff --stat HEAD` output so the user can review the scope without opening files.
