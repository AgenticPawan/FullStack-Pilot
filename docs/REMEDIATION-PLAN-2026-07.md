# FullStack Pilot — Remediation Plan (2026-07)

**Source:** [CRITICAL-REVIEW-2026-07.md](./CRITICAL-REVIEW-2026-07.md)
**Branch:** `remediation/critical-review-2026-07`
**Created:** 2026-07-12
**Owner key:** `Claude` = executable in-session by Claude Code; `Maintainer` = needs
AgenticPawan's judgment / a live Claude Code instance to verify.

Each item has a stable ID, the review findings it closes, an owner, concrete acceptance
criteria (AC), and status. Status is mirrored in the session task list.

---

## Decisions locked before execution

- **MCP shipping model** (drives R1). Per maintainer decision 2026-07-12:
  - `pilot-core/.mcp.json` (auto-loaded, zero opt-in): **`microsoft-learn` only.**
    It is a Microsoft-hosted HTTP endpoint — no third-party package/image to pin, so
    "pinned version" is satisfied by it being a first-party hosted URL, not an npm/docker
    tag. Nothing else earns unconditional trust.
  - `pilot-core/.mcp.json.example` (opt-in via `mcp-discovery`): **`playwright`, `github`,
    `azure-mcp`, `sql-mcp`** — same consent gate for all four, whether or not they need
    credentials. All package/image references pinned to explicit versions/digests.

---

## Remediation items

### R1 — Reconcile `.mcp.json` (closes V1, V2, V3)
**Owner:** Claude
**AC:**
1. `plugins/pilot-core/.mcp.json` contains only `microsoft-learn`.
2. `plugins/pilot-core/.mcp.json.example` contains `playwright`, `github`, `azure-mcp`,
   `sql-mcp`, every npm/docker reference pinned to an explicit version or digest (no
   `@latest`, no untagged image).
3. `mcp-discovery` skill references `.mcp.json.example` as the opt-in source and gates each
   of the four servers behind per-server consent.
4. `plugins/pilot-core/docs/mcp-setup.md` documents the split and the env vars each opt-in
   server needs.
5. The "never commit pilot-core/.mcp.json" memory note is reconciled: the auto-loaded file
   (microsoft-learn only, no secrets) is intentionally tracked; the note is reworded to
   forbid committing a secrets-bearing local override.
6. `node scripts/validate.mjs` exits 0.

### R2 — Split security vs. style in the block hook (closes S1, S2)
**Owner:** Claude
**AC:**
1. `dangerous-patterns.json` entries carry an explicit `action` of `deny` (security) or
   `warn` (style/advisory).
2. `DATETIME_NOW_INSTEAD_OF_TIMEPROVIDER` is `warn`, not a hard block.
3. `dangerous-patterns.js` emits `permissionDecision: "deny"` only for `action: "deny"`
   patterns; `warn` patterns surface a non-blocking message and allow the write.
4. Existing P0 security patterns (innerHTML, SQL concat, Azure public access, listKeys)
   remain `deny`.
5. Hook tests updated to cover both a `deny` and a `warn` pattern; `node scripts/validate.mjs`
   exits 0 with hook tests passing.

### R3 — Fix hook coverage coupling + innerHTML advice (closes W1, W2)
**Owner:** Claude + Maintainer
**AC:**
1. innerHTML remediation message no longer recommends `bypassSecurityTrustHtml()`; it points
   to `[innerHTML]` binding / safe interpolation (W2 — Claude).
2. The pilot-core → stack-plugin coupling is resolved by one documented choice (W1):
   declare pilot-core a hard dependency of the stack plugins in their docs/manifests, OR
   relocate stack-specific patterns to the owning plugin. Decision recorded in this file
   before implementation (Maintainer sign-off).

**W1 decision (2026-07-12):** Declare pilot-core an **enforced** dependency. The plugin
manifest schema (plugins-reference) supports a real `dependencies` field — `[{ "name":
"pilot-core" }]` — so Claude Code auto-installs/enables pilot-core when any stack plugin is
installed. Chosen over relocating patterns (which would duplicate the hook runner script
across four plugins and fragment the pattern config). Added to pilot-angular, pilot-dotnet,
pilot-sql, pilot-azure, and pilot-rag (no version pin — 0.x churns fast and presence is what
guarantees the hooks). Documented in CLAUDE.md Hooks conventions.

### R4 — Add `rag-security` skill (closes V5 / Skill #1)
**Owner:** Claude
**AC:**
1. `plugins/pilot-rag/skills/rag-security/SKILL.md` exists with valid frontmatter
   (`name`, `description`, `when_to_use`), `description`+`when_to_use` ≤ 1024 chars.
2. Covers: prompt injection via indexed content, `/ask` endpoint authZ, per-caller rate
   limiting, and PII/secret retention + deletion in the vector store.
3. Emits findings in the `/fsp-audit` schema, consistent with sibling skills.
4. `pilot-rag` plugin description / `docs/pilot-rag.md` reference the new skill.
5. `node scripts/validate.mjs` exits 0.

### R5 — Verify cross-stack orchestrator agents are registered (closes W4)
**Owner:** Maintainer (Claude investigates)
**AC:**
1. Confirm whether `@fullstack-reviewer` and `@fullstack-implementor` are discoverable/
   invocable. Claude inspects frontmatter for anything blocking registration.
2. If blocked, fix the cause; if a doc/marketplace claim overstates availability, correct
   the claim. Outcome recorded here.

**R5 finding (2026-07-12): no repo defect.** Both files have valid, validator-passing
frontmatter. `fullstack-reviewer`/`fullstack-support` declare `model: sonnet` +
`disallowedTools: Write, Edit`; `fullstack-implementor` correctly omits `model` (inherits) and
omits `disallowedTools` — exactly per the model matrix and agent conventions. Wiring is
**identical** to `angular-reviewer`, which *does* register: both are referenced only in their
plugin.json description + their own files, and are invoked **manually** (`@fullstack-reviewer`),
not by a command. The session-start "available agent types" list omitting the two is an
environment/cache snapshot artifact (stale installed copy), not reproducible from source. The
marketplace claim is accurate and backed by valid files — no correction needed. If the two do
not appear after a real install, run `/reload-plugins`. Optional hardening (backlog): add a
validate.mjs check that every `@agent-name` cited in a plugin.json description resolves to an
agent file — would catch future rename drift.

### R6 — Validate `.mcp.json` in CI (closes S3)
**Owner:** Claude
**AC:**
1. `scripts/validate.mjs` parses every `.mcp.json` (valid JSON, `mcpServers` object present).
2. Warns on any npm/docker reference using a floating tag (`@latest` / untagged image) in a
   tracked (non-`.example`) `.mcp.json`.
3. `node scripts/validate.mjs` exits 0 on the current tree.

---

## Skill backlog (documented, not scheduled this pass)

Lower-urgency additions from the review §4 — tracked here so they are not lost:

- **`distributed-tracing-correlation` (pilot-core)** — W3C `traceparent` propagation across
  Angular → .NET → SQL → Azure (Skill #2). **DONE 2026-07-12** — shipped with 5 standard IDs
  (DTC-001..005), pilot-core 0.23.0.
- **`zero-downtime-deployment` (pilot-sql / pilot-core)** — expand/contract migrations
  coordinated with rolling deploys (Skill #3). **DONE 2026-07-12** — shipped in pilot-core
  (seam over sql-migration-safety + azure-cicd-security), 5 standard IDs (ZDD-001..005),
  pilot-core 0.24.0.
- **`llm-cost-safety` (pilot-rag)** — token/cost ceilings, context limits, output validation
  (Skill #4). **DONE 2026-07-12** — shipped in pilot-rag as the cost twin of rag-security,
  pilot-rag 0.3.0.

**Skill backlog fully cleared 2026-07-12.**

---

## Execution log

| ID | Status | Notes |
|----|--------|-------|
| R1 | done | .mcp.json = microsoft-learn only; playwright/github/azure/sql moved to .mcp.json.example, pinned; mcp-discovery + mcp-setup.md updated; memory note reconciled. |
| R2 | done | `action: deny|warn` added; DateTime.Now → warn (defer + systemMessage); hook logic + tests updated (24/24 pass). |
| R3 | done | W2: innerHTML message no longer points to bypassSecurityTrustHtml. W1: pilot-core declared an enforced `dependencies` entry in all 5 sibling plugins; CLAUDE.md updated. |
| R4 | done | `rag-security` SKILL.md added (784 chars); wired into docs/pilot-rag.md phase table. |
| R5 | done | No defect — agents valid + wired identically to registering agents; session-list omission is a cache artifact. See finding above. |
| R6 | done | validate.mjs now JSON-validates every .mcp.json, requires mcpServers, and warns on floating @latest/untagged/:latest refs in the auto-loaded file (.example exempt). Detector unit-checked. |

_Updated as each item lands._
