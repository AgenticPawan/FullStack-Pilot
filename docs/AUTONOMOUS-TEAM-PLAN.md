# FullStack Pilot — Autonomous Full-Stack Team Plan

Status: **Phases 1–3 implemented** (Phase 1: model matrix, fsp-scout, token rules, CI
enforcement; Phase 2: fsp-analyst, fsp-architect, fsp-qa agents + fullstack-support
routing; Phase 3: /fsp-architect and /fsp-build commands + fsp-build-orchestration
skill with deterministic QA write-scope enforcement — 2026-07-11). Phase 4
(docs/housekeeping: README/per-plugin docs/TROUBLESHOOTING, fixture dry-runs §10) next.
Owner: AgenticPawan. Drafted 2026-07-11.

## 1. Goal

Evolve FullStack Pilot from a governance/review toolkit into a **one-command autonomous
assistant covering the whole delivery team** — Developer, QA, Business Analyst, and
Solution Architect — that can:

1. Find gaps at the solution-architecture level and produce enhancement plans that flow
   directly into implementation.
2. Build a product, module, or feature in one shot using a review-plan-implement loop.
3. Route work to the right model tier — cheap models for reading/understanding,
   expensive models only for planning and complex implementation.
4. Enforce STRICT minimal token usage at every step.

### Platform boundary (honesty note)

A Claude Code plugin cannot schedule itself or act without a session. "Fully
autonomous" here means **one-command autonomous**: the user types one command and the
entire pipeline (spec → plan → implement → review → test → report) runs without further
prompting, pausing only at the pre-agreed hard safety gates (auth changes, destructive
migrations, resource deletion) unless `--yes` waives the soft ones.

## 2. Gap analysis

| # | Requirement | Today | Gap |
|---|---|---|---|
| 1 | Team coverage (Dev/QA/BA/SA) | Developer only: 4× reviewer, 4× implementor, 5× support agents | No BA, no QA, no Solution Architect agent |
| 2 | Architecture gap finding + enhancement plans | Architecture skills exist but review one diff/file at a time; `/fsp-audit` is security-only | No whole-solution assessment walking frontend↔API↔DB↔infra against the target state encoded in the 100+ skills |
| 3 | One-shot feature build | Agents are single-stack, manually chained by the user | No orchestrator that decomposes a feature across SQL→.NET→Angular→Azure and runs plan→implement→review→test end to end |
| 4 | Model tiering | Every agent is `model: sonnet`, `effort: high` | No haiku tier for reading, no opus tier for planning/complex work, no per-invocation override usage |
| 5 | STRICT token economy | Some file-read caps (50 in stack-detection, 60 in audit) | (a) 100+ skill descriptions + 2 oversized plugin.json descriptions load into **every** session; (b) agents hand off via chat instead of files; (c) no enforced read budgets or quoting limits; (d) no CI checks on description size |

Platform capabilities verified against live docs (2026-07-11,
code.claude.com/docs/en/sub-agents.md): agent frontmatter supports
`model: haiku|sonnet|opus|inherit` (+ full model IDs), `effort: low..max`, per-invocation
`model` parameter override, `memory: user|project|local`, `skills` preloading, and
`disable-model-invocation` on skills. Subagents cannot spawn subagents, so orchestration
lives in commands executed by the main session.

## 3. Model matrix (the tiering policy)

| Tier | Model | Effort | Used for | Agents |
|---|---|---|---|---|
| T1 Read/understand | `haiku` | low–medium | Context scouting, file inventory, doc lookup, symptom intake | `fsp-scout` (new) |
| T2 Analyze/review | `sonnet` | medium | Checklist review, support diagnosis, spec writing, test generation | all `*-reviewer` (effort drops high→medium), all `*-support`, `fsp-analyst` (new), `fsp-qa` (new) |
| T3 Plan/complex implement | `opus` | high | Architecture assessment, feature decomposition, complex implementation | `fsp-architect` (new); `*-implementor` via per-invocation override |

Implementor rule: frontmatter stays `model: inherit`. The orchestrating command passes
`model: opus` per invocation **only** for work items the plan marks `complexity: high`;
everything mechanical runs on `sonnet`. This is cheaper than hardcoding opus and smarter
than hardcoding sonnet.

Fallback rule: if an org `availableModels` allowlist excludes a tier's model, Claude Code
silently falls back to the inherited model (documented behavior) — the pipeline still
works, just without the savings.

## 4. STRICT token rules (written into every agent + enforced in CI where possible)

1. **File handoffs, not chat handoffs.** Every pipeline artifact is a file under
   `.claude/pilot/` (specs, briefs, plans, summaries). Downstream agents read the file;
   nobody re-pastes content into conversation.
2. **Read budgets per agent**, declared in frontmatter-adjacent prose and honored:
   scout ≤80 files (headers/signatures only, never whole large files); implementors read
   only finding-implicated files + direct pairs; architect reads **briefs**, not source;
   QA reads spec + implementation summaries + test files only.
3. **Quoting cap:** no agent report quotes more than 10 lines of source per finding.
4. **Briefs are bounded:** scout briefs ≤150 lines; specs ≤2 pages; plan ≤1 page per
   work item.
5. **Shrink the always-on cost:**
   - Rewrite `pilot-dotnet` (~2,000 chars) and `pilot-angular` plugin.json descriptions
     to ≤600 chars (they enumerate every skill — pointless duplication; the skills carry
     their own descriptions).
   - Audit all SKILL.md descriptions; target ≤500 chars each (hard cap stays 1024).
   - ~~Mark orchestration-only skills `disable-model-invocation: true`~~ **DROPPED
     (2026-07-11)**: verified against code.claude.com/docs/en/skills.md that
     `disable-model-invocation: true` makes a skill user-invocable ONLY — Claude cannot
     run it via the Skill tool even inside a user-triggered command, which would break
     /fsp-init, /fsp-audit, /fsp-fix, and /fsp-learn (their command files instruct
     Claude to run these skills). The description-length budgets deliver the savings
     instead. Exception: the future `fsp-build-orchestration` skill may use
     `user-invocable: false` (the inverse flag) since only Claude should run it.
6. **Scout memory:** `fsp-scout` gets `memory: project` so repeat explorations of the
   same codebase get cheaper over time instead of re-reading.
7. **CI enforcement** (validate.mjs): plugin description ≤600 chars (fail), skill
   description+when_to_use >500 chars (warn) / >1024 (fail, exists), agent model-tier
   policy (§8).

## 5. New agents (all in pilot-core unless noted)

### 5.1 `fsp-scout` — T1, the token-saving workhorse
- `model: haiku`, `effort: medium`, read-only (`disallowedTools: Write, Edit` **except**
  its output directory — see note), `memory: project`, `maxTurns: 15`.
- Input: a scope ("orders feature", "whole solution", "the Angular app").
- Output: `.claude/pilot/context/<scope-slug>.md` — file map, key types/interfaces,
  patterns in use (auth style, error shape, state management), relevant
  stack-profile facts, ≤150 lines.
- Note: support agents' read-only rule is enforced by convention + validator suffix
  match; scout writes only briefs. Validator rule for scout: name-based exception
  requiring `model: haiku` (§8).

### 5.2 `fsp-analyst` — T2, the Business Analyst
- `model: sonnet`, `effort: medium`, read-only, `maxTurns: 15`.
- Input: a raw feature ask, an issue, or a stakeholder description.
- Output: `.claude/pilot/specs/<feature>.md` — user stories, Given/When/Then acceptance
  criteria, edge cases, data/permission implications (flags anything touching the
  permissions-ONLY auth model), out-of-scope list, open questions. ≤2 pages.
- Behavior: asks clarifying questions **once, batched** (token rule), then commits to
  the spec. Open questions it can't resolve are listed in the spec, not blocking.

### 5.3 `fsp-architect` — T3, the Solution Architect
- `model: opus`, `effort: high`, read-only, `memory: project`, `maxTurns: 25`.
- Two modes:
  - **Assess** (used by `/fsp-architect`): consumes scout briefs + stack-profile +
    existing `AUDIT-REPORT.md` if present; evaluates the solution against the target
    state encoded in existing skills (clean-architecture boundaries, api-design-standards
    contract coherence, resilience/observability posture, WAF pillars, SLO wiring,
    outbox/saga usage where messaging exists). Output:
    `.claude/pilot/architecture/ASSESSMENT.md` — gaps ranked by risk×value, each with:
    what/why, governing standard IDs, affected components, effort estimate (S/M/L),
    and a ready-to-run `/fsp-build` line. Also drafts ADR stubs per
    `architecture-decision-records` for decisions the assessment surfaces.
  - **Plan** (used by `/fsp-build` step 3): decomposes a spec into ordered work items
    (SQL schema → .NET domain/app/API → Angular → infra), each with: owning implementor,
    `complexity: high|normal` (drives the model override), governing standard IDs,
    files expected to change, and verification command. Output:
    `.claude/pilot/builds/<feature>/PLAN.md`.

### 5.4 `fsp-qa` — T2, the QA engineer
- `model: sonnet`, `effort: medium`, `maxTurns: 25`. Write access **limited by prompt
  contract to test projects/specs only** (`tests/**`, `*.spec.ts`, `*Tests.cs`) — it
  never touches product code; product changes go back to the implementor.
- Input: spec acceptance criteria + implementation summaries.
- Work: generates/extends tests per `dotnet-testing`/`angular-testing` conventions,
  runs them, uses Playwright MCP for e2e when the app is runnable.
- Output: `.claude/pilot/builds/<feature>/QA-REPORT.md` — traceability table
  (acceptance criterion → test → pass/fail), defects routed back as findings for the
  owning implementor.

## 6. New commands

### 6.1 `/fsp-architect [--scope <area>] [--refresh]`
1. Scout the scope (haiku) — reuse existing briefs unless `--refresh`.
2. Architect assess (opus).
3. Print the top-gaps table in chat (IDs, severity, one-liner, effort); full detail
   only in `ASSESSMENT.md` (token rule: chat gets the summary, disk gets the depth).

### 6.2 `/fsp-build <feature | spec-file | ASSESSMENT item-id> [--yes] [--max-files <n>]`
The one-shot review-plan-implement pipeline, orchestrated by the main session:

| Step | Actor | Model | Output |
|---|---|---|---|
| 1 Specify | fsp-analyst | sonnet | `specs/<feature>.md` (skipped if given a spec) |
| 2 Scout | fsp-scout | haiku | `context/*.md` briefs per affected stack |
| 3 Plan | fsp-architect | opus | `builds/<feature>/PLAN.md` |
| 4 Gate | user | — | plan summary printed; proceed on confirm (or `--yes`; hard gates never waived) |
| 5 Implement | stack implementors | sonnet / opus (per item complexity) | edits on branch `pilot/build-<feature>`, each verified with its build tool |
| 6 Review | paired stack reviewers | sonnet (effort medium) | findings on the diff only; implementor fixes; **max 2 loops** then escalate to user |
| 7 Test | fsp-qa | sonnet | `QA-REPORT.md` traceability |
| 8 Report | orchestrator | — | `builds/<feature>/SUMMARY.md`; branch left unmerged |

Failure policy: a step that fails after its internal retries stops the pipeline with a
written state file (`builds/<feature>/STATE.json`) so `/fsp-build --resume <feature>`
can continue instead of restarting (token rule: never re-pay completed steps).

Hard safety gates (never waived by `--yes`): `[Authorize]`/policy changes, public API
contract changes, destructive migrations, resource deletion/RBAC/network loosening —
same gates the implementors already enforce.

Skill: `fsp-build-orchestration` (pilot-core, `disable-model-invocation: true`) holds
the detailed step logic so the command file stays short.

### 6.3 Existing agent updates
- All 4 reviewers: `effort: high` → `medium`; add "diff-scope only when invoked by
  /fsp-build" and the 10-line quoting cap.
- All 4 implementors: keep `model` unset (= inherit) so per-invocation override works;
  add "read the scout brief before reading source" and read-budget language.
- All 5 support agents: add "read the scout brief if present" + quoting cap.
- `fullstack-support`: add routing to the new roles (feature ask → fsp-analyst;
  architecture concern → fsp-architect).

## 7. Files to create/modify

New (10):
- `plugins/pilot-core/agents/fsp-scout.md`, `fsp-analyst.md`, `fsp-architect.md`, `fsp-qa.md`
- `plugins/pilot-core/commands/fsp-architect.md`, `fsp-build.md`
- `plugins/pilot-core/skills/fsp-build-orchestration/SKILL.md`
- `docs/` additions: this plan graduates into `docs/pilot-core.md` sections + README section
- `.claude/pilot/` output conventions documented in CLAUDE.md
- validator: new checks in `scripts/validate.mjs`

Modified (~20):
- 13 existing agent files (effort/token-rule edits)
- `plugins/pilot-dotnet|pilot-angular/.claude-plugin/plugin.json` (description shrink)
- Long SKILL.md descriptions (audit pass, ~top 10 offenders)
- `scripts/validate.mjs`, `CLAUDE.md`, `README.md`, per-plugin docs,
  `docs/TROUBLESHOOTING.md`, `CHANGELOG.md`, marketplace.json (versions/descriptions)

## 8. validate.mjs new checks

1. Plugin description length: fail >600 chars.
2. Skill description+when_to_use: warn >500 (fail >1024 exists).
3. Model-tier policy by agent name:
   - `fsp-scout` must declare `model: haiku`.
   - `fsp-architect` must declare `model: opus`.
   - `*-implementor` must NOT hardcode a model (inherit required for per-invocation override).
   - `*-reviewer`/`*-support`/`fsp-analyst`/`fsp-qa` must declare `model: sonnet` or omit.
4. Agent read-budget presence: agent body must contain a "Read budget" line (cheap
   grep-level check; keeps the rule visible, not just tribal).

## 9. Commit plan (conventional, one concern per commit)

1. `chore(pilot-dotnet,pilot-angular): shrink plugin descriptions to cut per-session token cost`
2. `feat(pilot-core): add fsp-scout context agent (haiku tier)`
3. `feat(pilot-core): add fsp-analyst BA agent`
4. `feat(pilot-core): add fsp-architect solution-architect agent (opus tier)`
5. `feat(pilot-core): add fsp-qa test agent`
6. `feat(pilot-core): add /fsp-architect assessment command`
7. `feat(pilot-core): add /fsp-build one-shot pipeline command + orchestration skill`
8. `refactor: apply model matrix and token rules to existing 13 agents`
9. `ci: enforce model-tier policy and description budgets in validate.mjs`
10. `docs: document the autonomous team workflow` + `chore: bump versions`

## 10. Verification

- `node scripts/validate.mjs` exits 0; negative-test each new check.
- Dry-run `/fsp-architect` against `tests/fixtures/mixed-fullstack` — assessment must
  cite real fixture files and produce ≥3 plausible gaps with `/fsp-build` lines.
- Dry-run `/fsp-build` with a small feature against `tests/fixtures/net8-minimal-api`
  (e.g. "add a health-detail endpoint") — pipeline must produce spec, plan, branch,
  diff, QA report; branch must build.
- Token spot-check: compare a `/fsp-build` transcript's context usage with and without
  scout briefs (expectation: implementor turns shrink measurably).
- New-session cost check: `claude plugin usage` (or token report) before/after the
  description shrink.

## 11. Open questions — DECIDED 2026-07-11

1. **QA write scope** — AMENDED during Phase 2 (2026-07-11): the hook approach is
   impossible — sub-agents docs state plugin subagents' `hooks` frontmatter is
   **ignored for security reasons**. Replaced with something stronger:
   **deterministic pipeline enforcement** — `/fsp-build` (Phase 3) runs
   `git diff --name-only` after the QA step and rejects/reverts any change outside
   the test-path allowlist. The fsp-qa prompt carries the same allowlist as a hard
   contract with a pre-write self-check, and the reviewer diff re-check remains the
   third net.
2. **Opus fallback visibility** — DECIDED: yes; `fsp-architect` prints the model it
   actually resolved to in the assessment/plan header (one line).
3. **Review loop cap** — DECIDED: keep 2. Findings surviving two implement-review
   loops indicate a plan-level problem, not a code-level one; the escalation message
   must include both the reviewer's finding and the implementor's position.
4. **Scout write exception** — DECIDED: confirmed as implemented; `fsp-scout` writes
   only briefs/memory, and the validator's read-only rule keys on the
   `-reviewer`/`-support` suffixes, which scout doesn't match.
5. **Description budget** — DECIDED (quality-first): warn threshold raised 500→800.
   Descriptions are the skill-routing signal; compressing all 116 to 500 would trade
   invocation quality for marginal savings. The 32 files >800 were trimmed
   (description prose only — `when_to_use` keyword lists untouched). Reviewers were
   also reverted `effort: medium`→`high`: review depth is the product; token savings
   come from scope rules (diff-only, scout briefs, quoting caps), not shallower
   reasoning. Every agent additionally carries a quality-guard rule: budgets bound
   exploration, not quality — on budget exhaustion, report what's missing instead of
   returning a degraded result.
6. **Command-internal skills** — DECIDED: `stack-detection`, `audit-orchestration`,
   `batched-remediation`, `convention-learner` now carry `user-invocable: false`
   (hidden from the user's /-menu; Skill-tool invocation by commands unaffected).
   `pilot-scaffold` and `mcp-discovery` stay user-invocable — their docs advertise
   direct invocation.
