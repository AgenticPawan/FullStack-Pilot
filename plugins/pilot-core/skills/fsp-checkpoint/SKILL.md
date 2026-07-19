---
name: fsp-checkpoint
description: Save session state — commit staged changes and write .claude/handoff.md with branch, test status, what changed, and next action.
when_to_use: /fsp-checkpoint, save state, commit and handoff, save session, write handoff, session state, checkpoint progress, end of session, handoff notes
---

Run the session-handoff skill to save current session state.

## Behavior

1. **Capture state**: Run `git status`. Note any uncommitted changes.
2. **Commit if staged**: If there are staged changes, commit them with the provided message (or prompt for one). Follow Conventional Commits (`feat(scope):`, `fix(scope):`, `chore:`, etc.).
3. **Write handoff**: Execute the session-handoff skill — write `.claude/handoff.md` with:
   - Branch name and commit state
   - What changed this session (2-4 bullets)
   - Last test run result (from `.claude/last-test-run.md` if present)
   - Next action (what to resume with in the next session)

## Arguments

- `[message]`: optional commit message. If omitted and there are staged changes, ask for one.

## Safety rules

- Never force-push.
- Never commit secrets or `.env` files.
- If the working tree is dirty (unstaged changes), list them and ask whether to stage them before committing.
