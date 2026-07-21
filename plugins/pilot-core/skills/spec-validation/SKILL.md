---
name: spec-validation
description: Takes a .claude/pilot/specs/*.md spec and a diff or PR description, then validates the implementation against the original spec. Outputs a checklist marking each AC-n as Implemented, Partial, Missing, or Scope Creep, with evidence citations from the diff. Loaded by fsp-tpo-intake when invoked with a PR or diff argument. Outputs SV-* standard IDs.
when_to_use: validate spec, does this PR match the spec, spec compliance, scope creep check, acceptance criteria coverage, AC implemented, PR vs spec, spec drift, requirements coverage, check against spec, what did they actually build
---

## Purpose

`@fsp-qa` validates that tests cover the spec's acceptance criteria. This skill asks a
different question: does the *implementation diff* match what the spec described? It is
the Technical Product Owner's tool for reviewing a PR before signalling Ready to Merge.

Loaded exclusively by `@fsp-tpo-intake` when the agent is invoked with a PR number, a
diff, or an implementation summary alongside a spec path.

## Standard IDs

| ID | Severity | What it checks |
|----|----------|--------------------|
| SV-001 | P1 | An acceptance criterion (AC-n) has no corresponding code or test in the diff |
| SV-002 | P2 | An AC-n is only partially implemented — the happy path exists but an edge case or failure scenario from the AC is missing |
| SV-003 | P1 | The diff contains changes not traceable to any user story or AC in the spec (scope creep) |
| SV-004 | P2 | The spec template is incomplete — required sections are empty or missing |

## Read budget (STRICT): max 10 files

Read the spec file and diff only. Do not read the full source tree — traceability is
between spec language and diff content, not between spec and the entire codebase.

---

## Step 1 — Load the spec

Read the spec at the provided path (e.g. `.claude/pilot/specs/invoice-splitting.md`).
Extract every `AC-n` criterion and every `US-n` user story as a labelled list.
Note the `Affected layers` section — changes in layers not listed there are Scope Creep candidates.

---

## Step 2 — Parse the diff or PR description

For each changed file, note:
- Layer (Angular / .NET / SQL / Azure) from file extension and path
- The nature of the change (new class, changed method signature, new DB column, new route)
- Any test files changed (maps to coverage of an AC)

---

## Step 3 — Trace each AC to the diff

For each AC-n:

| Result | Definition |
|--------|-----------|
| **Implemented** | The diff contains code that addresses the given/when/then scenario AND a test exercising that scenario |
| **Partial** | Code addresses the happy path but the AC's failure scenario, edge case, or boundary condition has no test or implementation |
| **Missing** | No code in the diff relates to this AC — the requirement was not built |
| **Scope Creep** | Diff contains a change in a layer or feature area not referenced by any AC or user story |

---

## Output format

```markdown
## Spec Validation Report

Spec: <path>
Diff: <PR number or diff description>
AC count: <N>

### Acceptance Criteria Coverage

| AC-ID | Status | Evidence in diff |
|-------|--------|-----------------|
| AC-1  | Implemented | OrdersController.cs: added [HttpPost("{id}/approve")]; ApproveOrderTests.cs: covers happy path + 403 scenario |
| AC-2  | Partial | CreateOrderHandler.cs: handles valid payload; missing: no test for concurrent duplicate submission (AC-2 edge case) |
| AC-3  | Missing | No changes found for invoice-line splitting logic — not present in diff |
| AC-4  | Implemented | orders.component.ts: approval button gated by hasPermission('orders.approve') |

### Scope Creep findings

| ID | Severity | Description |
|----|----------|-------------|
| SV-003 | P1 | `ReportingController.cs` added — not referenced in any AC or user story. Spec layer coverage: Angular UI, .NET API. Reporting layer not listed. |

### Template completeness

| SV-004 | P2 | Section "Out of scope" is empty in the spec — please list what was explicitly excluded |

### Summary
- Implemented: <N>
- Partial: <N> → action required before Ready to Merge
- Missing: <N> → block merge if P1 or above
- Scope Creep: <N> → requires TPO sign-off to include or move to a separate spec
```

---

## Finding severity rules

- Missing AC in a layer listed as "Affected" in the spec → P1 (blocks merge)
- Partial AC for a non-critical edge case → P2 (tech debt, does not block merge)
- Scope Creep in a security or data-access layer → P1 (must be spec'd before shipping)
- Scope Creep in a cosmetic/UX layer → P2 (advisory)
- Incomplete spec template → P2 (advisory — fix spec, not the implementation)

---

## Rules

- Never make code-quality judgements — that is the stack reviewers' job. This skill only
  checks traceability between spec language and diff content.
- Never flag as Scope Creep a refactor that was described in the spec's "Out of scope" as
  explicitly permitted ("minor refactors in the touched files are acceptable").
- If the diff is a PR number without the actual file list, ask the engineer to provide
  `git diff main...<branch>` output before running the check.
- Budgets bound exploration, not quality: report what is traceable within 10 files; if the
  diff is too large for the budget, request a scoped re-run per AC cluster.
