# Fix Strategies — Reference for batched-remediation skill

One section per CWE / pattern. Each section gives the minimal fix and the constraints
the skill must observe. The skill reads this file during Step 6.

---

## CWE-89 — SQL Injection (string concatenation into raw SQL)

**Patterns detected:**
- `FromSqlRaw(` where the argument contains `+` or `$"..."` with interpolated variables
- `ExecuteSqlRaw(` with same patterns
- `Database.ExecuteSqlRaw(`

**Fix — preferred (EF Core LINQ):**
Replace the raw SQL method with an EF Core LINQ expression. This is always safe and
keeps query logic in the type system.

```csharp
// BEFORE
var sql = $"SELECT * FROM Users WHERE Name = '{name}'";
var users = await _db.Users.FromSqlRaw(sql).ToListAsync();

// AFTER
var users = await _db.Users
    .Where(u => u.Name == name)
    .ToListAsync();
```

**Fix — fallback (when stored proc or complex SQL must remain):**
Use `FromSqlInterpolated` which EF Core converts to parameters automatically.

```csharp
// BEFORE
var sql = "SELECT * FROM Orders WHERE Status = '" + status + "'";
return await _db.Orders.FromSqlRaw(sql).ToListAsync();

// AFTER
return await _db.Orders
    .FromSqlInterpolated($"SELECT * FROM Orders WHERE Status = {status}")
    .ToListAsync();
```

**Constraints:**
- Never use `FromSqlRaw` with user-controlled input — only with fully static strings.
- Prefer LINQ over raw SQL. Use raw SQL only when LINQ cannot express the query.
- If switching to LINQ changes observable query behavior (e.g., removes a hint), note
  it in the PR description under Breaking Changes.

---

## CWE-798 — Hardcoded Credentials

**Patterns detected:**
- String literal containing `Password=`, `AccountKey=`, `ApiKey=`, bearer token, PEM
- Assigned to a field, const, or passed directly to a constructor

**Fix:**
Replace the hardcoded value with `IConfiguration` injection. Add a placeholder in
`appsettings.json`. Add a comment directing to Key Vault / user-secrets for real values.

```csharp
// BEFORE
private const string HardcodedConnectionString =
    "Server=prod.database.windows.net;Password=Sup3rS3cr3t123!;";

// AFTER — inject IConfiguration
private readonly string _connectionString;

public AppDbContext(IConfiguration configuration)
{
    _connectionString = configuration.GetConnectionString("Default")
        ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");
}
```

`appsettings.json` placeholder (never commit real values):
```json
{
  "ConnectionStrings": {
    "Default": "Server=<host>;Database=<db>;Authentication=Active Directory Default;"
  }
}
```

**Constraints:**
- Never write the real credential value anywhere in the fix.
- If the class previously had a parameterless constructor that EF tooling relied on
  (e.g., design-time factory), add a `IDesignTimeDbContextFactory<T>` implementation
  rather than removing the default constructor. Flag this in the PR description.
- This fix changes the constructor signature — flag as API surface change if the
  DbContext is instantiated directly outside of DI in tests.

---

## CWE-862 — Missing Authorization

**Patterns detected:**
- Controller class or action method lacks `[Authorize]` / `[RequireAuthorization]`
- No `[AllowAnonymous]` marking it as intentionally public
- Endpoint accesses persistent state (reads/writes data) — not just health checks

**Fix:**
Add `[Authorize]` at the controller level when all endpoints in the controller require
authentication. Add it at the method level only when it's a single endpoint.

```csharp
// BEFORE
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase { ... }

// AFTER
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class OrdersController : ControllerBase { ... }
```

**Constraints:**
- This is an **API surface change**. Existing callers that do not send a bearer token
  will receive 401. Always trigger the human sign-off gate (Step 3) before applying.
- If any endpoints in the controller are intentionally public (e.g., health, status),
  add `[AllowAnonymous]` to those specific methods before adding `[Authorize]` to the
  class. List them in the PR description.
- Do not add a specific policy or role unless the finding specifies one — use bare
  `[Authorize]` (requires any authenticated user) unless the security requirement is
  more specific.

---

## CWE-639 — IDOR (Insecure Direct Object Reference)

**Patterns detected:**
- `FindAsync(id)` / `FirstOrDefaultAsync(x => x.Id == id)` without a follow-up check
  that the resource's owner/tenant matches the current user's claim

**Fix:**
After fetching the resource, verify ownership before returning it.

```csharp
// BEFORE
[HttpGet("{id:int}")]
public async Task<IActionResult> GetById(int id)
{
    var order = await _db.Orders.FindAsync(id);
    if (order is null) return NotFound();
    return Ok(order);
}

// AFTER
[HttpGet("{id:int}")]
public async Task<IActionResult> GetById(int id)
{
    var order = await _db.Orders.FindAsync(id);
    if (order is null) return NotFound();

    var currentUserId = int.Parse(
        User.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new UnauthorizedAccessException());

    if (order.UserId != currentUserId)
        return Forbid();

    return Ok(order);
}
```

**Constraints:**
- The claim type must match what the project's auth middleware issues. Check
  `Program.cs` JWT configuration for the name identifier claim. If it cannot be
  determined from the file budget, use `ClaimTypes.NameIdentifier` and note the
  assumption in the PR description.
- If the controller does not have `[Authorize]`, this fix alone is insufficient —
  it must be paired with the CWE-862 fix. Group them if both apply to the same
  controller.

---

## CWE-79 — Cross-Site Scripting (XSS via [innerHTML])

**Patterns detected:**
- `[innerHTML]="<expression>"` in Angular component templates where the bound value
  originates from user input, an API response, or is not explicitly sanitized

**Fix — preferred (text binding):**
Replace `[innerHTML]` with Angular's safe text interpolation. Loses HTML rendering but
eliminates the XSS vector entirely.

```html
<!-- BEFORE -->
<div [innerHTML]="product.description"></div>

<!-- AFTER -->
<div>{{ product.description }}</div>
```

**Fix — fallback (when rich HTML is a product requirement):**
Sanitize explicitly and add a justification comment.

```typescript
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export class ProductDetailComponent {
  sanitizedDescription: SafeHtml;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit() {
    // Source: CMS-rendered markdown — server validates no user-supplied HTML is accepted
    this.sanitizedDescription =
      this.sanitizer.sanitize(SecurityContext.HTML, this.product.description) ?? '';
  }
}
```

Template:
```html
<div [innerHTML]="sanitizedDescription"></div>
```

**Constraints:**
- Default to text binding unless the user explicitly confirms rich HTML is required.
- The justification comment is mandatory when keeping `[innerHTML]` — never remove it.
- `bypassSecurityTrustHtml` must NOT be used unless the source is definitively
  server-controlled with no user-supplied HTML path. Flag any use of
  `bypassSecurityTrustHtml` as a separate finding.

---

## CWE-284 — Missing Tenant Query Filter

**Patterns detected:**
- Entity with `TenantId` or `OrganisationId` property exists
- `OnModelCreating` does not call `HasQueryFilter` for that entity type
- OR `HasQueryFilter` exists but uses a hard-coded tenant value instead of a
  scoped service

**Fix:**
Inject a tenant-resolution service and apply a global query filter. The filter runs
automatically on every EF Core query for that entity type.

```csharp
public class AppDbContext : DbContext
{
    private readonly ITenantContext _tenant;

    public AppDbContext(DbContextOptions<AppDbContext> options, ITenantContext tenant)
        : base(options)
    {
        _tenant = tenant;
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Order>()
            .HasQueryFilter(o => o.TenantId == _tenant.CurrentTenantId);

        modelBuilder.Entity<User>()
            .HasQueryFilter(u => u.TenantId == _tenant.CurrentTenantId);
    }
}
```

**Constraints:**
- If `ITenantContext` (or equivalent) does not exist in the project, add a minimal
  interface and a stub implementation, and note in the PR description that a real
  implementation must be wired before the filter is effective.
- This fix changes the DbContext constructor signature — flag as API surface change
  if DbContext is instantiated directly in tests.
- Add a migration check note: `HasQueryFilter` does not generate a migration but may
  break existing queries that relied on cross-tenant access. Note in PR description.

---

## CWE-1395 — Vulnerable Package Version

**Patterns detected:**
- `dotnet list package --vulnerable` reports an advisory against a direct dependency
- `npm audit` reports a high/critical advisory against a direct dependency

**Fix — .NET:**
Update the `<PackageReference>` version in the relevant `.csproj` to the minimum safe
version listed in the advisory.

```xml
<!-- BEFORE -->
<PackageReference Include="Newtonsoft.Json" Version="12.0.3" />

<!-- AFTER — minimum safe version per GHSA-5crp-9r3c-p9vr -->
<PackageReference Include="Newtonsoft.Json" Version="13.0.2" />
```

**Fix — npm:**
Update the entry in `package.json` and note that `npm install` must be run to update
`package-lock.json`.

**Constraints:**
- Always use the minimum safe version, not "latest", to avoid accidental major-version
  bumps that could break APIs.
- If the advisory only affects transitive dependencies, add an explicit `<PackageReference>`
  override at the minimum safe version and note it is a transitive override.
- After the version bump, run `dotnet list package --vulnerable` again to confirm the
  advisory no longer appears. Note the result in the PR description.
- If the minimum safe version is a major-version bump (e.g., 12.x → 13.x), flag as a
  breaking change requiring human sign-off — the package's public API may have changed.
