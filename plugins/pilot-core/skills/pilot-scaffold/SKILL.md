---
name: pilot-scaffold
description: Phase 2 of /fsp-init. Reads the confirmed stack-profile.json, runs a compact one-block interview covering unknowns plus architecture/tenancy/compliance/team-size, generates a facts-only CLAUDE.md (hard limit 100 lines), and materializes version-gated governance rules from the rules catalog into .claude/rules/.
when_to_use: Run automatically after the user confirms the stack profile during /fsp-init. Also triggered by /pilot-scaffold if the user wants to re-run scaffolding after editing stack-profile.json.
---

<!-- CONSTRAINTS -->
<!-- INPUT: PROJECT_ROOT/.claude/pilot/stack-profile.json (must already be confirmed by user) -->
<!-- CLAUDE.md LIMIT: 100 lines hard limit — no prose, facts only -->
<!-- RULES SOURCE: plugins/pilot-core/rules-catalog/ in the plugin repo -->
<!-- RULES OUTPUT: PROJECT_ROOT/.claude/rules/<id>.md -->
<!-- EOL STACKS: Angular 15/16, .NET 6/7 — print advisory, do NOT bless the stack -->

## Step 1 — Read the confirmed profile

Read `PROJECT_ROOT/.claude/pilot/stack-profile.json`. Extract:
- `angular.majorVersion` (integer or null)
- All `dotnet.projects[*].targetFramework` values (e.g. `"net8.0"`, `"net6.0"`)
- Whether `sql` is non-null
- Whether `azure` is non-null
- `unknowns[]` array

---

## Step 2 — EOL advisory (before interview)

If any of the following are true, print the advisory block BEFORE asking questions:

- `angular.majorVersion` is 15 or 16:

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠  EOL STACK DETECTED                                      │
│  Angular 15 (EOL May 2024) / Angular 16 (EOL Nov 2024)     │
│  Microsoft no longer issues security patches for this       │
│  version. Governance rules will reflect upgrade pressure.   │
│  Run /pilot-upgrade when ready to plan the migration.       │
└─────────────────────────────────────────────────────────────┘
```

- Any `targetFramework` is `net6.0` or `net7.0`:

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠  EOL STACK DETECTED                                      │
│  net6 (EOL May 2024) / net7 (EOL May 2024)                 │
│  Microsoft no longer issues security patches for this       │
│  version. Governance rules will reflect upgrade pressure.   │
│  Run /pilot-upgrade when ready to plan the migration.       │
└─────────────────────────────────────────────────────────────┘
```

---

## Step 3 — Compact interview

Ask ALL of the following in ONE message block. Do not split into sequential questions.

Include each `unknowns[]` item from the profile as a numbered question.

Then always add these four questions (consolidate into the same block):

```
Please answer the following before we generate your setup:

[From your stack profile — unknowns to resolve:]
<list each unknowns[] item as a numbered question, e.g.:
  1. Zone.js is absent from angular.json polyfills but no zoneless provider was found.
     Is this project going zoneless? (yes / no / not yet)>

[Architecture & team:]
A. Architecture style:
   (a) Clean Architecture  (b) Vertical Slice / VSA  (c) DDD  (d) Modular Monolith
   (e) Other — describe in one line

B. Multi-tenant?
   (a) No  (b) Yes — row-level isolation  (c) Yes — schema-per-tenant
   (d) Yes — database-per-tenant

C. Compliance regime:
   (a) None  (b) GDPR  (c) HIPAA  (d) PCI-DSS  (e) Multiple — list them

D. Team size:
   (a) 1–4  (b) 5–10  (c) 11–25  (d) 25+
```

Wait for the user's reply before proceeding.

---

## Step 4 — Resolve answers

Map the user's letter answers to structured values for use in CLAUDE.md and rule selection:
- Architecture: one of `Clean Architecture`, `Vertical Slice (VSA)`, `DDD`, `Modular Monolith`, or the user's custom description
- multiTenant: `false` or `true` with isolation model string
- compliance: array of strings, e.g. `["GDPR"]` or `[]`
- teamSize: one of `1-4`, `5-10`, `11-25`, `25+`

---

## Step 5 — Generate CLAUDE.md

Write `PROJECT_ROOT/CLAUDE.md`. Hard limit: **100 lines**.

Use this structure (omit any section whose data is entirely null):

```markdown
# <project-name> — Project Setup

## Stack

| Layer    | Technology                         | Version  |
|----------|------------------------------------|----------|
<one row per detected stack: Angular, ASP.NET Core, EF Core, Azure>

## Architecture

- Style: <architecture>
- Multi-tenant: <No | Yes — <isolation model>>
- Compliance: <None | GDPR | HIPAA | PCI-DSS | ...>
- Team size: <range>

## Frontend (Angular <version>)
<Only if angular non-null. Bullets: bootstrap mode, change detection, test runner, signals, SSR, linting.>

## Backend (.NET <version> — <hostingModel>)
<Only if dotnet non-null. Bullets: nullable, implicit usings, key packages with versions, test framework.>

## Database
<Only if sql non-null. Bullets: migrations path, raw SQL files, connection string locations.>

## Azure / Infrastructure
<Only if azure non-null. Bullets: IaC type, CI/CD file, Dockerfiles.>

## Build & Run Commands

\`\`\`bash
<frontend install + serve + test + build commands, if angular non-null>
<backend restore + run + test + ef commands, if dotnet non-null>
\`\`\`

## Governance Rules

Materialized rules → \`.claude/rules/\` (<count> active):
- <comma-separated rule ids>

Full catalog: \`plugins/pilot-core/rules-catalog/\`

## .NET Skills Routing
<Only if dotnet non-null. Copy this section verbatim — do not adjust routing table.>

```markdown
| Task | dotnet/skills skill |
|------|---------------------|
| EF Core performance, query optimization | `dotnet-data` |
| Test running, xUnit, migration testing | `dotnet-test` |
| Framework upgrades, nullable enablement | `dotnet-upgrade` |
| Minimal API endpoints, file upload | `dotnet-aspnetcore` |
| MCP server development in C# | `dotnet-ai` |
```

> Install: `/plugin marketplace add dotnet/skills` then `/plugin install <skill>@dotnet-agent-skills`
> pilot-dotnet covers house conventions, Serilog policy, and resilience policy only.

## Knowledge

- House conventions: `.claude/pilot/knowledge/conventions.md` — load on demand for naming/layout questions
- Session lessons: `.claude/pilot/knowledge/lessons.md` — load on demand for project-specific gotchas

> Run `/fsp-learn` to populate these files. They load on demand — not included in every session.

## Open Questions
<List only items from unknowns[] that the user did NOT resolve in Step 3. Omit if empty.>
```

Rules: no prose explanations, no recipes, no "how-to" text. If a value is unknown, omit the bullet rather than writing "unknown".

---

## Step 6 — Materialize version-gated rules

**Version-gating logic** (evaluate against the confirmed profile):

| `appliesTo` tag | Condition to materialize |
|-----------------|--------------------------|
| `always` | Always |
| `dotnet` | `dotnet` is non-null |
| `dotnet>=8` | Any project `targetFramework` parses to net8, net9, net10, or net11 |
| `dotnet<8` | Any project `targetFramework` parses to net6 or net7 |
| `angular` | `angular` is non-null |
| `angular>=17` | `angular.majorVersion >= 17` |
| `angular<17` | `angular.majorVersion < 17` (i.e. 15 or 16) |
| `sql` | `sql` is non-null |
| `azure` | `azure` is non-null |

For each catalog rule that passes the gate:
1. Copy the full content of `plugins/pilot-core/rules-catalog/<id>.md` into `PROJECT_ROOT/.claude/rules/<id>.md`.
2. Do not modify content — copy verbatim.

After writing all files, print:

```
## Materialized Rules → .claude/rules/

| Rule ID                        | appliesTo    | Severity | Standard          |
|--------------------------------|--------------|----------|-------------------|
<one row per materialized rule>

Skipped (version gate):
<list rule ids that did NOT match, with reason, e.g.: "dotnet-lt8-legacy (dotnet<8 — project is net8.0)">
```

---

## Step 7 — Emit drift detection workflow

Write two files into the user's project:

1. `PROJECT_ROOT/.github/workflows/pilot-drift.yml`
   — copy from `plugins/pilot-core/templates/pilot-drift.yml`
   — replace `{{DEFAULT_BRANCH}}` with the project's default branch
     (run `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'`
      or default to `main` if the command fails)

2. `PROJECT_ROOT/.github/scripts/pilot-drift-check.mjs`
   — copy from `plugins/pilot-core/templates/pilot-drift-check.mjs`
   — create `.github/scripts/` directory if absent

If either file already exists, skip writing and note "(already present)".

---

## Step 8 — Final summary

Print:

```
## Scaffold complete

  CLAUDE.md written          → PROJECT_ROOT/CLAUDE.md  (<N> lines)
  Governance rules written   → PROJECT_ROOT/.claude/rules/  (<N> rules)
  Stack profile              → PROJECT_ROOT/.claude/pilot/stack-profile.json
  Drift workflow written     → PROJECT_ROOT/.github/workflows/pilot-drift.yml

Knowledge files (populated by /fsp-learn):
  → PROJECT_ROOT/.claude/pilot/knowledge/conventions.md  (not yet created)
  → PROJECT_ROOT/.claude/pilot/knowledge/lessons.md      (not yet created)

Next steps:
  • Review and commit CLAUDE.md, .claude/rules/, and .github/workflows/pilot-drift.yml.
  • Run /fsp-learn to populate conventions.md and lessons.md.
  • Run /fsp-init again in any other repo to detect and scaffold that project.
  • When ready to address EOL stacks, run /pilot-upgrade.
```
