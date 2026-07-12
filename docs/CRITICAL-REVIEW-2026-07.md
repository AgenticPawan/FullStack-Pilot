# FullStack Pilot — Critical Review (2026-07)

**Reviewer stance:** adversarial plugin review + AI/plugin-engineering audit.
**Date:** 2026-07-12
**Scope:** all six plugins (pilot-core, pilot-angular, pilot-dotnet, pilot-sql,
pilot-azure, pilot-rag), the hook perimeter, the MCP wiring, `scripts/validate.mjs`,
and the marketplace catalog.
**Method:** evidence-based — every finding cites `file:line` or a verifiable git fact.

---

## Verdict

The **content** is strong: a deep skill catalog, a real and passing CI validator, disciplined
CI-enforced agent role separation (reviewer / implementor / support), and textbook-correct
security skills (e.g. `sql-injection-defense`). The **problem** is that the product violates
several of its own governance principles, and the security perimeter (the hooks) has
calibration and coverage holes. A governance tool that does not follow its own rules loses
authority — that is the first thing to fix.

**Priority order for remediation**

1. Reconcile `pilot-core/.mcp.json` — consent + version pinning + tracking decision (V1–V3).
2. Split the block hook's security patterns from style patterns (S1–S2) so users stop
   disabling the P0 gate.
3. Move stack-specific hook patterns into their stack plugins, or declare pilot-core a hard
   dependency (W1).
4. Add `rag-security` before pilot-rag gets real adoption (V5 / Skill #1).

---

## 1. Vulnerabilities / security issues

### V1 — `.mcp.json` auto-registers 5 third-party servers with zero consent
**File:** `plugins/pilot-core/.mcp.json:1-36`
The `mcp-discovery` skill's own description states it *"Never auto-registers third-party
servers… writes approved entries only after explicit per-server user consent."* Installing
pilot-core silently wires up `github` (docker), `azure-mcp`, `playwright`, `sql-mcp` (dab),
and `microsoft-learn` — no consent, no risk note. The plugin does the exact thing it lectures
users against.
**Fix:** ship these commented-out / as `.mcp.json.example`, or route them through the consent
flow `mcp-discovery` already defines.

### V2 — Every MCP server is pinned to a floating tag
**File:** `plugins/pilot-core/.mcp.json` (`@playwright/mcp@latest`, `@azure/mcp@latest`,
`ghcr.io/github/github-mcp-server` with no digest)
The `dependency-supply-chain` skill demands version pinning and forbids floating ranges. This
manifest violates it. A compromised upstream release executes on the user's machine with their
Azure/GitHub credentials on the next session start.
**Fix:** pin to explicit versions / image digests.

### V3 — The file is git-tracked, against the project's own recorded decision
**Evidence:** `git ls-files` lists `plugins/pilot-core/.mcp.json`; it is **not** in
`.gitignore`. Project memory records *"never commit pilot-core/.mcp.json."*
**Fix:** reconcile. If plugins must ship a bundled MCP manifest for distribution, update the
memory / CLAUDE.md to say so; otherwise untrack it.

### V4 — `secret-guard.js` fails open and only fires on `Write|Edit`
**Files:** `plugins/pilot-core/hooks/scripts/secret-guard.js:47,63-69`;
`plugins/pilot-core/hooks/hooks.json:5`
The guard `process.exit(0)` on any parse error (bypassable by any input that trips the JSON
parse) and never sees `Bash` — `echo "AKIA…" >> .env` or a `git commit` writes a secret with
the guard blind. Acceptable as defense-in-depth, but it must not be marketed as a control it
isn't.
**Fix:** document the real threat model ("catches accidental literals in file writes; not a DLP
boundary"); consider a `Bash` matcher for the obvious `echo/cat >` cases.

### V5 — No `rag-security` governance for a plugin that ships a live `/ask` endpoint
**Plugin:** pilot-rag
It scaffolds an SSE `/ask` endpoint over the user's own source with vector storage. Ingestion-
time secret redaction exists (good), but nothing governs prompt injection via indexed
code/comments, authZ on `/ask`, rate limiting, or PII in the embedding store. The only plugin
with real runtime attack surface has the least security coverage. (See §4, Skill #1.)

---

## 2. Resources not wired properly

### W1 — The security hooks live only in pilot-core
**File:** `plugins/pilot-core/hooks/config/dangerous-patterns.json`
`UNSAFE_INNERHTML_ASSIGNMENT`, `SQL_STRING_CONCATENATION`, and the Azure blob rules all live in
pilot-core. Installing only `pilot-angular` → no innerHTML guard; only `pilot-sql` → no
SQL-concat guard. Every "security hook" silently depends on pilot-core being installed.
**Fix:** declare pilot-core a hard dependency of the stack plugins, or move stack-specific
patterns into the stack plugins.

### W2 — The innerHTML message recommends the escape hatch the plugin forbids
**File:** `plugins/pilot-core/hooks/config/dangerous-patterns.json:9`
It tells the user to use `DomSanitizer.bypassSecurityTrustHtml()` — the exact call
`rules-catalog/angular-no-bypass-without-comment.md` treats as the dangerous bypass.
**Fix:** point to safe interpolation / `[innerHTML]` binding, not the bypass.

### W3 — Hard runtime dependencies with no graceful degradation
**File:** `plugins/pilot-core/.mcp.json`
Requires `docker`, `dab`, and `npx` on PATH. On a machine without Docker the `github` server
fails to launch **every session**, producing noise the user did not opt into.
**Fix:** degrade quietly; make heavyweight servers opt-in.

### W4 — `fullstack-reviewer` / `fullstack-implementor` shipped but not surfaced
**Files:** `plugins/pilot-core/agents/fullstack-reviewer.md`,
`plugins/pilot-core/agents/fullstack-implementor.md`
Both files exist, but only `fullstack-support` appears in the registered agent list. The
cross-stack orchestration claim in the marketplace description depends on these being
discoverable.
**Fix:** verify `@fullstack-reviewer` / `@fullstack-implementor` are actually registered and
invocable; if not, wire them or drop the claim.

---

## 3. Development standards not followed

### S1 — Severity mis-calibration in the block hook
**File:** `plugins/pilot-core/hooks/config/dangerous-patterns.json:19-27`
`DateTime.Now` on net8 is a hard PreToolUse `deny` — the same severity as public blob access
and leaked storage keys. Blocking a file write over a testability preference trains users to
disable the whole hook, which then also kills the real P0 security patterns.
**Fix:** split "block" (security) from "warn" (style). Style opinions belong in reviewer
findings, not a security-grade gate.

### S2 — Regex on raw content produces false positives
**File:** `plugins/pilot-core/hooks/config/dangerous-patterns.json`
`\bDateTime\.Now\b` and the SQL-concat pattern match inside comments and string literals (no
lexing). The plugin's own reviewer skills would flag this heuristic in a contributor's PR.
**Fix:** hold the hooks to the standard the skills preach, or explicitly scope them as
best-effort and never `deny` on them.

### S3 — CLAUDE.md's "re-fetch live docs before any schema change" is unverifiable and at risk
**File:** `plugins/pilot-core/.mcp.json` uses `"type": "http"` and a bundled-manifest shape —
exactly the schema surface CLAUDE.md says to re-validate against `plugins-reference.md` before
shipping. `scripts/validate.mjs` does not check `.mcp.json` at all.
**Fix:** add `.mcp.json` validation to `validate.mjs` if the manifest is relied upon.

### S4 — Documentation / marketing outrunning enforcement
**File:** `.claude-plugin/marketplace.json` (pilot-core description)
A ~600-char run-on sentence enumerating 15+ capabilities — under the CI cap, but reads as a
feature list. Some of it (autonomous team orchestration) rests on agents whose wiring needs
re-verification (W4).
**Fix:** right-size the claim to what is demonstrably invocable.

### Credit where due
Implementor agents correctly omit `model`; reviewer/support agents correctly declare
`disallowedTools`; `scripts/validate.mjs` enforces all of this and exits 0; hook tests exist
and pass. The standards that **were** wired are wired well.

---

## 4. Skills worth adding

Ranked by gap severity, not novelty.

1. **`rag-security` (pilot-rag) — highest priority.** Prompt injection via indexed
   content, `/ask` endpoint authZ, per-caller rate limiting, PII-in-embeddings retention/
   deletion. The only plugin with live attack surface and the least coverage. Non-negotiable
   if pilot-rag is public.

2. **`distributed-tracing-correlation` (pilot-core, cross-cutting).** `angular-telemetry`,
   `dotnet-observability`, and `azure-observability` are three islands. Nobody owns the seam —
   W3C `traceparent` propagation Angular → .NET → SQL → Azure. Mirror the pattern
   `api-design-standards` uses for the REST contract.

3. **`zero-downtime-deployment` / migration-deploy coordination (pilot-sql or pilot-core).**
   `sql-migration-safety` covers mechanics and `azure-cicd-security` covers the pipeline, but
   nothing governs expand/contract migrations coordinated with rolling deploys — the classic
   "column dropped before old pods drained" outage.

4. **`llm-cost-safety` (pilot-rag).** Token/cost ceilings, context-size limits, output
   validation on the generation path. Pairs with `rag-security`.

---

## Suggested next actions

- [ ] Reconcile `.mcp.json`: consent flow + version pinning + tracking decision (V1–V3).
- [ ] Split block vs. warn in `dangerous-patterns.json` (S1–S2).
- [ ] Resolve hook-coverage coupling: pilot-core dependency or per-stack patterns (W1).
- [ ] Add `rag-security` skill (Skill #1).
- [ ] Verify `@fullstack-reviewer` / `@fullstack-implementor` registration (W4).
- [ ] Add `.mcp.json` checks to `scripts/validate.mjs` (S3).
