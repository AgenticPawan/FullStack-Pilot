# pilot-core

Shared governance utilities every other pilot plugin depends on. Install this first.

## Commands

| Command | Purpose |
|---|---|
| `/fsp-init` | Detects your stack (`stack-detection` skill), confirms with you, then scaffolds `CLAUDE.md` and `.claude/rules/` (`pilot-scaffold` skill). Phase 3 wires `dotnet/skills` for .NET projects; Phase 4 runs MCP discovery. |
| `/fsp-audit` | Runs the `audit-orchestration` skill: available scanners + a bounded Claude semantic pass, normalized into `.claude/pilot/audit/findings.json` and `AUDIT-REPORT.md`. |
| `/fsp-fix --batch <tier>` | Runs the `batched-remediation` skill: fixes one severity tier (`P0`–`P3`) at a time on its own branch, verifies with a build, rolls back on regression. |
| `/fsp-learn [--conventions] [--lessons] [--diff-only]` | Distills durable, project-specific knowledge from the session into `conventions.md` / `lessons.md`. Never runs git; you review and commit. |
| `/fsp-architect [--scope <area>] [--refresh]` | Whole-solution architecture assessment: scout briefs feed `fsp-architect`'s Assess mode; you get a ranked gap register in chat and per-gap enhancement plans (each with a ready-to-run `/fsp-build` line) in `.claude/pilot/architecture/ASSESSMENT.md`. |
| `/fsp-build <feature \| spec-file \| GAP-id> [--yes] [--max-files <n>] [--resume <slug>]` | One-shot delivery pipeline (`fsp-build-orchestration` skill): spec → scout → plan → your confirmation → implement → review → test → summary, all on branch `pilot/build-<feature>` — never merged for you. |

## The autonomous delivery team

Four `fsp-` agents cover the roles around the stack specialists, each pinned to the
cheapest model tier that can do its job (CI-enforced — see the model matrix in
[CLAUDE.md](../CLAUDE.md)):

| Agent | Tier | Role | Deliverable |
|---|---|---|---|
| `@fsp-scout` | T1 haiku | Explores a scope within a strict read budget so expensive agents never re-read source | `.claude/pilot/context/<scope>.md` brief (≤150 lines) |
| `@fsp-analyst` | T2 sonnet | Business Analyst: turns a raw ask into a bounded, testable spec; one batched clarification round | `.claude/pilot/specs/<feature>.md` (US-n stories, AC-n criteria) |
| `@fsp-architect` | T3 opus | Solution Architect: Assess (whole-solution gap register) and Plan (spec → complexity-tagged work items) modes; prints the model it actually resolved to | `architecture/ASSESSMENT.md` / `builds/<feature>/PLAN.md` |
| `@fsp-qa` | T2 sonnet | QA: traces every AC-n to a test it saw pass; writes tests only — product defects route back to the owning implementor | `builds/<feature>/QA-REPORT.md` traceability |

All handoffs are **files under `.claude/pilot/`, never chat** — downstream agents get
paths. Each agent can be invoked directly (`@fsp-analyst customers need invoice
splitting`), but they're designed to run as a pipeline via `/fsp-build`:

```
> /fsp-build "customers can split an invoice across two payment methods"
  1 spec    → .claude/pilot/specs/invoice-split.md         (fsp-analyst, sonnet)
  2 scout   → .claude/pilot/context/*.md                   (fsp-scout, haiku, reused if fresh)
  3 plan    → .claude/pilot/builds/invoice-split/PLAN.md   (fsp-architect, opus)
  4 gate    → plan summary printed; you confirm (--yes skips this, never the hard gates)
  5 build   → branch pilot/build-invoice-split             (implementors; opus only for complexity-high items)
  6 review  → paired reviewers on the diff; max 2 fix loops, then escalation
  7 test    → QA-REPORT.md; non-test writes from QA are detected via git diff and reverted
  8 report  → SUMMARY.md; the branch is yours to review and merge
```

Every step checkpoints `builds/<feature>/STATE.json`, so a stopped run continues with
`/fsp-build --resume <feature>` without re-paying completed steps.

## Agents (triage)

- **fullstack-support** — first-line product-support triage. When something is broken
  and you don't know which layer owns it (frontend? backend? database? Azure?), invoke
  `@fullstack-support <describe the symptom>`. It classifies the symptom with quick
  read-only evidence checks, rules layers out, and hands off to the right specialist —
  `@angular-support`, `@dotnet-support`, `@sql-support`, or `@azure-support` — with a
  structured handoff so you don't repeat yourself. Production-down or data-integrity
  symptoms get flagged urgent per the `incident-response-runbook` skill; suspected
  security incidents get a `/fsp-audit` recommendation alongside the diagnosis.

Usage example:

```
> @fullstack-support checkout has been failing for some users since this morning
  … triage: ProblemDetails 500 in the network tab → backend owns it …
  ## Triage Handoff → @dotnet-support
```

The stack-specific reviewer/implementor/support trios live in the other four plugins —
see the [root README](../README.md#agents--review-implement-support) for the full
roster and workflow examples.

## Skills

- **stack-detection** — evidence-based Angular/.NET/SQL Server/Azure detector. Every
  conclusion cites a file path. Writes `.claude/pilot/stack-profile.json`.
- **pilot-scaffold** — Phase 2 of `/fsp-init`: interview + `CLAUDE.md` generation
  (hard 100-line limit) + rules materialization from `rules-catalog/`.
- **audit-orchestration** — scanner orchestration + semantic triage for `/fsp-audit`.
- **batched-remediation** — branch-per-tier fix pipeline for `/fsp-fix`.
- **convention-learner** — used by `/fsp-learn --conventions`.
- **fsp-build-orchestration** — the `/fsp-build` pipeline engine (Step 0–8 logic,
  STATE.json checkpointing, hard safety gates, the deterministic QA write-scope check).
  Internal: invoked by the command, hidden from the `/`-menu.
- **mcp-discovery** — scans your dependency graph for companion MCP servers and proposes
  them; never auto-registers a server without per-server consent.
- **dependency-supply-chain** — the policy layer over `audit-orchestration`'s raw dotnet/npm
  vulnerability scan output: severity-to-patch-cadence SLA, version-pinning discipline,
  private-feed/allow-list policy, SBOM generation for release artifacts.
- **incident-response-runbook** — the response layer over `azure-observability`'s alerts:
  runbook-per-alert convention, severity-to-response-time SLA, blameless-postmortem
  template, tracked action-item follow-through.
- **dependency-license-compliance** — the legal-compliance sibling to
  `dependency-supply-chain`'s security-vulnerability scanning: OSS license scanning,
  copyleft (GPL/AGPL) risk review, a documented license allow-list/deny-list policy,
  license metadata in the SBOM.
- **test-data-management** — closes the gap `dotnet-data-protection`/`sql-data-protection`
  leave open if a raw prod backup is restored into a less-protected environment:
  anonymization/masking for prod-to-lower-environment refreshes, synthetic-data seeding
  as a lighter-weight alternative, and a documented policy for what's safe to copy at all.

## Hooks

`hooks/hooks.json` registers three matcher-scoped hooks on `Write|Edit`:

| Hook | Event | Purpose |
|---|---|---|
| `secret-guard.js` | PreToolUse | Blocks writes that look like they contain hardcoded secrets |
| `dangerous-patterns.js` | PreToolUse | Blocks known-dangerous patterns (see `rules-catalog/`) |
| `formatter.js` | PostToolUse | Normalizes formatting after a write |

## Rules catalog

`rules-catalog/` holds the version-gated rules `pilot-scaffold` materializes into a
project's `.claude/rules/` based on the confirmed stack profile — e.g.
`angular-gte17-control-flow.md` only applies if Angular ≥17 was detected,
`angular-lt17-ngmodule.md` only if <17.

## MCP servers

`pilot-core` bundles five MCP servers in `.mcp.json` (GitHub, Microsoft Learn,
Playwright, Azure, SQL/DAB). See [mcp-setup.md](../plugins/pilot-core/docs/mcp-setup.md)
for required environment variables and per-server prerequisites.
