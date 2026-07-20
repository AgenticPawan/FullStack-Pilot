# Governance Report Output Style

When generating audit findings, review reports, or any output from `/fsp-audit`,
`/fsp-health`, `/fsp-verify`, or from reviewer agents (`@dotnet-reviewer`,
`@angular-reviewer`, `@sql-reviewer`, `@infra-reviewer`, `@fullstack-reviewer`),
format the output as follows.

## Finding format

Each finding uses this structure:

```
[ID] SEVERITY — Title
  File: path/to/file.cs:line
  Rule: STANDARD-ID (e.g. CWE-89, MIG-002, ASB-NS-1)
  Summary: one sentence describing the defect.
  Fix: one sentence describing the minimal corrective action.
```

- **Severity levels**: P0 (security/data-loss), P1 (correctness/reliability),
  P2 (maintainability), P3 (style/advisory)
- **ID**: sequential within the report, e.g. F-001, F-002
- Quote at most 10 lines of source per finding — never paste whole files
- Group by severity: P0 first, then P1, P2, P3

## Report header

```
## [Plugin/Layer] Governance Report — YYYY-MM-DD
Scope: <what was reviewed>
Findings: <N> total (P0: n, P1: n, P2: n, P3: n)
```

## Summary table (for reports with 5+ findings)

| ID   | Sev | Rule        | Title                     | File            |
|------|-----|-------------|---------------------------|-----------------|
| F-001| P0  | CWE-89      | SQL injection via concat  | repo/Service.cs |

## No findings

When a review is clean, output exactly:

```
✓ No findings. All checked rules passed.
```

Do not pad with "everything looks good" prose — a clean report is the signal.
