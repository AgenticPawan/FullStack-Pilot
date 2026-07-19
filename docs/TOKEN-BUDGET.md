# FullStack Pilot — Token Budget Baseline (2026-07-19)

**Phase:** 0 — Baseline measurement  
**Method:** Character counts from source files; `claude plugin details` output not available
in this environment. Tokens estimated at 4 chars/token (conservative for mixed
English/code/punctuation prose). See caveats below.

---

## Always-on content taxonomy

| Layer | Loaded when | Source |
|-------|-------------|--------|
| `plugin.json` description | Every session where plugin is installed | `plugin.json` |
| SKILL.md `description`+`when_to_use` | Every session (skill-routing metadata catalog) | SKILL.md frontmatter |
| Command `description` frontmatter | Every session (populates the /menu) | `commands/*.md` |
| `rules-catalog/always-*.md` content | Every session (auto-loaded rules) | pilot-core only |
| SKILL.md body | On-invoke only | SKILL.md body |
| Agent body | On-invoke only | agents/*.md body |
| Hook scripts | On hook event only | hooks/scripts/*.js |
| `rules-catalog` conditional files | Stack-detection trigger | rules-catalog/*.md |

---

## Per-plugin always-on budget

### pilot-core (v0.29.0)

| Component | Count | Chars | ~Tokens |
|-----------|-------|-------|---------|
| `plugin.json` description | 1 | 469 | 118 |
| SKILL.md frontmatter (29 skills) | 29 | 19,363 | 4,841 |
| Command descriptions (10 commands) | 10 | 1,225 | 307 |
| `always-*.md` rules (4 files) | 4 | 4,269 | 1,068 |
| **Subtotal** | | **25,326** | **~6,332** |

Always rules detail: `always-agent-routing.md` 2,270 chars · `always-structured-logging.md` 691 · `always-no-hardcoded-secrets.md` 686 · `always-conventional-commits.md` 622.

### pilot-angular (v0.23.0)

| Component | Count | Chars | ~Tokens |
|-----------|-------|-------|---------|
| `plugin.json` description | 1 | 571 | 143 |
| SKILL.md frontmatter (32 skills) | 32 | 21,115 | 5,279 |
| Command descriptions | 0 | 0 | 0 |
| **Subtotal** | | **21,686** | **~5,422** |

### pilot-dotnet (v0.26.2)

| Component | Count | Chars | ~Tokens |
|-----------|-------|-------|---------|
| `plugin.json` description | 1 | 521 | 131 |
| SKILL.md frontmatter (57 skills) | 57 | 39,789 | 9,948 |
| Command descriptions | 0 | 0 | 0 |
| **Subtotal** | | **40,310** | **~10,078** |

**Highest-footprint plugin.** 57 skills × avg 698 chars/frontmatter. New Phase 3 skills should
be weighed against this; description+when_to_use compression should target ≤650 chars/skill.

### pilot-sql (v0.16.0)

| Component | Count | Chars | ~Tokens |
|-----------|-------|-------|---------|
| `plugin.json` description | 1 | 581 | 146 |
| SKILL.md frontmatter (11 skills) | 11 | 7,560 | 1,890 |
| Command descriptions | 0 | 0 | 0 |
| **Subtotal** | | **8,141** | **~2,036** |

### pilot-azure (v0.19.0)

| Component | Count | Chars | ~Tokens |
|-----------|-------|-------|---------|
| `plugin.json` description | 1 | 450 | 113 |
| SKILL.md frontmatter (18 skills) | 18 | 12,533 | 3,134 |
| Command descriptions | 0 | 0 | 0 |
| **Subtotal** | | **12,983** | **~3,246** |

### pilot-rag (v0.4.0)

| Component | Count | Chars | ~Tokens |
|-----------|-------|-------|---------|
| `plugin.json` description | 1 | 600 | 150 |
| SKILL.md frontmatter (7 skills) | 7 | 5,294 | 1,324 |
| Command descriptions (1 command) | 1 | 135 | 34 |
| **Subtotal** | | **6,029** | **~1,508** |

---

## Aggregate (all 6 plugins installed)

| Plugin | ~Tokens |
|--------|---------|
| pilot-core | 6,332 |
| pilot-angular | 5,422 |
| pilot-dotnet | 10,078 |
| pilot-sql | 2,036 |
| pilot-azure | 3,246 |
| pilot-rag | 1,508 |
| **Total** | **~28,622** |

Estimated always-on context overhead for a full install: **~115K chars / ~28.6K tokens**.

---

## Phase 0 → Phase 3 5% guard rule

Any new skill added in Phase 3 must not raise a plugin's always-on token count by >5%
without an equal trim elsewhere. Reference values:

| Plugin | Baseline tokens | 5% ceiling (additive) |
|--------|----------------|-----------------------|
| pilot-core | 6,332 | +317 (≈0.5 skill @ 650 chars) |
| pilot-angular | 5,422 | +271 |
| pilot-dotnet | 10,078 | +504 (≈0.8 skill @ 650 chars) |
| pilot-sql | 2,036 | +102 |
| pilot-azure | 3,246 | +162 |
| pilot-rag | 1,508 | +75 |

A new skill's frontmatter budget to stay within 5%: description+when_to_use ≤ **650 chars**
for pilot-core/angular/azure/sql/rag; ≤ **700 chars** for pilot-dotnet (more headroom per
existing density). Exceeding this requires trimming an existing skill's frontmatter first.

---

## Caveats

1. **`claude plugin details` not run** — this tool would give exact runtime-loaded byte
   counts (the authoritative source). The figures above are derived from character counts
   in source files. Actual token counts will vary by tokenizer and runtime loading order.

2. **Skill-routing metadata load model** — it is assumed the runtime loads all SKILL.md
   frontmatter at session start for routing purposes. If the runtime lazy-loads frontmatter
   (only on first match), the effective always-on cost is lower. The budget above is the
   conservative worst case.

3. **`always-*.md` load timing** — whether these files are loaded at session start or at
   first hook invocation affects pilot-core's actual always-on footprint by ±1,068 tokens.
   The budget above counts them as always-on (worst case).
