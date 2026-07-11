---
user-invocable: false
name: fsp-build-orchestration
description: The /fsp-build pipeline engine. Orchestrates spec (fsp-analyst) → scout briefs (fsp-scout) → plan (fsp-architect) → gated implement (stack implementors, opus only for complexity-high items) → diff-scoped review loops (max 2) → QA with deterministic test-path diff enforcement → summary. File handoffs only; STATE.json checkpoint after every step enables --resume; hard safety gates are never waived by --yes.
when_to_use: Invoke via /fsp-build only. Runs when the user asks to build a feature, module, or ASSESSMENT gap end to end, or to resume a stopped build pipeline.
---

<!-- HARD RULES — enforce at every step, no exceptions -->
<!-- RULE 1: File handoffs only. Agents receive artifact PATHS, never pasted content. -->
<!-- RULE 2: Update STATE.json after every completed step, before starting the next. -->
<!-- RULE 3: Hard safety gates ([Authorize]/policy change, public API contract change,
     destructive migration, resource deletion / RBAC / network loosening) STOP the
     pipeline for explicit user sign-off — --yes never waives them. -->
<!-- RULE 4: Model override goes opus ONLY for work items the plan marks complexity: high. -->
<!-- RULE 5: Review loop cap is 2 per work item. Loop 3 = escalate to the user with
     BOTH the reviewer's finding and the implementor's position. -->
<!-- RULE 6: QA step working-tree changes (git status --porcelain — a plain diff
     misses untracked new files) are verified against the test-path allowlist;
     product-code changes from QA are reverted, logged, and routed back as defects. -->
<!-- RULE 7: A failed step stops the pipeline with STATE.json written — never
     force-continue past a failure, never silently retry more than once. -->

## Step 0 — Parse arguments and load state

Extract from the invocation:
- the build target: free-text feature | path to an existing spec | `GAP-<n>` id | `--resume <feature-slug>`
- `--yes` (skip the soft plan gate), `--max-files <n>` (default 25)

**Resolve the target:**
- Free text → feature-slug = kebab-case short name; Step 1 runs.
- Spec path → verify it exists; feature-slug from its filename; Step 1 is skipped.
- `GAP-<n>` → read `.claude/pilot/architecture/ASSESSMENT.md`, extract that gap's
  enhancement plan as the feature ask; if the id is absent, list available ids and stop.
- `--resume <slug>` → read `builds/<slug>/STATE.json`, print which steps are complete,
  and continue from the first incomplete step. Never redo a step marked `done`.

**Preconditions (fresh runs):**
- `.claude/pilot/stack-profile.json` exists, else stop: "run /fsp-init first".
- `git status --porcelain` is clean, else stop and ask (never stash silently).
- Record `startBranch` (`git rev-parse --abbrev-ref HEAD`).

Create `.claude/pilot/builds/<feature-slug>/` and initialize `STATE.json`:

```json
{
  "feature": "<slug>", "target": "<raw invocation target>",
  "startBranch": "<branch>", "buildBranch": null,
  "maxFiles": 25, "yes": false,
  "steps": { "specify": "pending", "scout": "pending", "plan": "pending",
             "gate": "pending", "implement": "pending", "review": "pending",
             "qa": "pending", "report": "pending" },
  "workItems": {}, "startedAt": "<iso>", "updatedAt": "<iso>"
}
```

## Step 1 — Specify (fsp-analyst, sonnet)

Skip (mark `"skipped"`) if a spec file was provided.

Invoke the `fsp-analyst` agent with the feature ask and the paths to any existing
scout briefs and the stack profile. If the analyst returns batched clarifying
questions, relay them to the user verbatim, pass the answers back, and let it commit
to the spec. Record the spec path in STATE.json; mark `specify: done`.

## Step 2 — Scout (fsp-scout, haiku)

From the spec's data/permission implications, determine the affected stack slices
(SQL / .NET / Angular / infra). For each affected slice:
- Reuse `.claude/pilot/context/<slice-slug>.md` if it exists and STATE.json does not
  flag it stale; otherwise invoke `fsp-scout` for that slice.

If a scout reports its budget was insufficient, relay its request and stop (RULE 7).
Record brief paths; mark `scout: done`.

## Step 3 — Plan (fsp-architect, opus)

Invoke the `fsp-architect` agent in **Plan mode**, passing paths only: the spec, the
briefs, the stack profile. It writes `builds/<feature>/PLAN.md` with dependency-ordered
work items, each carrying `Owner`, `Complexity: high|normal`, governing standard IDs,
expected files, a verification command, and a `Gate:` line.

Sanity-check the plan before gating:
- Every work item's `Implements:` maps to real US-/AC-ids in the spec.
- The union of "files expected to change" ≤ `--max-files`; if over, ask the user to
  raise the cap or ask the architect to split the plan. Do not proceed silently.

Seed `STATE.json.workItems` with `{ "WI-n": { "status": "pending", "owner": "...",
"complexity": "..." } }`; mark `plan: done`.

## Step 4 — Gate (user)

Print in chat: the architect's model header, one line per work item
(id, title, owner, complexity, gate), the total expected file count, and any hard
gates the plan triggers.

- Hard gates present → list them and require explicit per-gate sign-off **even with
  `--yes`**. A declined gate marks its work item `blocked`; ask whether to proceed
  with the remainder or stop.
- No hard gates → proceed on `--yes`, otherwise ask: "Proceed with this plan?
  (YES / describe changes)". Plan-change requests go back to Step 3 with the feedback.

Mark `gate: done` with the decision recorded.

## Step 5 — Implement (stack implementors, sonnet/opus per item)

Create the branch: `git checkout -b pilot/build-<feature-slug>` (record in STATE.json).

For each work item in dependency order:
1. Invoke the owning `@<stack>-implementor` agent, passing paths to: PLAN.md (its
   work item), the spec, and the relevant scout brief. Per-invocation model override:
   `opus` if `Complexity: high`, else `sonnet` (RULE 4).
2. The implementor edits product code and reports the files it changed.
3. Run the work item's verification command. Failure → one fix round with the same
   implementor; second failure → mark the item `failed`, write STATE.json, stop (RULE 7).
4. Commit the verified item on the build branch (`feat(<area>): <WI-n title>`,
   conventional format) — per-item commits keep every later step's diff isolated
   and give `--resume` a clean boundary.
5. After each item, check cumulative `git diff --name-only <startBranch>...HEAD | wc -l`
   against `--max-files`; if exceeded, stop and ask before continuing.
6. Mark the item `implemented` in STATE.json.

An implementor that hits a hard gate mid-item (e.g. the fix requires an [Authorize]
change the plan didn't declare) must stop; relay to the user as in Step 4.

Mark `implement: done` when all non-blocked items are implemented.

## Step 6 — Review (paired stack reviewers, max 2 loops)

For each stack touched, invoke the paired `@<stack>-reviewer` scoped to
**the diff only** (`git diff <startBranch>...HEAD` for that stack's files), passing
the PLAN.md path so findings map to work items.

- Findings → route each to the owning implementor (same model tier as its item) for
  a fix; re-run the item's verification; re-review the fix diff; commit each accepted
  fix (`fix(<area>): <finding id>`).
- **Max 2 implement-review loops per work item.** A finding open after loop 2
  indicates a plan-level problem: stop and print BOTH the reviewer's finding and the
  implementor's position, and ask the user to arbitrate (RULE 5).
- Reviewer reports obey the 10-line quoting cap; keep chat to a findings-count
  summary per stack.

Record loop counts per item; mark `review: done`.

## Step 7 — Test (fsp-qa) + deterministic write-scope enforcement

Verify the working tree is clean (Steps 5–6 committed everything), then record the
pre-QA HEAD: `qaBaseSha = git rev-parse HEAD`.

Invoke `fsp-qa` with paths to the spec, PLAN.md, the implementors' summaries, and the
scout briefs. It writes/extends tests, runs them, and writes
`builds/<feature>/QA-REPORT.md`.

**Then enforce the write scope (RULE 6)** — trust nothing, check the working tree.
`git diff` alone is NOT sufficient: files QA newly created are untracked and invisible
to it. Use:

```
git status --porcelain
```

Allowlist (must match the fsp-qa contract): `tests/**`, `**/e2e/**`, `**/*.spec.ts`,
`**/*.spec.tsx`, `**/*Tests.cs`, `**/*.Tests/**`, `.claude/pilot/builds/<feature>/**`.

For every path outside the allowlist:
- modified/deleted (tracked) → `git checkout <qaBaseSha> -- <path>` (revert it)
- newly created (untracked, `??`) → delete the file

Log the enforced paths in STATE.json under `qa.revertedPaths` and record each as a
defect for the owning implementor. Then commit the surviving test changes
(`test(<feature>): QA coverage for <spec>`). Defects in QA-REPORT.md (including reverted-write
defects) go through one implementor fix round + verification + QA re-run of the
affected tests. A FAIL verdict after that round stops the pipeline with the defects
table printed (RULE 7).

Mark `qa: done` with the verdict.

## Step 8 — Report

Write `builds/<feature>/SUMMARY.md`:

```
# Build summary: <feature>
Date | Spec | Plan | Branch: pilot/build-<slug> (NOT merged)

## Work items
| WI | Title | Complexity/model | Verification | Review loops | Status |

## QA verdict
<n>/<total> acceptance criteria verified — <verdict> (details: QA-REPORT.md)

## Deviations
<gates declined, blocked/failed items, QA reverted paths, escalations — or "None">

## Next steps
git diff <startBranch>...pilot/build-<slug>   # review
<merge/PR instructions per the project's git workflow>
```

Mark `report: done`. Print in chat ONLY: the branch name, the work-item table, the
QA verdict line, and the summary path. The branch is left unmerged — merging is the
user's decision.

## Failure policy (applies to every step)

On any stop — failure, declined gate, budget exhaustion, escalation — write the
current STATE.json first, then print: what stopped, why, the state file path, and
`/fsp-build --resume <feature-slug>` as the continuation command. Completed steps
are never re-paid.
