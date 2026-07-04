# /pilot-init — Stack Detection and Scaffold

Analyze the **current working repository** (the user's project, not this plugin repo), produce a technology-stack profile, then scaffold the project's Claude setup based on the confirmed profile.

## What this command does

**Phase 1 — Detect**
1. Runs the `stack-detection` skill against the project root.
2. Detects Angular (v15–20), .NET (net6–net11), SQL Server, and Azure presence — evidence-based only.
3. Writes `.claude/pilot/stack-profile.json` in the project root.
4. Prints a summary table and asks the user to confirm before proceeding.

**Phase 2 — Scaffold** *(runs only after user confirms the profile)*
5. Runs the `pilot-scaffold` skill.
6. Asks one compact question block: unknowns from the profile + architecture / tenancy / compliance / team size.
7. Generates `CLAUDE.md` (hard limit: 100 lines, facts only).
8. Materializes version-gated governance rules from the rules catalog into `.claude/rules/`.
9. Prints EOL advisories for Angular 15/16 or .NET 6/7 if detected.

## Execution

### Phase 1

Run the `stack-detection` skill now, following every step in order (Step 0 through Step 7).

- Treat the current working directory as `PROJECT_ROOT`.
- Never recurse into `node_modules/`, `bin/`, `obj/`, `dist/`, `.git/`, or `packages/`.
- Read at most 50 source files total; prefer manifest files over source files.
- Every claim in the output JSON must cite a file path in the `evidence` map.
- Never print connection string values — record file paths only.
- End Phase 1 by printing the summary table and asking: "Does this look correct? Reply **YES** to proceed to scaffolding, or describe any corrections."

### Phase 2

**Do not begin Phase 2 until the user explicitly replies YES (or equivalent confirmation).**

Once confirmed, run the `pilot-scaffold` skill, following every step in order (Step 1 through Step 7).

- The confirmed `stack-profile.json` is the authoritative input — do not re-detect.
- Rules catalog source: `plugins/pilot-core/rules-catalog/` in the FullStack Pilot plugin repo.
- Rules output destination: `PROJECT_ROOT/.claude/rules/`.
- CLAUDE.md output destination: `PROJECT_ROOT/CLAUDE.md`.
- Hard limit on CLAUDE.md: 100 lines. Fail loudly if you exceed this.
- Print EOL advisories (Step 2 of pilot-scaffold) BEFORE asking interview questions.
