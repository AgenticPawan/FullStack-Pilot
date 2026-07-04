# /pilot-init — Stack Detection

Analyze the **current working repository** (the user's project, not this plugin repo) and produce a technology-stack profile.

## What this command does

1. Runs the `stack-detection` skill against the project root.
2. Detects Angular (v15–20), .NET (net6–net11), SQL Server, and Azure presence — evidence-based only.
3. Writes `.claude/pilot/stack-profile.json` in the project root.
4. Prints a summary table and asks the user to confirm before any governance skill uses the profile.

## Execution

Run the `stack-detection` skill now, following every step in order (Step 0 through Step 7).

- Treat the current working directory as `PROJECT_ROOT`.
- Never recurse into `node_modules/`, `bin/`, `obj/`, `dist/`, `.git/`, or `packages/`.
- Read at most 50 source files total; prefer manifest files over source files.
- Every claim in the output JSON must cite a file path in the `evidence` map.
- Never print connection string values — record file paths only.
- Do not run downstream governance checks until the user confirms the profile.
