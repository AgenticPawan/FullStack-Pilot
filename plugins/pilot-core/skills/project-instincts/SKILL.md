---
name: project-instincts
description: Three-tier project learning system for multi-stack codebases. Instincts (`.claude/instincts.json`) are unconfirmed hypotheses (confidence 0.0–1.0): auto-applied at ≥0.7, promoted to memory at ≥0.9. User corrections go directly to MEMORY.md. Non-obvious discoveries go to `.claude/learning-log.md`. Covers Angular, .NET, SQL, and Azure patterns. Trigger phrases activate the three modes: status, export, import.
when_to_use: learn from this, remember this pattern, show instincts, what have you learned, list instincts, export instincts, import instincts, log this discovery, project convention, naming pattern, multi-stack habit, session start review, what patterns have you observed
---

## Core Principles

1. **Three tiers** — Instincts (`.claude/instincts.json`): hypotheses-in-waiting. Corrections (`MEMORY.md`): confirmed rules. Discoveries (`.claude/learning-log.md`): non-obvious findings with context.
2. **Instincts are hypotheses, not rules** — One observation starts at 0.3. Authority begins at 0.7.
3. **A correction is a promoted instinct** — When the user corrects you, skip the hypothesis cycle entirely. Generalize the lesson and write it to MEMORY.md immediately.
4. **Project-scoped only** — Instincts from one project do not auto-apply to another.

---

## Tier 1 — Instincts (`.claude/instincts.json`)

### Storage Format

```json
{
  "code-style": [
    {
      "pattern": "Use sealed on all handler classes",
      "confidence": 0.8,
      "stack": "dotnet",
      "seen": 5,
      "last_observed": "2026-07-19",
      "example": "src/Features/Orders/CreateOrderHandler.cs:12"
    }
  ],
  "angular": [],
  "sql": [],
  "azure": [],
  "naming": [],
  "architecture": []
}
```

**Stack values**: `angular`, `dotnet`, `sql`, `azure`, `cross-stack`.

### Confidence Ladder

```
OBSERVATION:   1st → 0.3 | 2nd → 0.5 | 3rd → 0.7 | 4th → 0.8 | 5th (0 contradictions) → 0.9
CONTRADICTION: any → halve confidence | two in a row → 0.1 (discard)
USER CONFIRM:  explicit → 0.8 | "sometimes" → cap at 0.5
USER CORRECT:  0.0 — remove from instincts, add to MEMORY.md immediately
STALENESS:     no observation for 10 sessions → flag for review
```

### Acting on Instincts

```
0.0–0.2 → IGNORE         — insufficient evidence
0.3–0.4 → NOTE ONLY      — record, do not apply
0.5–0.6 → MENTION        — "This project may use [pattern]. Follow it?"
0.7–0.8 → FOLLOW         — apply by default, mention on first use per session
0.9+    → PROMOTE        — offer to move to MEMORY.md as a permanent rule
```

Never silently apply an instinct below 0.7.

---

## Tier 2 — Corrections (MEMORY.md)

When the user corrects your output:
1. **Detect**: "no, use X", "we don't do it that way", "always/never do X", "remember this"
2. **Acknowledge**: repeat the correction back in one sentence
3. **Generalize**: "Don't use IMemoryCache in this endpoint" → "Always use HybridCache over IMemoryCache — stampede protection + L1/L2"
4. **Check MEMORY.md**: update an existing rule rather than adding a duplicate
5. **Confirm**: "Added to Memory > .NET: HybridCache over IMemoryCache"

---

## Tier 3 — Discoveries (`.claude/learning-log.md`)

Log non-obvious findings immediately. Entry format:
```markdown
## 2026-07-19 | <Category> | <Short Title>
<2-sentence description of what was discovered and why it matters>
**Files:** `<path:line>`
**Resolution:** <what to do about it>
```

Log categories: `Bug Root Cause`, `Architecture Decision`, `Gotcha`, `Performance Discovery`, `Pattern Found`, `External Service`. Routine changes are NOT logged.

---

## Session-Start Loading

At the start of every session:
1. Read `.claude/instincts.json` — load instincts at 0.7+ as active defaults
2. Read MEMORY.md — apply all rules proactively
3. Scan recent `.claude/learning-log.md` entries for the area being worked on
4. Flag instincts not seen in 10+ sessions as stale

---

## Modes

### Status — "show instincts" / "what have you learned" / "list instincts"

1. Read `.claude/instincts.json`
2. Group by stack, sort by confidence descending
3. Output a table: pattern | confidence | stack | status (stable / reinforced / decaying / promotion-candidate)
4. Print health summary: total active, average confidence, any promotion candidates

### Export — "export instincts"

1. Filter instincts with confidence > 0.7
2. Strip file-specific context (keep pattern + stack + confidence)
3. Write to `.claude/instincts-export.json`
4. Report what was exported, what was skipped (below threshold)

### Import — "import instincts from <path>"

1. Read export file + current `.claude/instincts.json`
2. For each imported instinct:
   - **No local match**: add at `confidence - 0.2` (never above 0.7), mark `source: imported`
   - **Matching instinct**: keep higher confidence, mark reinforced
   - **Conflict**: surface both to the user — do not auto-overwrite
3. Report: imported / merged / conflicts
