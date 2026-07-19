# FullStack Pilot — Developer Guide

## Purpose

**FullStack Pilot** is a Claude Code plugin marketplace for full-stack Microsoft shops.
It ships codebase-governance skills, agents, and hooks for Angular, .NET, SQL Server,
and Azure projects. Hosted publicly at `AgenticPawan/FullStack-Pilot`; installed via:

    /plugin marketplace add AgenticPawan/FullStack-Pilot

## Repository layout

    .claude-plugin/marketplace.json     ← marketplace catalog (required fields: name, owner, plugins)
    plugins/
      pilot-core/                       ← shared governance utilities
      pilot-angular/                    ← Angular / TypeScript rules
      pilot-dotnet/                     ← C# / ASP.NET Core rules
      pilot-sql/                        ← SQL Server / EF Core rules
      pilot-azure/                      ← Azure / Bicep / ACA rules
      pilot-rag/                        ← self-hosted RAG scaffold (/fsp-rag-init)
    scripts/validate.mjs                ← zero-dependency CI validator
    .github/workflows/validate.yml      ← runs validate.mjs on every push/PR

Each plugin directory MUST have:

    <plugin>/
      .claude-plugin/plugin.json        ← manifest: name, version, description, author
      commands/fsp-<verb>.md            ← commands (when added)
      skills/<skill-name>/SKILL.md      ← skills (when added)
      agents/<name>.md                  ← agents (when added)
      hooks/hooks.json                  ← hooks (when added)

## Command conventions

- Command files MUST be named `fsp-<verb>.md` (invoked as `/fsp-<verb>`).
  The `fsp-` prefix brands every FullStack Pilot command; CI enforces it.

## Agent conventions

- Agent filenames follow `<stack>-{reviewer|implementor|support}.md` or `fsp-<role>.md`.
- `*-reviewer` and `*-support` agents MUST declare `disallowedTools: Write, Edit`
  (they diagnose and report — never modify files). `*-implementor` agents MUST NOT.
- Every agent MUST have `name` and `description` frontmatter.

## Model matrix (CI-enforced)

| Tier | Model | Agents |
|---|---|---|
| T1 read/understand | `haiku` | `fsp-scout` |
| T2 analyze/review | `sonnet` (or omit) | `*-reviewer` (effort: high — review depth is the product), `*-support`, `fsp-analyst`, `fsp-qa` |
| T3 plan/complex implement | `opus` | `fsp-architect`; implementors via per-invocation override |

- `*-implementor` agents MUST NOT hardcode a `model` — orchestrating commands pass
  `opus` or `sonnet` per invocation based on work-item complexity.

## Token discipline (STRICT, CI-enforced where possible)

- Every agent body MUST contain a "Read budget" declaration. Budgets bound
  exploration, NOT quality: an agent that hits its budget must say what else it needs,
  never silently return a degraded result.
- Pipeline artifacts are files under `.claude/pilot/` (briefs, specs, plans, reports) —
  agents hand off by file path, never by pasting content into chat.
- No agent report quotes more than 10 lines of source per finding.
- `plugin.json` `description` MUST be ≤600 chars (CI failure) — it loads into every
  session. Each `marketplace.json` plugin `description` carries the same ≤600 cap (CI
  failure) — it loads on the catalog browse surface. SKILL.md `description`+`when_to_use`
  target ≤800 chars combined (CI warning; hard cap 1024). When trimming, compress
  description prose only — NEVER remove `when_to_use` keywords; they are the skill-routing signal.
- Do NOT set `disable-model-invocation: true` on skills that commands instruct Claude
  to run (stack-detection, pilot-scaffold, audit-orchestration, batched-remediation,
  convention-learner, mcp-discovery, fsp-build-orchestration, foundation-bootstrap, and
  the pilot-rag `rag-*` skills) — it would block the Skill tool and break /fsp-init,
  /fsp-audit, /fsp-fix, /fsp-learn, /fsp-build, /fsp-bootstrap, /fsp-rag-init.
  Command-internal skills users should not run directly carry `user-invocable: false`
  instead (hides the /-menu entry, keeps Skill-tool invocation working).

## Pipeline artifact layout (`.claude/pilot/` in the user's project)

Fixed locations — commands and agents rely on these paths for handoffs and reuse:

    .claude/pilot/
      stack-profile.json            ← /fsp-init (stack-detection); input to everything else
      context/<scope-slug>.md       ← fsp-scout briefs (≤150 lines; reused unless --refresh)
      specs/<feature>.md            ← fsp-analyst specs (US-n / AC-n ids; ≤2 pages)
      architecture/ASSESSMENT.md    ← fsp-architect Assess mode (/fsp-architect)
      architecture/adr/             ← ADR stubs the assessment drafts
      builds/<feature>/PLAN.md      ← fsp-architect Plan mode (/fsp-build step 3)
      builds/<feature>/STATE.json   ← pipeline checkpoint; enables /fsp-build --resume
      builds/<feature>/QA-REPORT.md ← fsp-qa traceability (AC-n → test → pass/fail)
      builds/<feature>/SUMMARY.md   ← /fsp-build final report
      audit/findings.json, audit/AUDIT-REPORT.md  ← /fsp-audit
      knowledge/conventions.md, knowledge/lessons.md  ← /fsp-learn

## SKILL.md conventions

Every `SKILL.md` MUST begin with YAML frontmatter containing all three fields:

    ---
    name: <kebab-case-display-name>
    description: <what it does and when Claude should use it>
    when_to_use: <trigger phrases, e.g. "review angular component, check signal usage">
    ---

- `description` + `when_to_use` combined MUST NOT exceed 1024 characters.
- Omitting `description` is a CI failure.
- Add `disable-model-invocation: true` for skills that must only be user-triggered.
- Keep the body under 500 lines; move reference material to supporting files.

## Hooks conventions

- Hooks MUST be **matcher-scoped** for tool events (e.g. `"matcher": "Edit|Write"` for `PreToolUse`/`PostToolUse`). Never use `"*"`. `SessionStart`, `InstructionsLoaded`, and other non-tool events do NOT take a `matcher` field — the hook group has only `"hooks": [...]`.
- Hook `command` paths MUST use `${CLAUDE_PLUGIN_ROOT}` — never hardcoded absolute paths.
- Hook scripts MUST exist at the declared path and be executable (`chmod +x`).
- Hook scripts MUST NOT recurse `node_modules/`, `bin/`, `obj/`, `dist/`, or `.git/`.
- Hooks belong in `<plugin>/hooks/hooks.json`, not in `plugin.json` inline.
- The security hooks (secret-guard, dangerous-patterns, formatter) live ONLY in pilot-core,
  and their pattern config covers every stack (Angular/.NET/SQL/Azure). Because those hooks
  are the enforcement floor, every stack plugin declares `"dependencies": [{ "name":
  "pilot-core" }]` in its `plugin.json` so pilot-core is always installed alongside it —
  never duplicate the hook scripts into a stack plugin.
- `dangerous-patterns.json` entries carry an `action`: `deny` hard-blocks (security-grade);
  `warn` surfaces a non-blocking `systemMessage` via `permissionDecision: defer` (style/
  testability). Absent `action` defaults to `deny`. Do NOT put style opinions behind `deny`.
- `dangerous-patterns.json` regex `pattern`s MUST avoid catastrophic backtracking (no nested
  unbounded quantifiers like `(a+)+`) and stay ≤300 chars. The hook sniffs each config pattern
  and **skips** a risky/over-long one (leaving a stderr breadcrumb) rather than compiling it, so
  a bad pattern can never hang a Write for the hook timeout (ReDoS).

## Commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

    feat(pilot-<name>): add <skill|agent|hook> for <purpose>
    fix(pilot-<name>): correct <what> in <component>
    docs: update README or CLAUDE.md
    ci: update validate workflow or scripts/validate.mjs
    chore: bump versions in marketplace.json or plugin.json

One plugin or concern per commit. Reference issue numbers where applicable.

## What's New (2026-07-19 — orchestration layer)

Added in this session to close the gap with reference repos on automation and intelligence:

**AGENTS.md** — repo-root routing document covering all 5 plugins: intent-to-agent mapping, cross-agent coordination patterns, subagent policy, MCP-first tool order, and hard safety rules (no force-push, no live-env changes, 10-iteration cap).

**`rules-catalog/always-agent-routing.md`** — auto-loaded rules file: MCP-first order, subagent policy, skill load order, 10-iteration cap enforcement.

**Four new hook scripts** (`bash-guard.js`, `antipattern-guard.js`, `test-analyzer.js`, `build-validator.js`) wired in `hooks.json`:
- `bash-guard.js` — PreToolUse/Bash: blocks git force-push, hard-reset, DROP TABLE without WHERE, Azure deployments outside branch; warns on wide `rm -rf` and prod builds
- `antipattern-guard.js` — PreToolUse/Write|Edit|MultiEdit: advisory warnings for Angular subscribe leaks, `: any` types, .NET `new HttpClient()` / `async void` / `.Result`, SQL `SELECT *`
- `test-analyzer.js` — PostToolUse/Bash: parses `dotnet test` and `ng test` output; writes summary to `.claude/last-test-run.md`
- `build-validator.js` — PreToolUse/Bash: validates `.sln`/`angular.json`/lock file presence before build commands

**Knowledge base** (`plugins/pilot-core/knowledge/`): `stack-antipatterns.md`, `stack-packages.md`, and `decisions/ADR-001` through `ADR-005` (permissions-only auth, GUID keys, direct DbContext, takeUntilDestroyed, tenant filter at DbContext).

**Three new skills**: `session-handoff` (session continuity via `.claude/handoff.md`), `project-instincts` (three-tier multi-stack learning system), `quality-gate` (7-phase pre-PR verification), `stack-health` (A–F graded health report).

**Three new commands**: `/fsp-checkpoint` (commit + handoff), `/fsp-verify` (quality gate), `/fsp-health` (health report).

---

## Before any schema change

Before modifying a `plugin.json` or `marketplace.json` field:

1. Re-fetch the live Claude Code plugin docs:
   - https://code.claude.com/docs/en/plugins-reference.md  (authoritative schema)
   - https://code.claude.com/docs/en/plugin-marketplaces.md  (authoritative schema)
2. Confirm the field is supported in the current release.
3. Update `scripts/validate.mjs` required-field checks if the schema changed.
4. Run `node scripts/validate.mjs` locally — it must exit 0 before you push.
