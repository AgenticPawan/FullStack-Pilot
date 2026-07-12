---
description: Assess the whole solution against the pilot target state and emit a ranked, buildable gap register with ready-to-run /fsp-build lines.
argument-hint: "[--scope <area>] [--refresh]"
---

# /fsp-architect — Whole-Solution Architecture Assessment

Assess the **current working repository** (the user's project, not this plugin repo) against the target state encoded in the pilot skills, and produce a ranked gap register with ready-to-run enhancement plans. This is the "find what we should build next" command — each gap it emits carries a `/fsp-build` line that feeds straight into the one-shot pipeline.

## Arguments

- `--scope <area>`: optional. A feature area ("the orders feature"), a stack slice ("the Angular app"), or omitted = whole solution.
- `--refresh`: optional. Force new scout briefs even if briefs for the scope already exist.

## What this command does

| Step | Actor | Model | Output |
|------|-------|-------|--------|
| 1 Scout | @fsp-scout | haiku | `.claude/pilot/context/<scope-slug>.md` briefs |
| 2 Assess | @fsp-architect (Assess mode) | opus | `.claude/pilot/architecture/ASSESSMENT.md` + ADR stubs |
| 3 Summarize | orchestrator (this session) | — | gap-register table in chat |

## Prerequisites

- `.claude/pilot/stack-profile.json` should exist — if absent, recommend `/fsp-init` first; proceed only if the user declines (the architect will note the missing profile as a confidence limit).

## Execution

### Step 1 — Scout the scope (token rule: never re-pay for context)

1. Compute the scope slug (kebab-case; `whole-solution` when no `--scope` given).
2. If `.claude/pilot/context/<scope-slug>.md` exists and `--refresh` was NOT passed, reuse it — do not invoke the scout.
3. Otherwise invoke the `fsp-scout` agent with the scope. For `whole solution` on a multi-stack repo, invoke one scout per detected stack slice (frontend / API / database / infra, per the stack profile) so no single brief blows its 150-line cap.
4. Collect the brief path(s). If a scout reports its budget was insufficient, relay its request to the user and stop — do not send the architect in blind.

### Step 2 — Architect assessment

Invoke the `fsp-architect` agent in **Assess mode**, passing only file paths (never pasted content):

- the scout brief path(s) from Step 1
- `.claude/pilot/stack-profile.json` (if present)
- `.claude/pilot/audit/AUDIT-REPORT.md` (if present — a prior `/fsp-audit` sharpens the security dimension)
- the scope string

The architect writes `.claude/pilot/architecture/ASSESSMENT.md` and ADR stubs under `.claude/pilot/architecture/adr/`.

### Step 3 — Print the summary (chat gets the summary, disk gets the depth)

Print in chat ONLY:

1. The architect's model header line (fallback visibility — the user must know if opus didn't run).
2. The gap-register table: ID, gap one-liner, risk, effort (S/M/L).
3. The architect's 3-line verdict.
4. The pointer block:

```
Full assessment → .claude/pilot/architecture/ASSESSMENT.md
ADR stubs       → .claude/pilot/architecture/adr/
Build a gap     → /fsp-build GAP-<n>   (ready-to-run lines are in the assessment)
```

Never paste the enhancement-plan sections or ADR stubs into chat.

## Output files

| File | Purpose |
|------|---------|
| `.claude/pilot/context/<scope-slug>.md` | Scout brief(s) — reused by later runs and by `/fsp-build` |
| `.claude/pilot/architecture/ASSESSMENT.md` | Ranked gap register + per-gap enhancement plans |
| `.claude/pilot/architecture/adr/ADR-<n>-<slug>.md` | Decision stubs per architecture-decision-records |
