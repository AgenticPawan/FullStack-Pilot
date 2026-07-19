---
description: Save session state — commit staged changes and write .claude/handoff.md with branch, test status, what changed, and next action.
argument-hint: "[message]"
---

Run the session-handoff skill to save current session state.

## Behavior

1. **Capture state**: Run `git status`. Note any uncommitted changes.
2. **Commit if staged**: If there are staged changes, commit them with the provided message (or prompt for one). Follow Conventional Commits (`feat(scope):`, `fix(scope):`, `chore:`, etc.).
3. **Write handoff**: Execute the session-handoff skill — write `.claude/handoff.md` with:
   - Branch name and commit state
   - What changed this session (2-4 bullets)
   - Last test run result (from `.claude/last-test-run.md` if present)
   - Open questions
   - Next recommended action
4. **Confirm**: Print the branch name, commit hash (if committed), and the path `.claude/handoff.md`.

## Output

```
✓ Checkpoint saved
Branch:      <branch-name>
Commit:      <hash> <message>  (or "no new commit — working tree clean")
Handoff:     .claude/handoff.md
Next action: <one-line summary from handoff>
```

## Notes

- If there are unstaged changes, report them but do not auto-stage without confirmation.
- If a P0/P1 incident is in progress, the handoff includes an incident status section (see session-handoff skill).
- Run `/fsp-checkpoint` before switching branches or ending a session. The handoff is always overwritten — one active handoff at a time.
