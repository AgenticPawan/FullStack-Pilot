# FullStack Pilot — Cursor Rules

> Consolidated governance rules for full-stack Microsoft projects (Angular / .NET / SQL Server / Azure).
> Source: AgenticPawan/FullStack-Pilot plugin marketplace.
> For full skill depth, install the plugin: `/plugin marketplace add AgenticPawan/FullStack-Pilot`

---

## Cross-Stack (Always)

### Conventional Commits
All commits must follow `<type>(<scope>): <subject>` format.
Types: `feat`, `fix`, `docs`, `ci`, `chore`, `refactor`, `test`, `perf`.
Breaking changes use `!` suffix or `BREAKING CHANGE:` footer.

```
# BAD:  "fix stuff" / "WIP" / "changes"
# GOOD: "fix(auth): handle token expiry before refresh window closes"
```

### No Hardcoded Secrets (OWASP-A02 — block)
Store secrets in environment variables, Azure Key Vault, or .NET user-secrets.
Never embed credentials, API keys, or connection strings in source files or IaC templates.

```csharp
// BAD — literal credential in source
// var conn = "Server=prod.database.windows.net;User=admin;Password=<literal>";

// GOOD — real value injected at runtime via Key Vault reference
var conn = builder.Configuration.GetConnectionString("Default");
```

### Structured Logging — No String Interpolation, PII Redacted (OWASP-A09)
Use named placeholders. Never interpolate variables directly into log message strings.
Mask or omit PII fields (email, phone, card number).

```csharp
// BAD
_logger.LogInformation($"User {user.Email} logged in from {ip}");

// GOOD
_logger.LogInformation("User {UserId} logged in from {IpHash}", user.Id, HashIp(ip));
```

---

## Angular / TypeScript

### No `[innerHTML]` Without Justification (OWASP-A03 — block)
Never bind user-controlled content to `[innerHTML]`. Use text bindings by default.
If HTML is required, use `DomSanitizer.bypassSecurityTrustHtml` with a justification comment.

```html
<!-- BAD -->
<div [innerHTML]="userContent"></div>

<!-- GOOD — use text binding -->
<div>{{ userContent }}</div>
```

### Permission-Based Authorization Only — No Role Checks (OWASP-A01 — block)
Route guards and structural directives must check a permission claim, never a role name.
Client-side gating is UX only — the real authorization boundary is the .NET API.

```typescript
// BAD
canActivate: [() => inject(AuthService).hasRole('Manager')]

// GOOD
canActivate: [() => inject(PermissionService).hasPermission('orders.approve')]
```

### Angular 17+ Control Flow (block on Angular 17+)
Use `@if`, `@for`, `@switch` built-in control flow. Do not use `*ngIf`, `*ngFor`, `*ngSwitch` in new components.

```html
<!-- BAD (Angular 17+) -->
<div *ngIf="isLoading">...</div>
<li *ngFor="let item of items">...</li>

<!-- GOOD -->
@if (isLoading) { <div>...</div> }
@for (item of items; track item.id) { <li>...</li> }
```

### `subscribe()` Must Have Cleanup
All `subscribe()` calls in components must include `takeUntilDestroyed(this.destroyRef)` (Angular 16+) or use the `async` pipe. Uncleaned subscriptions are memory leaks.

```typescript
// BAD
this.service.data$.subscribe(d => this.data = d);

// GOOD
this.service.data$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(d => this.data = d);
// OR use: | async pipe in template
```

### No `: any` Type Bindings
Use concrete interfaces, `unknown`, or generics instead of `: any`. The `any` type defeats TypeScript's type system and breaks refactoring tools.

### Signals for Local State (Angular 17+)
Use `signal()` for local component state instead of plain properties. Signals are required by future Zoneless Angular.

```typescript
// BAD (Angular 17+)
isLoading = false;

// GOOD
isLoading = signal(false);
```

---

## .NET / C#

### `IHttpClientFactory` — Never `new HttpClient()` (CWE-400 — block)
`new HttpClient()` causes socket exhaustion. Always inject via `IHttpClientFactory`.

```csharp
// BAD
using var client = new HttpClient();

// GOOD — registered in Program.cs: builder.Services.AddHttpClient<MyService>();
public MyService(HttpClient client) => _client = client;
```

### EF Core — Projection-First, `AsNoTracking()` (warn)
Use `Select()` projections and `AsNoTracking()` for read queries.
Never call `ToList()` before `Where`/`Select` (client-side evaluation).

```csharp
// BAD — loads entire table, filters in memory
var names = db.Products.ToList().Where(p => p.IsActive).Select(p => p.Name);

// GOOD
var names = await db.Products.AsNoTracking()
    .Where(p => p.IsActive).Select(p => p.Name).ToListAsync(ct);
```

### Polly v8 Resilience Pipelines (block on .NET 8+)
All HTTP calls and external integrations must use a named resilience pipeline.
Ad-hoc retry loops are a code-review block.

```csharp
// GOOD — Program.cs
builder.Services.AddResiliencePipeline("payments", b => b
    .AddRetry(new RetryStrategyOptions { MaxRetryAttempts = 3 })
    .AddTimeout(TimeSpan.FromSeconds(10))
    .AddCircuitBreaker(new CircuitBreakerStrategyOptions()));
```

### No `async void` — Return `Task`
`async void` swallows exceptions. Return `Task` from all async methods. Exception: event handler delegates.

### No `.Result` / `.GetAwaiter().GetResult()` — Await Throughout
`.Result` and `.GetAwaiter().GetResult()` deadlock ASP.NET Core request threads. Use `await` throughout the call chain.

### No `DateTime.Now` — Use `TimeProvider` (.NET 8+)
`DateTime.Now` is untestable. Inject `TimeProvider`; use `FakeTimeProvider` in tests.

### No Repository Pattern Wrapping EF Core (see ADR-003)
`DbContext` is the unit of work and repository. Do not wrap it in `IXxxRepository` interfaces. Inject `AppDbContext` directly.

### Permissions-Only Authorization — No `[Authorize(Roles = "...")]`
Use claim-based policies: `policy.RequireClaim("permission", "orders:write")`. See ADR-001.

---

## SQL Server / EF Core

### Parameterized Queries Only (OWASP-A03, CWE-89 — block)
Never build SQL by string concatenation or interpolation into raw SQL strings.

```csharp
// BAD
var sql = "SELECT * FROM Users WHERE Name = '" + name + "'";
db.Database.ExecuteSqlRaw(sql);

// GOOD — EF Core LINQ (always parameterized)
var users = await db.Users.Where(u => u.Name == name).ToListAsync();

// GOOD — raw SQL, safe interpolated form
db.Orders.FromSqlInterpolated($"EXEC sp_GetOrder {orderId}");
```

### No Unreviewed Destructive Migrations (block)
`DropColumn`, `DropTable`, and type-narrowing `AlterColumn` in a migration `Up()` must include a comment confirming data-loss impact has been reviewed and a rollback plan exists.

### Tenant Filter at DbContext Level (see ADR-005)
Multi-tenant queries must use EF Core global query filters applied in `OnModelCreating`. Never add `Where(x => x.TenantId == ...)` manually in every handler.

### No `SELECT *` in Application Queries
Select only the columns needed. `SELECT *` prevents covering index usage and breaks when columns are added or renamed.

### Index FK Columns
All foreign key columns must have an index. `HasIndex(o => o.CustomerId)` in `OnModelCreating`.

---

## Azure / Bicep

### Managed Identity over Connection Strings (warn)
Authenticate to Azure services via Managed Identity (`DefaultAzureCredential`). Never embed connection strings or account keys in code or IaC. See ADR-001.

### CAF Resource Naming
Resource names must follow CAF convention: `<type>-<workload>-<env>-<region>-<instance>`
Example: `st-myapp-dev-eus-001` (storage account), `kv-myapp-prod-weu-001` (key vault).

### No `allowBlobPublicAccess: true` or Wide Firewall Rules (block)
Public blob access and `0.0.0.0–255.255.255.255` firewall rules are blocked. Use private endpoints or VNet-restricted rules.

### Resource Locks on Production
All production resources must have a `CanNotDelete` lock. No exceptions without a documented justification in the PR.

---

## Agent Routing (when using Claude Code with this plugin)

| Symptom | Agent |
|---------|-------|
| Frontend / browser issue | `@angular-support` |
| Backend / API exception | `@dotnet-support` |
| Database / query / migration | `@sql-support` |
| Infrastructure / deployment | `@infra-support` |
| Multi-layer / unknown layer | `@fullstack-support` (triage first) |
| PR review (multi-layer diff) | `@fullstack-reviewer` |
| Feature spec & planning | `@fsp-analyst` then `/fsp-build` |
| Architecture assessment | `@fsp-architect` |

See `AGENTS.md` at the repository root for the full routing table, cross-agent coordination rules, and MCP-first tool order.
