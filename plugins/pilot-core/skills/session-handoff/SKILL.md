---
name: session-handoff
description: Writes a structured handoff note to `.claude/handoff.md` at session end and reads it at session start, ensuring cross-session continuity for the full stack. Captures last command run, last test result (from `.claude/last-test-run.md` if present), what changed and why, open questions, and next recommended action. For active P0/P1 incidents, extends the note with incident timeline, ruled-out hypotheses, current hypothesis, and escalation status.
when_to_use: session end, wrap up, done for today, handoff, save progress, start session, load context, continuing from last time, where did we leave off, P0 incident handoff, /fsp-checkpoint, save state, resuming work
---

## Session-End Protocol

When the session is ending (user says "wrap up", "done for today", "handoff", "save progress"):

### Step 1 — Gather state

1. Run `git status` to capture uncommitted state.
2. Read `.claude/last-test-run.md` if it exists (written by `test-analyzer` hook).
3. List any open findings from `.claude/pilot/audit/findings.json` (if present, count unresolved P0/P1).

### Step 2 — Write `.claude/handoff.md`

Overwrite (do not append). Format:

```markdown
# Session Handoff — <ISO timestamp>

## Branch & Commit State
- Branch: <current branch>
- Status: <clean | N uncommitted files>
- Last commit: <short hash> — <message>

## What Changed This Session
<2-4 bullets: what was done, key decisions made, why>

## Last Test Run
<paste from .claude/last-test-run.md, or "no test run this session">

## Open Questions
<bulleted list, or "none">

## Next Recommended Action
<one concrete first step for whoever picks this up>

## Open Audit Findings
<P0/P1 count from findings.json, or "none">
```

### P0/P1 Incident Extension

If a production incident (P0 or P1) was active this session, append:

```markdown
## Incident Status — <severity> <incident-id or description>
- Timeline: <when it started, what escalated it>
- Ruled out: <layers/hypotheses confirmed not the cause>
- Current hypothesis: <strongest current theory + evidence>
- Next diagnostic step: <exactly what to run or check>
- Escalation: <who was notified, current status>
```

---

## Session-Start Protocol

When starting a new session (user says "load context", "start session", "what did we last do", or similar):

1. Check whether `.claude/handoff.md` exists.
2. If it does: **read it immediately and surface it to the user before any other action**.
3. If it does not: say so and proceed normally.

Surface format:
```
## Resuming from previous session (<timestamp>)
Branch: <branch>
Last work: <bullet from What Changed>
Next action: <Next Recommended Action from handoff>
Open questions: <count>
```

Then ask: "Continue where we left off, or start something new?"

---

## Handoff Quality Rules

- **Never summarize vaguely** ("worked on features") — be specific ("added `POST /api/orders` endpoint, wired to `CreateOrderHandler`, tests pass").
- **Always include the next action** — a handoff without a next step forces the next session to re-derive context.
- **The file path is fixed**: `.claude/handoff.md` in the user's project root. Always overwrite, never append — there is only ever one active handoff.
- **Size limit**: keep the handoff under 80 lines. If it would be longer, summarize — the audit trail lives in git, not the handoff file.
