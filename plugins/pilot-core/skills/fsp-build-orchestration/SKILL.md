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
     destructive migration, resource deletion / RBAC / network loosening, greenfield
     project with no foundation modules yet) STOP the pipeline for explicit user
     sign-off — --yes never waives them. -->
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
- `--tdd` (test-first mode: per work item, fsp-qa writes failing tests for that item's
  ACs BEFORE the implementor starts; implementor must make them green as part of its
  verification contract; default off)

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
  **Exception**: when stack implementors are invoked with `isolation: "worktree"` (the
  default for /fsp-build pipeline invocations), each implementor works in its own isolated
  git worktree. The main working tree is NOT required to be clean in that case — the
  worktree is created clean from the current HEAD. `--resume` semantics are preserved:
  completed work items record the worktree merge commit SHA in STATE.json, and the pipeline
  merges each completed worktree back to the build branch before starting the next item.
- **Foundation check**: read `.claude/pilot/foundation/STATUS.md` if present.
  - Present, every Required module `done` or `skipped-by-user-choice` → proceed.
  - Absent → judge greenfield from the stack profile's own evidence (e.g. a dotnet project
    with only `Program.cs` plus scaffold-template files, or an Angular app with only the
    default `AppComponent` and no custom components/routes beyond the CLI template) —
    this is a judgment call from available evidence, not a hardcoded file-count threshold.
    - **Greenfield**: STOP — print "This looks like a new project with no foundation
      modules yet (auth/authz/logging/error-handling/health-checks/CORS). Run
      /fsp-bootstrap first, or reply CONFIRM to proceed with feature work without them."
      This is a hard gate: `--yes` never silently waives it — it still requires the
      explicit CONFIRM reply, exactly like the other hard gates in RULE 3.
    - **Brownfield** (existing substantial source): print one line — "No
      .claude/pilot/foundation/STATUS.md found; if this project is missing baseline
      auth/logging/error-handling, consider /fsp-bootstrap." — and proceed without
      blocking. Pilot cannot see modules built before it was installed.
- Record `startBranch` (`git rev-parse --abbrev-ref HEAD`).

Create `.claude/pilot/builds/<feature-slug>/` and initialize `STATE.json`:

```json
{
  "feature": "<slug>", "target": "<raw invocation target>",
  "startBranch": "<branch>", "buildBranch": null,
  "maxFiles": 25, "yes": false,
  "steps": { "specify": "pending", "scout": "pending", "threatModel": "pending",
             "plan": "pending", "gate": "pending", "implement": "pending",
             "review": "pending", "qa": "pending", "report": "pending" },
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

## Step 2.5 — Threat model gate (optional, fsp-threat-modeler)

Triggered when the spec contains external integrations, auth surface changes, public-facing
API additions, or `--threat-model` was passed. Invoke `fsp-threat-modeler --gate`:
- P0 threats OPEN → pipeline stops; print the P0 list; require CONFIRM to continue.
- P1–P3 threats OPEN → advisory; log in STATE.json under `threatModel.advisories`; continue.
- Record the threat-model path in STATE.json under `threatModel.path`.

Skip (mark `"skipped"`) when none of the above triggers apply.

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
1. **`--tdd` pre-step (when `--tdd` is active)**: before invoking the implementor,
   invoke `fsp-qa` scoped to **only this work item's ACs**. It writes failing tests to
   the allowed test paths and runs them — they must be red. If fsp-qa cannot make them
   red (AC is not testable in isolation), document and skip TDD for that AC only.
   Commit the failing tests (`test(<area>): TDD stubs for WI-n`) before the implementor
   starts.
2. Invoke the owning `@<stack>-implementor` agent, passing paths to: PLAN.md (its
   work item), the spec, and the relevant scout brief. Per-invocation model override:
   `opus` if `Complexity: high`, else `sonnet` (RULE 4). Invoked with
   `isolation: "worktree"` — the implementor works in an isolated git worktree branched
   from the current build-branch HEAD; its edits are merged back on success.
3. The implementor edits product code, runs the impacted test suite per the verification
   contract (build + tests; pre-existing red reported upward; implementor-caused red fixed
   before handback), and reports the files it changed plus the test result.
3. Confirm the verification contract was met: the implementor's summary must include a
   test-run result (pass/fail/count), not just a build result. If absent, ask before
   continuing. Verification failure → one fix round with the same implementor; second
   failure → mark the item `failed`, write STATE.json, stop (RULE 7).
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
