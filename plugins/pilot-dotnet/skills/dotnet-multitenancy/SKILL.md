---
name: dotnet-multitenancy
description: Reviews multi-tenancy at the ASP.NET Core API/application layer — tenant resolution, DI lifetime correctness, and connection-routing for both shared-database and database-per-tenant models. Flags ad-hoc per-endpoint tenant resolution instead of centralized middleware, Singleton-scoped tenant context leaking across requests, stale per-request connection strings, missing tenant catalog caching, and silent fallback on unresolved tenants. Cross-references pilot-sql's sql-multitenancy skill for EF Core query-filter enforcement.
when_to_use: multi-tenancy, tenant resolution, ITenantContext, tenant middleware, database per tenant, shared database discriminator, tenant connection string, tenant catalog, DI lifetime tenant, subdomain tenant, tenant header, unresolved tenant, tenant onboarding
---

## Tenancy models

| Model | Isolation | Cost | When to pick |
|-------|-----------|------|---------------|
| Shared DB + discriminator column (`TenantId`) | Row-level, app-enforced | Lowest | Many small tenants, low compliance bar; enforce with EF Core `HasQueryFilter` — see `pilot-sql`'s `sql-multitenancy` skill for that layer |
| Shared DB + schema-per-tenant | Schema-level | Medium | Moderate isolation need without per-tenant infra cost |
| Separate database per tenant | Full physical isolation | Highest | Strict compliance/data-residency requirements, large or enterprise tenants, per-tenant backup/restore/scale needs |

This skill covers tenant resolution and DI/connection-routing concerns that sit above the
data layer and apply to any of the three models. Query-filter enforcement for the shared-DB
model is covered by `pilot-sql`'s `sql-multitenancy` skill (`HasQueryFilter`,
`IgnoreQueryFilters` policy, cross-tenant test scaffolding) — do not duplicate that content
here; reference it when a finding is actually a missing query filter.

---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| TN-001 | P0 | Tenant resolved ad-hoc per-endpoint instead of centralized middleware |
| TN-002 | P0 | Tenant context/resolver registered with Singleton lifetime (cross-request leak) |
| TN-003 | P1 | Shared-DB entity query not scoped to tenant (defer detail to `pilot-sql`'s `sql-multitenancy`) |
| TN-004 | P0 | Database-per-tenant: connection string resolved once at startup instead of per-request |
| TN-005 | P1 | Database-per-tenant: no tenant-to-connection-string catalog/registry, or catalog lookup not cached |
| TN-006 | P0 | Unresolved tenant identifier silently falls back to a default tenant instead of 400/404 |

---

## Check A — Centralized tenant resolution middleware

### Detection

1. Grep for tenant-lookup logic (`Request.Headers["X-Tenant-Id"]`, `HttpContext.Request.Host`,
   `User.FindFirst("tenant_id")`) appearing inside individual controllers/endpoints rather
   than in a single middleware component.
2. If more than one endpoint independently parses the tenant identifier, flag TN-001 —
   resolution logic and its edge cases (missing header, unknown subdomain) diverge over time.

### BAD — resolved inline, per controller

```csharp
[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var tenantId = Request.Headers["X-Tenant-Id"].ToString(); // duplicated everywhere
        var orders = await _orderService.GetForTenantAsync(tenantId);
        return Ok(orders);
    }
}
```

### GOOD — centralized middleware populating a scoped `ITenantContext`

```csharp
public interface ITenantContext
{
    string TenantId { get; }
    void SetTenant(string tenantId);
}

public class TenantContext : ITenantContext
{
    public string TenantId { get; private set; } = string.Empty;
    public void SetTenant(string tenantId) => TenantId = tenantId;
}

public class TenantResolutionMiddleware
{
    private readonly RequestDelegate _next;

    public TenantResolutionMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, ITenantContext tenantContext)
    {
        var tenantId = context.Request.Headers["X-Tenant-Id"].ToString();

        if (string.IsNullOrEmpty(tenantId))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsync("Missing tenant identifier.");
            return;
        }

        tenantContext.SetTenant(tenantId);
        await _next(context);
    }
}

// Program.cs
builder.Services.AddScoped<ITenantContext, TenantContext>();
app.UseMiddleware<TenantResolutionMiddleware>();
```

---

## Check B — DI lifetime correctness for tenant context

### Detection

1. Grep `AddSingleton<ITenantContext` / `AddSingleton<TenantContext`.
2. A Singleton tenant context is populated once and then shared by every concurrent
   request thereafter — this is a cross-tenant data leak, not just a bug. It must be
   `Scoped` (one instance per request).

### BAD — Singleton tenant context

```csharp
// First request sets TenantId="acme"; every later request on this instance,
// regardless of which tenant it belongs to, now reads "acme".
builder.Services.AddSingleton<ITenantContext, TenantContext>();
```

### GOOD — Scoped tenant context

```csharp
builder.Services.AddScoped<ITenantContext, TenantContext>();
```

**Detection rule:** any `AddSingleton` registration of a type whose name matches
`*TenantContext`, `*TenantResolver`, or `*TenantAccessor` is an automatic TN-002 finding
unless the type is provably immutable/stateless (holds no per-request mutable field).

---

## Check C — Shared-DB tenant scoping (cross-reference)

### Detection

1. For the shared-DB + discriminator-column model, check that every `DbSet<T>` for a
   tenant-owned entity is covered by a global query filter.
2. This is deliberately shallow here — full detection steps (`HasQueryFilter` coverage,
   `IgnoreQueryFilters` justification policy, cross-tenant test scaffold, SQL Server RLS)
   live in `pilot-sql`'s `sql-multitenancy` skill. Emit TN-003 as a pointer finding and
   direct the reviewer there rather than re-running that logic.

```csharp
// If this pattern is found without a corresponding HasQueryFilter in OnModelCreating,
// raise TN-003 and reference pilot-sql's sql-multitenancy skill (see MT-001) for the fix.
var orders = await _db.Orders.Where(o => o.Status == OrderStatus.Open).ToListAsync();
```

---

## Check D — Database-per-tenant: connection string resolved per request, not at startup

### Detection

1. Grep `AddDbContext<AppDbContext>(options => options.UseSqlServer(...))` in `Program.cs`
   for a connection string read from `IConfiguration` at container-build time.
2. In the database-per-tenant model, this is wrong — the connection string must be
   resolved from the current tenant on every request, not baked in once at startup.

### BAD — connection string fixed at startup

```csharp
// Program.cs — resolved once, at DI container build time
var connectionString = builder.Configuration.GetConnectionString("Default");
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(connectionString));
// Every tenant, on every request, gets this same connection for the lifetime of the app.
```

### GOOD — connection string resolved per request from tenant context

```csharp
builder.Services.AddDbContext<AppDbContext>((serviceProvider, options) =>
{
    var tenantContext = serviceProvider.GetRequiredService<ITenantContext>();
    var catalog = serviceProvider.GetRequiredService<ITenantConnectionCatalog>();
    var connectionString = catalog.GetConnectionString(tenantContext.TenantId);
    options.UseSqlServer(connectionString);
});
```

Because `AddDbContext` resolves its options delegate per scope (per request, in ASP.NET
Core's default DI container), this pulls the current tenant's connection string fresh on
every request rather than reusing a stale one from startup.

---

## Check E — Missing or uncached tenant-to-connection-string catalog

### Detection

1. Look for the connection-string lookup itself: does a `ITenantConnectionCatalog` (or
   equivalent) exist, and does it cache results, or does it hit the catalog database on
   every single request?
2. No catalog abstraction at all → TN-005 (P1). Catalog exists but re-queries the catalog
   DB on every call → also TN-005, lower-severity performance sub-finding.

### BAD — catalog DB hit on every request, no caching

```csharp
public class TenantConnectionCatalog : ITenantConnectionCatalog
{
    private readonly CatalogDbContext _catalogDb;

    public TenantConnectionCatalog(CatalogDbContext catalogDb) => _catalogDb = catalogDb;

    public string GetConnectionString(string tenantId)
    {
        // Round-trips to the catalog database on every single request.
        var tenant = _catalogDb.Tenants.Single(t => t.TenantId == tenantId);
        return tenant.ConnectionString;
    }
}
```

### GOOD — cached catalog lookup with expiry

```csharp
public class TenantConnectionCatalog : ITenantConnectionCatalog
{
    private readonly CatalogDbContext _catalogDb;
    private readonly IMemoryCache _cache;

    public TenantConnectionCatalog(CatalogDbContext catalogDb, IMemoryCache cache)
    {
        _catalogDb = catalogDb;
        _cache = cache;
    }

    public string GetConnectionString(string tenantId)
    {
        return _cache.GetOrCreate($"tenant-conn:{tenantId}", entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
            var tenant = _catalogDb.Tenants.SingleOrDefault(t => t.TenantId == tenantId);
            if (tenant is null)
            {
                throw new TenantNotFoundException(tenantId);
            }

            return tenant.ConnectionString;
        });
    }
}
```

---

## Check F — Unresolved tenant silently falls back to a default

### Detection

1. Trace what happens when tenant resolution fails to find a match (unknown subdomain,
   unrecognized header value, missing claim).
2. If the code falls back to a "default" or first-configured tenant instead of returning
   `400 Bad Request` / `404 Not Found`, flag TN-006 — this can silently route a user's
   request into the wrong tenant's data store.

### BAD — silent fallback to a default tenant

```csharp
public async Task InvokeAsync(HttpContext context, ITenantContext tenantContext)
{
    var tenantId = context.Request.Headers["X-Tenant-Id"].ToString();

    if (string.IsNullOrEmpty(tenantId) || !await _catalog.ExistsAsync(tenantId))
    {
        tenantId = "default"; // silently mis-routes the request
    }

    tenantContext.SetTenant(tenantId);
    await _next(context);
}
```

### GOOD — explicit failure on unresolved tenant

```csharp
public async Task InvokeAsync(HttpContext context, ITenantContext tenantContext)
{
    var tenantId = context.Request.Headers["X-Tenant-Id"].ToString();

    if (string.IsNullOrEmpty(tenantId))
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsync("Missing tenant identifier.");
        return;
    }

    if (!await _catalog.ExistsAsync(tenantId))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsync("Unknown tenant.");
        return;
    }

    tenantContext.SetTenant(tenantId);
    await _next(context);
}
```
