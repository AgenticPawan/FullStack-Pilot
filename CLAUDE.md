# FullStack Pilot — Developer Guide

## Purpose

**FullStack Pilot** is a Claude Code plugin marketplace for full-stack Microsoft shops.
It ships codebase-governance skills, agents, and hooks for Angular, .NET, SQL Server,
and Azure projects. Hosted publicly at `AgenticPawan/FullStack-Plugin`; installed via:

    /plugin marketplace add AgenticPawan/FullStack-Plugin

## Repository layout

    .claude-plugin/marketplace.json     ← marketplace catalog (required fields: name, owner, plugins)
    plugins/
      pilot-core/                       ← shared governance utilities
      pilot-angular/                    ← Angular / TypeScript rules
      pilot-dotnet/                     ← C# / ASP.NET Core rules
      pilot-sql/                        ← SQL Server / EF Core rules
      pilot-azure/                      ← Azure / Bicep / ACA rules
    scripts/validate.mjs                ← zero-dependency CI validator
    .github/workflows/validate.yml      ← runs validate.mjs on every push/PR

Each plugin directory MUST have:

    <plugin>/
      .claude-plugin/plugin.json        ← manifest: name, version, description, author
      skills/<skill-name>/SKILL.md      ← skills (when added)
      agents/<name>.md                  ← agents (when added)
      hooks/hooks.json                  ← hooks (when added)

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
