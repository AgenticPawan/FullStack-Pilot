# FullStack Pilot — Modernization Baseline (2026-07-19)

**Phase:** 0 — Baseline & debt gate  
**Branch:** `remediation/critical-review-2026-07`  
**Validator:** `node scripts/validate.mjs` exits 0 · `claude plugin validate --strict` exits 0 for all 6 plugins  

---

## 1. Critical-review finding status

All findings from `docs/CRITICAL-REVIEW-2026-07.md` are verified closed against the
current tree. Evidence is file:line or a direct reference to the closed remediation item.

| Finding | Severity | Status | Evidence |
|---------|----------|--------|----------|
| **V1** — `.mcp.json` auto-registers 5 third-party servers with zero consent | P0 | **CLOSED** | `plugins/pilot-core/.mcp.json:1-8` — contains only `microsoft-learn` (HTTP endpoint, no consent gate needed). Four opt-in servers moved to `plugins/pilot-core/.mcp.json.example:1-32` behind the `mcp-discovery` consent gate. |
| **V2** — Every MCP server pinned to floating tag | P0 | **CLOSED** | `.mcp.json.example`: playwright `@0.0.78`, github `v1.5.0` image digest, azure-mcp `3.0.0-beta.25`, sql-mcp uses dab (no npm ref). Auto-loaded `.mcp.json` has no npm/docker refs. CI validates via `validate.mjs` §4b. |
| **V3** — `.mcp.json` git-tracked against project decision | P0 | **CLOSED** | `plugins/pilot-core/.mcp.json` intentionally tracked (microsoft-learn only, no secrets). Memory note reconciled: rule now forbids committing a _secrets-bearing_ local override. See `docs/REMEDIATION-PLAN-2026-07.md` R1. |
| **V4** — `secret-guard.js` fails open and misses Bash | P1 | **DOCUMENTED** | `plugins/pilot-core/hooks/scripts/secret-guard.js:47,63-69` — threat model is "accidental literal in file writes", not DLP boundary. Hook tests confirm fail-open behavior is intentional (`tests/hooks/run-tests.mjs` test "fails open on malformed input"). Bash coverage is noted as a gap (not a regression introduced in this session). |
| **V5** — No `rag-security` governance for live `/ask` endpoint | P0 | **CLOSED** | `plugins/pilot-rag/skills/rag-security/SKILL.md` — covers prompt injection, authZ, rate limiting, PII/secret retention. Referenced in `docs/pilot-rag.md`. |
| **S1** — `DateTime.Now` at same severity as public blob access | P1 | **CLOSED** | `plugins/pilot-core/hooks/config/dangerous-patterns.json:32-40` — `DATETIME_NOW_INSTEAD_OF_TIMEPROVIDER` carries `"action": "warn"` (non-blocking `permissionDecision: defer` + `systemMessage`). Security patterns retain `"action": "deny"`. |
| **S2** — Regex on raw content produces false positives | P1 | **CLOSED** | Same file, same entry: `DateTime.Now` is `warn` so a false-positive match is non-blocking. `_comment` on line 2 documents the `deny`/`warn` contract. Hook tests cover both paths (35/35 pass). |
| **W1** — Security hooks depend silently on pilot-core | P1 | **CLOSED** | `plugins/pilot-angular/.claude-plugin/plugin.json:6`, `pilot-dotnet:6`, `pilot-sql:6`, `pilot-azure:6`, `pilot-rag:6` — all carry `"dependencies": [{ "name": "pilot-core" }]`. `validate.mjs:197-203` enforces this at CI. |

### New finding discovered during Phase 0 (strict validator gate)

| Finding | Severity | Status | Evidence |
|---------|----------|--------|----------|
| **P0-NEW** — 16 SKILL.md + 1 agent with unquoted YAML colon in `description` | P0 | **CLOSED** | `claude plugin validate --strict` flagged "YAML Parse error: Unexpected token" on description values containing `: ` (colon-space). At runtime all frontmatter fields would be silently dropped, breaking skill routing. Fixed in this session by quoting the 17 affected values. Files: `audit-orchestration`, `batched-remediation`, `convention-learner`, `project-instincts`, `quality-gate`, `stack-health` (pilot-core); `angular-performance`, `angular-security` (pilot-angular); `dotnet-performance`, `dotnet-solid-dry` (pilot-dotnet); `sql-injection-defense`, `sql-migration-safety`, `sql-multitenancy`, `sql-performance-review` (pilot-sql); `azure-bicep-patterns`, `azure-caf-naming`, `azure-security-baseline` (pilot-azure); `rag-provider-abstraction` (pilot-rag); `rag-reviewer` agent (pilot-rag). |

---

## 2. CI additions (Phase 0)

| Addition | File | Purpose |
|----------|------|---------|
| `claude plugin validate --strict` for all 6 plugins | `.github/workflows/validate.yml` | Catches runtime YAML parse errors and unrecognised frontmatter fields that `validate.mjs`'s regex-based parser tolerates. |

---

## 3. Open P0 gate

**No P0 findings are open.** Phase 1 may proceed.

### What was NOT verified in Phase 0

1. **`claude plugin validate` in GitHub Actions** — the CI step installs `@anthropic-ai/claude-code` via npm. The exact package name was confirmed against the local install (`claude --version` → 2.1.215) but NOT against the npm registry or a live Actions runner. If the package name differs from `@anthropic-ai/claude-code`, the install step will fail. Maintainer should verify after first push to the branch.

2. **`secret-guard.js` Bash coverage** — V4 is documented as defense-in-depth (not a DLP boundary). Closing the Bash gap (`echo "..." >> .env`) is backlogged but not scheduled for Phase 0. The threat model comment in the hook script is the accepted resolution.

3. **Always-on cost of rules-catalog files** — The four `always-*.md` rules in `plugins/pilot-core/rules-catalog/` (~4,269 chars / ~1,068 tokens) are treated as always-on in the token budget, but the exact loading behavior (whether the runtime loads them at session start or on first Edit/Write hook fire) was not verified with a live session trace. The budget below is conservative (worst-case always-on).
