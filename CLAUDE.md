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
  session. SKILL.md `description`+`when_to_use` target ≤800 chars combined (CI
  warning; hard cap 1024). When trimming, compress description prose only — NEVER
  remove `when_to_use` keywords; they are the skill-routing signal.
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

- Hooks MUST be **matcher-scoped** (e.g. `"matcher": "Edit|Write"`). Never use `"*"`.
- Hook `command` paths MUST use `${CLAUDE_PLUGIN_ROOT}` — never hardcoded absolute paths.
- Hook scripts MUST exist at the declared path and be executable (`chmod +x`).
- Hook scripts MUST NOT recurse `node_modules/`, `bin/`, `obj/`, `dist/`, or `.git/`.
- Hooks belong in `<plugin>/hooks/hooks.json`, not in `plugin.json` inline.

## Commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

    feat(pilot-<name>): add <skill|agent|hook> for <purpose>
    fix(pilot-<name>): correct <what> in <component>
    docs: update README or CLAUDE.md
    ci: update validate workflow or scripts/validate.mjs
    chore: bump versions in marketplace.json or plugin.json

One plugin or concern per commit. Reference issue numbers where applicable.

## Before any schema change

Before modifying a `plugin.json` or `marketplace.json` field:

1. Re-fetch the live Claude Code plugin docs:
   - https://code.claude.com/docs/en/plugins-reference.md  (authoritative schema)
   - https://code.claude.com/docs/en/plugin-marketplaces.md  (authoritative schema)
2. Confirm the field is supported in the current release.
3. Update `scripts/validate.mjs` required-field checks if the schema changed.
4. Run `node scripts/validate.mjs` locally — it must exit 0 before you push.
