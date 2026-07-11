# /fsp-build — One-Shot Feature Pipeline

Build a feature, module, or assessment gap in the **current working repository** end to end — spec → scout → plan → implement → review → test → report — with one command. Work lands on branch `pilot/build-<feature-slug>`, never merged automatically. The whole delivery team runs: fsp-analyst (BA), fsp-scout (context), fsp-architect (plan), the stack implementors, the paired stack reviewers, and fsp-qa.

## Arguments

- `<feature | spec-file | GAP-id>`: required. A feature description in plain words, a path to an existing `.claude/pilot/specs/*.md` spec, a `GAP-<n>` id from `.claude/pilot/architecture/ASSESSMENT.md`, or `--resume <feature-slug>` to continue a stopped run.
- `--yes`: optional. Skip the plan confirmation gate (Step 4). **Hard safety gates are never waived** — auth/policy changes, public API contract changes, destructive migrations, and resource deletion/RBAC/network loosening always stop for explicit sign-off.
- `--max-files <n>`: optional, default 25. Maximum distinct product files the implement step may modify; the pipeline stops for confirmation if the plan exceeds it.

## Pipeline

| Step | Actor | Model | Output |
|------|-------|-------|--------|
| 1 Specify | fsp-analyst | sonnet | `.claude/pilot/specs/<feature>.md` (skipped if given a spec) |
| 2 Scout | fsp-scout | haiku | `.claude/pilot/context/*.md` briefs per affected stack |
| 3 Plan | fsp-architect | opus | `.claude/pilot/builds/<feature>/PLAN.md` |
| 4 Gate | user | — | plan summary in chat; proceed on confirm (or `--yes`) |
| 5 Implement | stack implementors | sonnet / opus per item complexity | edits on `pilot/build-<feature>`, each verified |
| 6 Review | paired stack reviewers | sonnet | diff-scoped findings; max 2 fix loops, then escalate |
| 7 Test | fsp-qa | sonnet | `.claude/pilot/builds/<feature>/QA-REPORT.md` |
| 8 Report | orchestrator | — | `.claude/pilot/builds/<feature>/SUMMARY.md` |

## Prerequisites

- `.claude/pilot/stack-profile.json` must exist — run `/fsp-init` first if absent.
- A clean git working tree (the pipeline creates a branch; it never stashes without asking).
- On a detected-greenfield project with no `.claude/pilot/foundation/STATUS.md`, Step 0
  stops and asks you to run `/fsp-bootstrap` first (or explicitly confirm you want to build
  features without baseline auth/logging/error-handling/health-checks/CORS) — a hard gate,
  never silently skipped by `--yes`. Existing projects only get a recommendation, not a block.

## Execution

Run the `fsp-build-orchestration` skill now, following every step in order (Step 0 through Step 8). Non-negotiables the skill enforces (do not reinterpret them):

- **File handoffs, not chat handoffs** — every artifact is a file under `.claude/pilot/`; agents receive paths, never pasted content.
- **State after every step** — `builds/<feature>/STATE.json` is updated as each step completes, so `--resume` never re-pays a completed step.
- **QA write-scope check** — after Step 7, the QA step's working-tree changes (`git status --porcelain`, which also catches newly created files a plain diff misses) are verified against the test-path allowlist; any product-code change from QA is reverted and logged (deterministic enforcement, not trust).
- **Hard gates stop the pipeline** even under `--yes`.
- **The branch is left unmerged** — the summary tells the user how to review and merge.

## Output files

| File | Purpose |
|------|---------|
| `.claude/pilot/specs/<feature>.md` | The BA spec — the contract QA traces against |
| `.claude/pilot/builds/<feature>/PLAN.md` | Ordered, complexity-tagged work items |
| `.claude/pilot/builds/<feature>/STATE.json` | Pipeline state for `--resume` |
| `.claude/pilot/builds/<feature>/QA-REPORT.md` | AC-id → test → pass/fail traceability |
| `.claude/pilot/builds/<feature>/SUMMARY.md` | What was built, review outcomes, how to merge |
