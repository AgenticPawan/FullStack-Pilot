---
name: fsp-audit
description: Run a full security audit (automated scanners plus a bounded Claude triage pass) on the current repository and write a findings report.
when_to_use: /fsp-audit, security audit, vulnerability scan, run audit, OWASP review, dependency check, tenant isolation review, find security issues, audit my code, check for vulnerabilities, scan for secrets
---

# /fsp-audit — Security Audit Pipeline

Run a full security audit on the **current working repository** (the user's project, not this plugin repo). Combines automated scanners with a bounded Claude semantic pass — scanners detect, Claude triages. Never present a Claude-only scan as a complete audit.

## What this command does

1. **Tool detection** — checks which scanners are available in the environment; lists missing tools with install commands; marks coverage gaps in the report.
2. **Scanner runs** — executes each available scanner scoped to directories from `.claude/pilot/stack-profile.json`:
   - `dotnet list package --vulnerable --include-transitive`
   - `dotnet build` (Roslyn analyzer warnings CA2100, CA1416, CA2012)
   - `npm audit --json`
   - `semgrep` with `p/csharp`, `p/typescript`, `p/security-audit` rulesets
   - `eslint` with security plugins (if `angular.eslint` is true in the profile)
   - `az bicep lint` per Bicep file
3. **Claude semantic pass** — strictly limited to four checks scanners cannot perform:
   a. IDOR / missing authorization on endpoints
   b. Tenant-isolation gaps (missing/bypassed EF Core global query filters)
   c. AuthN/authZ logic flaws (JWT misconfiguration, role bypass, cookie policy)
   d. Secrets in config and source files
   Every semantic finding **must** cite `file:line` and quote the evidence — findings without evidence are discarded.
4. **Normalise** — merges all findings into `.claude/pilot/audit/findings.json` with `id`, `source`, `severity` (P0–P3, CVSS-aligned), `cwe`, `owasp`, `file`, `line`, `evidence`, `proposedFix`, `batchable`, `confidence`.
5. **Report** — writes `.claude/pilot/audit/AUDIT-REPORT.md` (executive summary + findings by severity) and prints the P0 table inline in chat.

## Prerequisites

- `.claude/pilot/stack-profile.json` must exist. If absent, run `/fsp-init` first.
- The command proceeds with whatever scanners are installed; missing scanners are documented as coverage gaps, not errors.

## Execution

Run the `audit-orchestration` skill now, following every step in order (Step 0 through Step 6).

- `PROJECT_ROOT` is the current working directory of the user's project.
- Never recurse into `node_modules/`, `bin/`, `obj/`, `dist/`, `.git/`.
- Budget: read at most 60 source files during the semantic pass.
- Prioritise controllers, repositories, DbContext, service classes, and Angular component files.
- Print the P0 findings table in chat when done.

## Output files

| File | Purpose |
|------|---------|
| `.claude/pilot/audit/findings.json` | Machine-readable finding list (feed to `/fsp-fix --batch P0`) |
| `.claude/pilot/audit/AUDIT-REPORT.md` | Human-readable report with executive summary |

## Severity quick-reference

| Level | Meaning | Examples |
|-------|---------|---------|
| P0 | Exploitable now | SQL injection, auth bypass, exposed secret, tenant leak |
| P1 | Exploitable with conditions | Vulnerable direct dep in reachable path, partial auth gap |
| P2 | Hardening | Vulnerable transitive dep, missing security header |
| P3 | Hygiene | Informational, style, dead code |
