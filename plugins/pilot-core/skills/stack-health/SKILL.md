---
name: stack-health
description: Grades the full-stack project A–F across six dimensions: Build health, Test coverage proxy, Security posture, Dependency hygiene, Architecture compliance, and Observability. Produces a graded report card with a GPA (A=4.0, F=0.0) and ranked improvement recommendations. Covers Angular, .NET, SQL Server, and Azure stacks present in the project.
when_to_use: health check, project health, how is the project, grade my project, /fsp-health, quality report, overall status, what needs fixing, project score, stack audit, is the project healthy, technical debt overview
---

## Read Budget

Max 30 file reads per health check run. Prioritize: build output, test summary (`.claude/last-test-run.md`), audit findings (`.claude/pilot/audit/findings.json`), `package.json`, `*.csproj` files, `angular.json`.

---

## Grading Scale

| Grade | GPA | Meaning |
|-------|-----|---------|
| A | 4.0 | Excellent — no significant issues |
| B | 3.0 | Good — minor issues, actively managed |
| C | 2.0 | Acceptable — needs attention this sprint |
| D | 1.0 | Poor — blocking production readiness |
| F | 0.0 | Critical — unacceptable, fix before merge |

Overall GPA = average of all applicable dimensions.

---

## Dimension 1 — Build Health

**Check**: Does the project build with zero errors?

| Result | Grade |
|--------|-------|
| Zero errors, zero warnings | A |
| Zero errors, warnings present | B |
| Build errors in non-critical paths | C |
| Build errors in any entrypoint | F |

How to check: Read `.claude/pilot/audit/findings.json` for build-related findings, or run `dotnet build --no-restore` / `ng build`.

---

## Dimension 2 — Test Coverage Proxy

**Check**: Are Testcontainers-backed integration tests present for critical flows?

| Result | Grade |
|--------|-------|
| Integration tests with Testcontainers for key flows (auth, data mutations, API contracts) | A |
| Integration tests present but no Testcontainers (in-memory provider only) | B |
| Unit tests only, no integration tests | C |
| No tests at all | F |

How to check: Glob `**/*.Tests/**/*.cs` for `Testcontainers` import. Glob `**/*.spec.ts` for `ng test` coverage.

---

## Dimension 3 — Security Posture

**Check**: Open security findings from the last `/fsp-audit` run.

| Result | Grade |
|--------|-------|
| No open findings | A |
| Warnings only (P2/P3), no P0/P1 | B |
| P1 findings open | D |
| P0 findings open | F |

How to check: Read `.claude/pilot/audit/findings.json`. Count by severity.

---

## Dimension 4 — Dependency Hygiene

**Check**: Vulnerable packages in NuGet and npm.

| Result | Grade |
|--------|-------|
| No known vulnerabilities | A |
| Low severity CVEs only | B |
| Medium CVEs | C |
| High CVEs | D |
| Critical CVEs open | F |

How to check: Read `package.json` for `overrides`/`resolutions` (signals known vuln workarounds). Check for `dotnet list package --vulnerable` reference in recent output.

---

## Dimension 5 — Architecture Compliance

**Check**: Banned pattern violations from `knowledge/stack-antipatterns.md`.

| Result | Grade |
|--------|-------|
| Zero violations detected | A |
| 1–3 advisory warnings | B |
| 4–10 advisory warnings | C |
| >10 warnings or any DENY-level blocks | D |
| Systematic violations (e.g., raw HttpClient throughout) | F |

How to check: If `/fsp-audit` was run, read findings with category `antipattern`. Otherwise do a targeted Grep for `new HttpClient()`, `DateTime.Now`, `subscribe(` in `.ts` without `takeUntilDestroyed`.

---

## Dimension 6 — Observability

**Check**: Structured logging + health endpoints + distributed tracing.

| Result | Grade |
|--------|-------|
| Serilog/structured logging + health endpoints (`/health/live`, `/health/ready`) + OTel traces | A |
| Structured logging + health endpoints, no tracing | B |
| Health endpoints only, no structured logging | C |
| Console.WriteLine or no logging configuration | D |
| No logging and no health endpoints | F |

How to check: Grep `Program.cs` for `AddSerilog`, `AddOpenTelemetry`, `MapHealthChecks`. Glob Angular for telemetry service or error-tracking setup.

---

## Report Format

```
## /fsp-health — Stack Health Report
Project: <name from angular.json or .sln>
Date:    <ISO date>

Dimension               Grade  GPA   Notes
─────────────────────────────────────────────────────
Build Health            A      4.0   Clean build, 0 errors, 2 warnings
Test Coverage           B      3.0   Integration tests present, no Testcontainers
Security Posture        A      4.0   No open findings
Dependency Hygiene      B      3.0   2 low-severity npm advisories
Architecture Compliance A      4.0   0 antipattern violations
Observability           C      2.0   Structured logging present, no health endpoints

Overall GPA:  3.3 / 4.0  (B+)
Assessment:   GOOD — ready for production with observability gap addressed

Top 3 Recommendations (by GPA impact):
1. [Observability C→A] Add /health/live and /health/ready endpoints (+0.33 GPA)
   Skill: pilot-core:dotnet-health-checks
2. [Test Coverage B→A] Add Testcontainers to 2 integration test projects (+0.17 GPA)
   Skill: pilot-dotnet:dotnet-testing
3. [Dependency Hygiene B→A] Resolve 2 npm low-severity advisories (+0.17 GPA)
   Run: npm audit fix
```

---

## Conditional Dimensions

- Skip `ng` dimensions if `angular.json` not found
- Skip `dotnet` dimensions if no `.sln` or `.csproj` found
- For a pure Angular project: assess Build, Tests, Security, Dependency Hygiene, Architecture, Observability — all still apply
- Minimum 3 applicable dimensions required to produce a valid report
