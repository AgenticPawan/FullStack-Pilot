---
user-invocable: false
name: audit-orchestration
description: Four-phase security-audit orchestrator: (1) detect available scanners and mark coverage gaps; (2) run each scanner scoped by stack-profile.json; (3) normalise findings into .claude/pilot/audit/findings.json (severity P0-P3, cwe, owasp, file, line, evidence, proposedFix); (4) generate AUDIT-REPORT.md and print the P0 table. Claude semantic pass strictly limited to IDOR/missing authorization, tenant isolation, authN/authZ logic, and secrets in config — every finding must cite file:line evidence or is discarded.
when_to_use: Invoke via /fsp-audit. Use when the user requests a security audit, vulnerability scan, OWASP review, dependency check, or tenant-isolation review on the current project.
disable-model-invocation: true
---

<!-- ARCHITECTURE RULE: scanners detect; Claude triages. Claude alone misses and hallucinates; scanners alone drown in noise. Never present a Claude-only scan as complete. -->
<!-- EVIDENCE RULE: every semantic finding MUST include file:line and a quoted code snippet. Discard any finding that cannot cite evidence. -->
<!-- SCOPE: PROJECT_ROOT is the user's project directory (not this plugin repo). -->
<!-- PLUGIN EXTENSIONS: pilot-sql adds Checks E (migration safety). pilot-azure adds Check F (Bicep security baseline). Both use the same findings.json schema. -->
<!-- POLICY LAYER: dependency-vulnerability findings from Steps 2a/2c (dotnet/npm) feed into the dependency-supply-chain skill's severity-to-patch-cadence SLA — that skill governs triage response, this one only detects. -->

## Step 0 — Load stack profile

Read `PROJECT_ROOT/.claude/pilot/stack-profile.json`. If absent, tell the user to run `/fsp-init` first and stop.

Extract scope directories:
- `dotnetDirs`: directories containing each project listed in `dotnet.projects[*].path` (parent dirs)
- `angularRoot`: `PROJECT_ROOT` if `angular` is non-null
- `bicepFiles`: `azure.bicepFiles` array

---

## Step 1 — Tool detection

Check each tool's availability. Use the Bash tool with `--version` or equivalent dry-run flags. **Never install anything — only detect.**

| Tool | Detection command | Covers |
|------|-------------------|--------|
| dotnet CLI | `dotnet --version` | NuGet vulnerability advisories, Roslyn build |
| npm | `npm --version` | npm audit |
| semgrep | `semgrep --version` | SAST (C#, TypeScript, security rulesets) |
| eslint | `npx eslint --version` (only if `angular.eslint` is true in profile) | TS/HTML security rules |
| bicep CLI | `az bicep version` or `bicep --version` | Bicep lint |
| PSRule | `pwsh -c "Get-Module PSRule.Rules.Azure -ListAvailable"` | Azure IaC rules |

Build two lists:
- **available**: tools that responded without error
- **missing**: tools that were not found, each with the install command

Print a coverage table at the start of the report and log coverage gaps as `source: "coverage-gap"` entries in findings.json.

---

## Step 2 — Run scanners

Run each available scanner. Capture output. **Do not abort on scanner errors** — log the error as a coverage gap and continue.

### 2a. dotnet vulnerability advisory scan

```
dotnet list <solution-or-project> package --vulnerable --include-transitive
```

Run once per solution file found in `dotnet.solutions`. If no solution, run per project. Parse output for lines matching `> <PackageName> <InstalledVersion>` with a severity label.

### 2b. Roslyn build warnings

```
dotnet build <solution> -warnaserror:false -p:TreatWarningsAsErrors=false 2>&1
```

Capture all `warning CS` lines. Include only these Roslyn analyzer IDs in findings (others are noise):
- `CA2100` — SQL command injection
- `CA1416` — Platform compatibility  
- `CA2012` — ValueTask misuse
- `SA1*` / `SX*` — only if they surface CWE-related patterns

### 2c. npm audit

```
npm audit --json
```

Run from `angularRoot` if `angular` is non-null. Parse JSON response. Include only `moderate`, `high`, `critical` advisories.

### 2d. Semgrep (if available)

```
semgrep scan --config p/csharp --config p/typescript --config p/security-audit \
  --json --no-git-ignore <dotnetDir> <angularRoot>
```

Parse the `results` array from JSON output.

### 2e. ESLint security (if available and `angular.eslint` is true)

```
npx eslint --ext .ts,.html --format json <angularRoot>/src
```

Parse output for rules matching `security/`, `@angular-eslint/no-` patterns.

### 2f. Bicep lint (if available)

```
az bicep lint --file <bicepFile>
```

Run per file in `azure.bicepFiles`. Parse output for errors and warnings.

---

## Step 3 — Claude semantic pass

**Strictly limited to four check types. Do not expand scope.**

Read source files in `dotnetDirs` and `angularRoot/src`. Budget: **≤ 60 files total**. Prioritise controllers, repositories, DbContext, service files, and component templates.

### Check A — IDOR / missing authorization on endpoints

For each HTTP endpoint method in controllers:
1. Does the method lack `[Authorize]` or equivalent policy? → finding if the endpoint is not intentionally public (check for `[AllowAnonymous]`)
2. Does the method fetch a resource by ID without verifying `resource.OwnerId == currentUserId` (or equivalent claim check)? → IDOR finding

Evidence required: file path, line number, and the method signature + the missing check.

### Check B — Tenant-isolation gaps

For each `DbContext.OnModelCreating`:
1. Does it define a global query filter for a `TenantId` or `OrganisationId` property? If the domain has multi-tenant markers (any entity with `TenantId`/`OrgId` field) but no `HasQueryFilter` for those entities → tenant-isolation finding.
2. Does any repository method call `IgnoreQueryFilters()` without a justification comment? → tenant-bypass finding.

### Check C — AuthN/authZ logic flaws

1. JWT validation: is `ValidateIssuerSigningKey` or `ValidateAudience` explicitly set to `false`? → critical finding
2. Role checks: any `.ToLower()`/`.ToUpper()` comparison on role strings (case-sensitive auth bypass)?
3. Cookie auth: `CookieSecurePolicy.Never` or `HttpOnly = false` set explicitly?

### Check D — Secrets in config

1. Scan `appsettings*.json` and `*.env*` files for patterns: `Password=`, `AccountKey=`, `ConnectionString` with embedded credentials, `ApiKey`, `Secret` assigned a non-placeholder string value.
2. Scan C# source for string literals matching: `Password=`, `AccountKey=`, bearer token patterns, base64 blobs > 40 chars in auth contexts.
3. Skip placeholders: `<value>`, `#{...}#`, `${...}`, `__REPLACE__`, `your-*-here`.

**Discard finding if you cannot quote the exact string from the file.**

### Check E — EF Core migration safety (pilot-sql)

Run this check only if `dotnet` is non-null in the stack profile and migration files exist.

Glob `**/Migrations/*.cs` (exclude `*Designer.cs`, `*Snapshot.cs`). For each migration:

1. **MIG-001/002 (P1):** does `Up()` call `DropColumn(` or `DropTable(`? → finding
2. **MIG-003 (P1):** does `AlterColumn` narrow a type (smaller `maxLength`, or wider→narrower CLR type)?
3. **MIG-004 (P1):** does `AddColumn` set `nullable: false` with no `defaultValue`?
4. **MIG-006 (P2):** is `Down()` empty or absent when `Up()` contains any destructive call?

Evidence must quote the specific `migrationBuilder.` call and its line number.
All migration findings use `batchable: false`.

### Check F — Azure/Bicep security baseline (pilot-azure)

Run this check only if `azure.bicepFiles` is non-empty in the stack profile.

For each `.bicep` file listed in `azure.bicepFiles`:

1. **ASB-NS-1 (P0):** any `allowBlobPublicAccess: true` or `publicAccess: 'Blob'`/`'Container'`? → finding
2. **ASB-IM-1 (P0):** any `listKeys()` call in outputs or app-settings values? → finding
3. **WAF-OPS-001 (P2):** scan `azure.githubActionsFiles` — does the workflow lack a `what-if` step before the deployment step?
4. **WAF-COST-001 (P2):** does any resource declaration lack a `tags:` property?

Evidence must quote the exact Bicep line. OWASP mapping: ASB-NS-1 → A05:2021, ASB-IM-1 → A02:2021.

---

## Step 4 — Normalise to findings.json

Write `PROJECT_ROOT/.claude/pilot/audit/findings.json` with this schema:

```json
[
  {
    "id": "VULN-001",
    "source": "scanner | semantic | coverage-gap",
    "severity": "P0 | P1 | P2 | P3",
    "cwe": "CWE-89",
    "owasp": "A03:2021",
    "wcag": null,
    "file": "src/Api/Controllers/UsersController.cs",
    "line": 22,
    "title": "SQL injection via string concatenation",
    "evidence": "var sql = $\"SELECT * FROM Users WHERE name='{name}'\";",
    "proposedFix": "Replace with EF Core LINQ or FromSqlInterpolated",
    "batchable": true,
    "confidence": "high | medium | low"
  }
]
```

### Severity policy

| Severity | Criteria |
|----------|----------|
| P0 | Exploitable now: injection, auth bypass, exposed secret, tenant data leak |
| P1 | Exploitable with conditions; vulnerable direct dependency in reachable path |
| P2 | Hardening gaps; vulnerable transitive dependency |
| P3 | Hygiene (informational, style, dead code) |

### CVSS alignment

- CVSS ≥ 9.0 (Critical) → P0
- CVSS 7.0–8.9 (High) → P1
- CVSS 4.0–6.9 (Medium) → P2
- CVSS < 4.0 (Low) → P3

### ID scheme

Sequential: `VULN-001`, `VULN-002`, … sorted by severity (P0 first).

### Coverage gaps

Add one entry per missing scanner:
```json
{
  "id": "GAP-001",
  "source": "coverage-gap",
  "severity": "P3",
  "title": "semgrep not installed — SAST coverage absent",
  "evidence": "semgrep not found in PATH",
  "proposedFix": "pip install semgrep",
  "batchable": false,
  "confidence": "n/a"
}
```

---

## Step 5 — Generate AUDIT-REPORT.md

Write `PROJECT_ROOT/.claude/pilot/audit/AUDIT-REPORT.md`:

```markdown
# Security Audit Report

**Generated:** <ISO date>  
**Project:** <basename of PROJECT_ROOT>  
**Scanners run:** <comma-separated list>  
**Coverage gaps:** <list or "none">

## Executive Summary

| Severity | Count |
|----------|-------|
| P0 (Critical) | N |
| P1 (High)     | N |
| P2 (Medium)   | N |
| P3 (Low)      | N |
| **Total**     | **N** |

## P0 Findings

<one sub-section per P0 finding: ### VULN-NNN — <title>, evidence block, proposed fix>

## P1 Findings

...

## P2 Findings

...

## P3 / Coverage Gaps

...
```

After writing the file, **print the P0 table inline in chat** so the user sees it immediately without opening the file.

---

## Step 6 — Final output

Print in chat:

```
## Audit complete

findings.json  → .claude/pilot/audit/findings.json  (<N> findings)
AUDIT-REPORT   → .claude/pilot/audit/AUDIT-REPORT.md

Coverage: <scanners used> | Gaps: <missing scanners or "none">

<P0 table here>

Run /fsp-fix --batch P0 to begin remediation on P0 findings.
```
