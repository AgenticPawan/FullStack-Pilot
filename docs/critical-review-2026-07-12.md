# FullStack Pilot — Critical Review (2026-07-12)

**Reviewer role:** external plugin/security critic
**Scope:** full marketplace (`pilot-core`, `pilot-angular`, `pilot-dotnet`, `pilot-sql`,
`pilot-azure`, `pilot-rag`) — security hooks, validator, manifests, agent wiring, RAG scaffold.
**Method:** read the wiring on disk, not the marketing copy. Every finding cites `file:line`.

> Meta note: the first attempt to save this document was **blocked by pilot-core's own
> `secret-guard` hook**, because the prose contained literal connection-string key names. That is
> the guard working as designed — and a live reminder that fail-open (V5) is the only thing
> standing between a false negative and a leaked secret.

## Verdict

The architecture and depth are genuinely strong — `rag-security`, `fullstack-reviewer`, the
fail-open reasoning, and the token-discipline regime are better than most marketplace plugins
ship. The weakness is concentrated in the **security enforcement floor** (the pilot-core hooks):
three of the four highest-severity findings live there, and they undercut the exact promise the
plugin makes to a Microsoft/Azure shop.

Severity legend: **P0** ship-blocker · **P1** fix-soon · **P2** hygiene/hardening.

---

## 1. Vulnerabilities

### V1 — Formatter silently no-ops on Windows (the target platform) · P1
`plugins/pilot-core/hooks/scripts/formatter.js:57` calls
`spawnSync('npx', ['--no-install','prettier',…])` with no `shell:true`. On Windows `npx` is
`npx.cmd`; Node's `spawn` cannot resolve it → `ENOENT` → `spawnSync` returns `{error}` with
`status === null`, so even the `if (r.status !== 0 && r.stderr)` log branch (line 62) never
fires. **Prettier formatting never runs on any Windows dev machine, with zero signal.**
`dotnet` resolves (`dotnet.exe`) so `.cs` still formats — which masks the bug. For a plugin
whose stated audience is Microsoft shops, the enforcement floor is half-dark on the majority OS.
**Fix:** on `win32` invoke `npx.cmd` (done in this remediation).

### V2 — secret-guard cannot detect the secrets your users actually leak · P0
`plugins/pilot-core/hooks/scripts/secret-guard.js:10-41` has solid generic patterns (JWT, PEM,
URL creds, ADO.NET connection-string credential) but for an **Azure** plugin it misses the
highest-frequency shapes:
- **Azure Storage account key** — Azure connection strings carry the key under `AccountKey`,
  *not* the ADO.NET credential token, so `CONNECTION_STRING_WITH_PASSWORD` (line 20) misses them.
- **Service Bus / Event Hub `SharedAccessKey`** — uncovered.
- **SAS tokens** (the `sig` query component) — uncovered.
- Cloud-provider keys generally: AWS `AKIA…`, GitHub `ghp_`/`ghs_`/`gho_`, Google `AIza…`,
  Slack `xox[baprs]-`, Stripe `sk_live_`.

The flagship pre-commit secret barrier for an Azure shop could not detect an Azure storage key
or a Service Bus connection string. **Single biggest hole in the repo.** Fixed in this
remediation by adding seven high-signal, placeholder-aware patterns + tests.

### V3 — Tool-surface bypass via MultiEdit · P1
Both PreToolUse hooks match only `"Write|Edit"` (`hooks/hooks.json:5`). If the harness exposes
`MultiEdit`, writes through it are invisible to secret-guard **and** dangerous-patterns.
`secret-guard.js:63-69` and `dangerous-patterns.js:65-71` only read `Write.content` /
`Edit.new_string` — neither has a branch for a `MultiEdit` `edits[]` array. A secret introduced
via MultiEdit passes the floor unseen. Fixed by adding `MultiEdit` to the matcher and an
`edits[]` extraction path in both scripts + tests.

### V4 — SQL-injection deny rule misses the modern .NET vector and over-blocks · P1 (fixed)
`hooks/config/dangerous-patterns.json:19` keys on `SELECT|INSERT|… "+` on a single line
(`[^\n]*`). It does **not** catch C# interpolated strings — an interpolated SQL string with a
`{id}` placeholder — the dominant EF-Core-era injection sink, which has no `+` at all. It also
hard-`deny`s benign concatenation near a SQL keyword (a log line containing "DELETE", a constant
fragment builder). A `deny` this blunt trains users to disable the hook, while missing
interpolation gives false confidence. **Fixed:** added an interpolated-SQL `warn` pattern
(kept as `warn`, not `deny`, because EF Core `FromSqlInterpolated`/`ExecuteSqlInterpolated`
parameterize interpolation holes and are safe — a `deny` would false-positive on the
recommended API), and tightened the concat `deny` so the `+` must be followed by an
identifier/call expression (constant-only concatenation no longer trips it, variable injection
still does).

### V5 — Fail-open is total and silent · P2
All three hooks end in `catch(_) { process.exit(0) }`. Fail-open is a defensible productivity
choice, but this is the *only* shipped secret barrier: a crash (malformed/oversized payload)
allows the write with no breadcrumb. There is also no content-size cap before running the regex
set on `input.content`; a very large generated file that blows the 5s hook timeout is killed and
(fail-open) allowed. **Fix:** emit a one-line `stderr` marker on the top-level catch so
"the guard did not run" is observable. A governance tool that can't tell you it didn't run is a
governance smell. Breadcrumb added in this remediation; size-cap deferred.

### V6 — ReDoS via user-extensible config · P2 (deferred)
`dangerous-patterns.js:89` compiles `new RegExp(pat.pattern)` from a config advertised as
user-extensible, with no complexity guard; a catastrophic-backtracking pattern hangs each Write
for the full 5s timeout. Local/trusted config → low severity. **Recommendation:** document the
constraint and/or add a length/complexity sniff before compiling.

---

## 2. Resources not wired properly

### W1 — `fullstack-reviewer` / `fullstack-implementor` may not be registering · P1 (verify)
Both files exist on disk and look valid, but in the review session the runtime agent registry
surfaced `fullstack-support`, all `fsp-*`, and every per-stack trio — **not** these two. If real
(not a stale session snapshot), the headline pilot-core feature (the cross-stack orchestrator
trio advertised in `marketplace.json` and `plugin.json`) is dead-wired. **Action:** confirm with
a fresh agent listing before trusting the marketing copy.

### W2 — RAG ships an implementor with no reviewer, over real attack surface · P1
`plugins/pilot-rag/agents/` contains only `rag-implementor.md` (full Write tools) — no
`rag-reviewer`/`rag-support` sibling, breaking the trio convention every other stack follows.
Yet per `rag-security/SKILL.md` this scaffold emits a live `POST /ask` SSE endpoint and a Qdrant
store — genuine runtime attack surface. The one plugin that generates production code is the one
with no reviewer to check its output. **Recommendation:** add `rag-reviewer` (read-only) that
runs the `rag-security` gate against generated output.

### W3 — Azure trio naming breaks the stack convention · P2
`pilot-azure` ships `infra-reviewer`, `infra-implementor`, **`azure-support`** — stack is "infra"
for two and "azure" for the third. CLAUDE.md mandates `<stack>-{reviewer|implementor|support}`.
Any routing table must special-case it, and it is drift that quietly rots. **Recommendation:**
pick one prefix (`infra-support` or rename all to `azure-*`) and update routing/docs.

### W4 — Advertised live-diagnostic capability isn't wired out of the box · P2
`.mcp.json` auto-loads only `microsoft-learn`. But `azure-support` sells "live diagnostics via
the bundled Azure MCP tools" and `angular-support` sells "live browser inspection via bundled
Playwright" — both live in `.mcp.json.example` (opt-in only). Agent bodies hedge with "when
available"; the marketplace copy does not. A fresh install gets support agents whose signature
feature is dark until manual opt-in. **Recommendation:** set expectation in the description or
prompt for consent at first support-agent use.

---

## 3. Development standards not followed

### S1 — Token-discipline rule has a hole exactly where tokens cost most · P1
CLAUDE.md caps `plugin.json` description at 600 chars and `scripts/validate.mjs:160` enforces it
— **but only on `plugin.json`.** The `marketplace.json` per-plugin descriptions *also* load
(during browsing) and run 2x+ over: `pilot-dotnet`'s is ~1,400 chars, `pilot-core`'s ~1,300. The
validator has no marketplace-description length check. The discipline the repo prides itself on
is not applied to the catalog copy. **Recommendation:** extend the 600-char check to
`marketplace.json` plugin entries (or reconcile the standard) and trim the descriptions.

### S2 — Undocumented agent frontmatter keys · P2 (verify)
`plugins/pilot-core/agents/fullstack-reviewer.md:5-6` sets `effort: high` and `maxTurns: 25`.
Neither appears in the CLAUDE.md model matrix nor is validated. Per the repo's own "re-fetch the
live plugin docs before any schema change" rule, confirm these are real agent-schema keys — if
not, they're silently ignored and the reviewer isn't running at the intended depth.

### S3 — Several CLAUDE.md "MUST" rules have no CI backstop · P1
`validate.mjs` checks hook-script *existence* but not: (a) matchers are never `"*"`, (b) scripts
avoid recursing `node_modules/bin/obj`, (c) every stack plugin declares the `pilot-core`
dependency. All hold today by hand — nothing prevents regression. For a governance product,
"enforced by discipline" is the anti-pattern it sells against. **Recommendation:** add the three
checks to the validator.

### S4 — Brittle `disallowedTools` parsing · P2
`validate.mjs:237` splits on comma; `parseFrontmatter` handles only scalar keys, so a YAML-list
form (`disallowedTools: [Write, Edit]`) passes the `includes('Write')` check only by accident.
One reviewer authored in list style and the read-only guarantee evaluates wrong. **Recommendation:**
normalize both scalar and list forms before the membership check.

---

## 4. Skills worth adding

The catalog is deep (137 skills); these are genuine **unowned seams**, not filler.

1. **Data-subject erasure reconciliation (strongest add).** `dotnet-soft-delete`,
   `dotnet-audit-trail` (immutable by design), `search-integration`, `sql-data-protection`, and
   the `pilot-rag` Qdrant store each *retain* data a GDPR right-to-be-forgotten request must
   purge — and nobody owns reconciling them. A `data-subject-request` skill (erasure across
   soft-delete + immutable audit + search index + vector store, and what "delete" legally means
   for each) closes a real cross-cutting gap.
2. **Inbound webhook signature verification.** `dotnet-webhooks` is scoped to *outbound*
   delivery. Inbound handshake/signature verification (Stripe, GitHub, Azure Event Grid
   validation events) is a security-grade gap — unverified inbound webhooks are a classic
   spoof/RCE vector.
3. **Key Vault reference wiring (closes the V2 loop).** `dotnet-secrets-rotation` and
   `azure-security-baseline` exist, but nothing governs the connective tissue: Managed Identity →
   Key Vault references in App Configuration as the *replacement* for the account keys
   secret-guard now flags.
4. **In-app Azure OpenAI safety (not just the RAG scaffold).** `llm-cost-safety` and
   `rag-security` are scoped to `pilot-rag`. Microsoft shops increasingly ship Azure OpenAI
   features in the .NET app itself; there is no `pilot-dotnet` skill for content filtering,
   prompt-injection, or PII egress in the user's *own* product code.
5. **CI bundle-size / performance-budget gate.** `angular-performance` covers runtime; verify it
   also fails the build on an `angular.json` budget breach — if not, that CI gate is a gap.

---

## Remediation status (this pass)

| Finding | Action |
|---|---|
| V1 formatter Windows | **Fixed** — `npx.cmd` on win32 |
| V2 Azure/cloud secrets | **Fixed** — 7 patterns + tests added |
| V3 MultiEdit bypass | **Fixed** — matcher + `edits[]` extraction + tests |
| V5 silent fail-open | **Fixed** — stderr breadcrumb on catch |
| V4 SQL interpolation | **Fixed** — interpolation `warn` (FromSqlInterpolated-aware) + tightened concat `deny` |
| V6 ReDoS guard | Deferred — low severity, docs/complexity sniff |
| W1 agent registration | **Verify** — fresh agent listing |
| W2 rag-reviewer | Deferred — new agent |
| W3 azure naming | Deferred — rename + routing update |
| W4 MCP expectation | Deferred — copy/consent change |
| S1 marketplace desc budget | Deferred — validator + trims |
| S2 effort/maxTurns keys | Verify — against live agent schema |
| S3 CI backstops | Deferred — 3 validator checks |
| S4 disallowedTools parse | Deferred — parser normalization |
