# /fsp-bootstrap — Scaffold Baseline Modules

Detect which baseline modules a project already has — authentication, authorization,
logging, error handling, health checks, CORS, and stack-appropriate recommended modules —
and scaffold the missing required ones via the stack implementors, on a dedicated branch,
before feature work begins. This is the command `/fsp-build`'s foundation gate points a
detected-greenfield project at.

## Arguments

- `--yes`: optional. Skip the soft scaffold-confirmation gate (Step 2). Per-module hard
  gates the stack implementors themselves enforce (e.g. an auth-policy choice) are never
  skipped.

## What this does

| Step | What |
|------|------|
| 0 | Load `.claude/pilot/stack-profile.json`; stop if `/fsp-init` hasn't run yet |
| 1 | Detect which of the checklist's modules already exist (grep-based, bounded read budget) |
| 2 | Print the status table; gate on confirmation before writing any code |
| 3 | Scaffold missing Required modules via the owning stack implementor(s), one commit per module |
| 4 | Paired stack reviewer checks the diff; one fix round on findings |
| 5 | Write `.claude/pilot/foundation/STATUS.md` and print next steps |

## Prerequisites

- `.claude/pilot/stack-profile.json` must exist — run `/fsp-init` first if absent.
- A clean git working tree.

## Execution

Run the `foundation-bootstrap` skill now, following every step in order (Step 0 through
Step 5). Non-negotiables the skill enforces:

- **Required modules are never silently dropped** — the user can `SKIP <module>` with a
  reason recorded in `STATUS.md`, but there is no path that omits a module without a trace.
- **File handoffs, not chat handoffs** — same discipline as `/fsp-build`.
- **The branch is left unmerged** — `pilot/foundation-bootstrap`; the summary tells the
  user how to review and merge.
- A module implementation failure stops the pipeline rather than leaving a half-wired
  auth/error-handling setup silently in place.

## Output files

| File | Purpose |
|------|---------|
| `.claude/pilot/foundation/STATUS.md` | Per-module done/skipped status — `fsp-build-orchestration` reads this before allowing feature work on a greenfield project |

## Relationship to /fsp-build

`/fsp-build`'s Step 0 checks for `STATUS.md`. On a project it judges greenfield (little to
no existing source beyond scaffold defaults) with no `STATUS.md`, it stops and asks you to
run `/fsp-bootstrap` first — or explicitly confirm you want to proceed without baseline
modules. This gate is never silently waived by `/fsp-build --yes`, same as its other hard
gates; it's an explicit sign-off, not an unconditional block. On an existing/brownfield
project, the same situation only prints a recommendation and never blocks — Pilot can't see
modules a team already built before installing it.
