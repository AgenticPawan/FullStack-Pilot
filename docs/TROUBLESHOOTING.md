# Troubleshooting

## Install

### `/plugin marketplace add AgenticPawan/FullStack-Pilot` fails to find the repo

Double-check casing and hyphenation match exactly: `FullStack-Pilot`. If you're on an
older clone or bookmark, note the repo was previously reachable at `FullStack-Plugin`
before being renamed — update any saved links.

### `/plugin install pilot-core@FullStack-Pilot` says plugin not found

Use the marketplace **name**, not the repo name, after `@`:

```shell
/plugin install pilot-core@fullstack-pilot
```

The suffix comes from the `name` field in `.claude-plugin/marketplace.json`
(`"fullstack-pilot"`), which is independent of the repo's GitHub URL.

### Installed plugins don't show up / commands aren't recognized

Restart Claude Code, or run `/plugin marketplace update` then restart. Newly installed
skills, agents, and commands load at session start.

### Plugin installs but skills are missing

Run `claude plugin validate ./plugins/<plugin-name>` to check `plugin.json` and every
`SKILL.md`/`hooks.json` for schema errors. A malformed `hooks/hooks.json` prevents the
**entire plugin** from loading, not just the hook.

## `/fsp-init`

### "Does this look correct?" keeps asking — Phase 2 never starts

Phase 2 (scaffolding) only runs after you explicitly reply `YES` (or equivalent) to the
Phase 1 confirmation prompt. If you want corrections applied first, describe them instead
of replying yes.

### EOL advisory printed for Angular 15/16 or .NET 6/7

Expected behavior, not an error — see the [supported-versions matrix](../README.md#supported-versions).
These versions get upgrade-path guidance (`angular-upgrade-path`, `dotnet-upgrade`), not
new governance rules.

## `/fsp-audit`

### "Coverage gap" noted for a scanner

`/fsp-audit` runs whatever scanners are installed and documents missing ones as
coverage gaps rather than failing. Install the missing tool (the report prints the
install command) and re-run for full coverage.

### Command fails with "stack-profile.json not found"

Run `/fsp-init` first — `/fsp-audit` depends on the confirmed stack profile it writes
to `.claude/pilot/stack-profile.json`.

## `/fsp-fix`

### "Working tree must be clean" error

`/fsp-fix` refuses to create its fix branch over uncommitted changes. Commit or stash
first.

### Batch exceeds `--max-files`

This is a safety gate, not a failure — the command prints sub-batches and waits for you
to choose one rather than opening a mega-PR. Lower `--max-files` further for
security-sensitive areas, or pick a sub-batch.

## `/fsp-architect` and `/fsp-build`

### The assessment/plan header says "FALLBACK: verify opus availability"

`fsp-architect` is pinned to opus (T3 tier) and prints the model it actually resolved
to. If your org's `availableModels` allowlist excludes opus, Claude Code silently falls
back to the inherited model — the pipeline still works, but planning depth may drop.
Ask your admin to allow opus, or treat the output as a sonnet-tier draft.

### The assessment cites briefs that feel stale

Scout briefs under `.claude/pilot/context/` are reused across runs to save tokens.
After significant refactors, re-run with `/fsp-architect --refresh` to force new
briefs.

### `/fsp-build` stopped mid-pipeline

By design — a failed verification, a declined gate, or a review escalation stops the
pipeline after writing `builds/<feature>/STATE.json`. Fix or answer whatever it
stopped for, then continue with `/fsp-build --resume <feature-slug>`; completed steps
are never re-run.

### `--yes` didn't skip a confirmation

`--yes` waives only the plan-summary gate (Step 4). Hard safety gates — auth/policy
changes, public API contract changes, destructive migrations, resource
deletion/RBAC/network loosening — always stop for explicit sign-off, by design.

### QA-REPORT.md lists "reverted paths"

The QA agent may only write test files. The pipeline checks its working-tree changes
deterministically (`git status --porcelain` against the test-path allowlist) and reverts anything else,
routing it back to the owning implementor as a defect. The revert is the enforcement
working, not data loss — the change re-lands through the implementor if it's needed.

## Agents

### `@<agent-name>` doesn't appear in the typeahead

Agents load at session start — restart Claude Code after installing or updating a
plugin. Also note agents are namespaced by plugin: if two marketplaces ship an agent
with the same short name, use the qualified form (e.g. `pilot-dotnet:dotnet-reviewer`).

### The implementor refuses to make a change and asks for sign-off

Working as designed. `*-implementor` agents have hard gates: auth/public-API changes
(.NET), destructive migrations (SQL), resource deletion/RBAC/network loosening (Azure),
route/guard changes (Angular). Reply confirming the specific change and it proceeds.

### A support agent answers without citing file:line evidence

That's a bug in the diagnosis, not a style choice — support agents are required to cite
evidence for every root-cause claim. Ask it to "show the evidence" or re-run with the
error text/logs included in your prompt; a diagnosis it can't evidence should be
labeled a hypothesis.

### The reviewer found an issue but nothing got fixed

Reviewers and support agents are read-only by design. Hand the finding to the paired
implementor: `@dotnet-implementor fix the <ID> finding in <file>:<line>`. The
implementor edits your working tree but never commits — review and commit the diff
yourself.

### `@azure-support` / `@angular-support` can't run live diagnostics

Live inspection is optional and depends on the bundled MCP servers being configured
(Azure credentials for `azure-support`; a running app for `angular-support`'s
Playwright inspection). Without them the agents still work — they fall back to
reading source, config, and the logs you paste.

## MCP servers

See [mcp-setup.md](../plugins/pilot-core/docs/mcp-setup.md) for per-server credential
requirements. Most connection failures trace to a missing environment variable (GitHub
PAT, Azure service-principal credentials) or a missing local prerequisite (Docker for the
GitHub MCP server, the `dab` CLI for the SQL MCP server).

## Still stuck?

Open an issue with the output of `node scripts/validate.mjs` and your Claude Code
version (`claude --version`).
