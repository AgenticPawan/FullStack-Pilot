# vulnerable-app — Acceptance Gate for /pilot-audit

This fixture seeds exactly 8 known vulnerabilities. Running `/pilot-audit` must detect
at least 7 of 8 with correct severity and file:line. Zero fabricated findings allowed.

## Known vulnerabilities

| # | ID | Severity | CWE | File | Approx. line | Description |
|---|----|----------|-----|------|-------------|-------------|
| 1 | VULN-001 | P0 | CWE-89 | `src/VulnerableApp.Api/Controllers/UsersController.cs` | 20 | SQL injection via `$"…'{name}'"` passed to `FromSqlRaw` |
| 2 | VULN-002 | P0 | CWE-798 | `src/VulnerableApp.Api/Data/AppDbContext.cs` | 11 | Hardcoded production password in `HardcodedConnectionString` |
| 3 | VULN-003 | P0 | CWE-862 | `src/VulnerableApp.Api/Controllers/OrdersController.cs` | 9 | Controller-level missing `[Authorize]` — all endpoints public |
| 4 | VULN-004 | P0 | CWE-639 | `src/VulnerableApp.Api/Controllers/OrdersController.cs` | 28 | IDOR — `GetById` returns order without ownership check |
| 5 | VULN-005 | P1 | CWE-1395 | `src/VulnerableApp.Api/VulnerableApp.Api.csproj` | — | `Newtonsoft.Json 12.0.3` — GHSA-5crp-9r3c-p9vr (CVSS 7.5) |
| 6 | VULN-006 | P0 | CWE-79 | `ClientApp/src/app/product-detail/product-detail.component.ts` | 19 | XSS via `[innerHTML]="product.description"` with unsanitised user content |
| 7 | VULN-007 | P0 | CWE-284 | `src/VulnerableApp.Api/Data/AppDbContext.cs` | 30 | Missing EF Core global query filter for `TenantId` on `Order` entity |
| 8 | VULN-008 | P0 | CWE-89 | `src/VulnerableApp.Api/Data/OrderRepository.cs` | 17 | Raw SQL via string concatenation in `GetByStatusAsync` |

## Detection method by finding

| Finding | Primary detector |
|---------|-----------------|
| VULN-001 | Semgrep `p/security-audit` OR Claude semantic (Check A / D) |
| VULN-002 | Claude semantic (Check D) OR secret-guard hook pattern |
| VULN-003 | Claude semantic (Check A) |
| VULN-004 | Claude semantic (Check A — IDOR) |
| VULN-005 | `dotnet list package --vulnerable --include-transitive` |
| VULN-006 | Semgrep `p/typescript` OR Claude semantic (Check D) |
| VULN-007 | Claude semantic (Check B — tenant isolation) |
| VULN-008 | Semgrep `p/csharp` OR Claude semantic (Check A / D) |

## Pass/fail criteria

- ≥ 7 of 8 findings detected with correct severity (±1 level is acceptable for P1/P2 boundary)
- Each finding must include `file` and `line` (or "see file" for package-level findings)
- Each finding must include non-empty `evidence` quoting the problematic code
- Zero findings in the report that do not correspond to a real issue in the fixture
