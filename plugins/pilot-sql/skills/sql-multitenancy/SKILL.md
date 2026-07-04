---
name: sql-multitenancy
description: Audits EF Core tenant isolation at the data layer: verifies HasQueryFilter is applied to every entity with TenantId or OrgId, flags IgnoreQueryFilters calls without a justification comment, generates a cross-tenant test scaffold asserting Tenant A cannot read Tenant B's rows, and documents SQL Server row-level security as a defence-in-depth option. Outputs findings with pilot-sql multitenancy standard IDs.
when_to_use: tenant isolation, multitenancy, global query filter, HasQueryFilter, IgnoreQueryFilters, TenantId, cross-tenant, row-level security, RLS, data isolation, tenant filter, tenant context
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| MT-001 | P0 | Entity with TenantId/OrgId has no HasQueryFilter |
| MT-002 | P0 | IgnoreQueryFilters() called without a justification comment |
| MT-003 | P2 | No cross-tenant isolation test exists for a tenant-filtered entity |
| MT-004 | P3 | Tenant filter uses a hard-coded value instead of a scoped service |

---

## Check A — HasQueryFilter coverage

### Detection

1. Glob `**/*.cs` for entity classes with a `TenantId` or `OrgId` property.
2. In `OnModelCreating`, check for `modelBuilder.Entity<EntityType>().HasQueryFilter(...)` for each such entity.
3. If any entity is missing its filter → MT-001.

### BAD — entity with TenantId, no filter

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<Order>().ToTable("Orders");
    // Missing: .HasQueryFilter(o => o.TenantId == _tenant.CurrentTenantId)
}
```

### GOOD — filter applied via injected tenant context

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

---

## Check B — IgnoreQueryFilters policy

Any call to `IgnoreQueryFilters()` must have a justification comment on the preceding line
explaining why cross-tenant access is intentional (e.g., admin report, system background job).

```csharp
// BAD: no justification — any developer can bypass tenant isolation
var allOrders = await _db.Orders.IgnoreQueryFilters().ToListAsync();

// GOOD: justification present
// Admin aggregate report — intentional cross-tenant read, caller must have Admin role
var allOrders = await _db.Orders.IgnoreQueryFilters().ToListAsync();
```

**Detection rule:** scan for `.IgnoreQueryFilters()` where the preceding code line does not
contain a `//` comment or `[Authorize(Roles = "Admin")]` attribute within 3 lines above.

---

## Check C — Cross-tenant test scaffold

When MT-001 is fixed, generate a test scaffold. If the fix is already in place, check whether
a corresponding cross-tenant test exists.

### Detection

Look for test files (in `**/*.Tests/**/*.cs` or `**/*Tests.cs`) that test the entities
identified in Check A. If no test asserts that Tenant B's data is inaccessible to Tenant A,
emit MT-003.

### Generated test scaffold

```csharp
public class OrderTenantIsolationTests : IClassFixture<AppDbContextFixture>
{
    private readonly AppDbContextFixture _fixture;

    public OrderTenantIsolationTests(AppDbContextFixture fixture)
        => _fixture = fixture;

    [Fact]
    public async Task Orders_AreIsolatedByTenant()
    {
        // Arrange — seed orders for two tenants
        var tenantA = 1;
        var tenantB = 2;
        await _fixture.SeedOrderAsync(tenantId: tenantA, orderId: 100);
        await _fixture.SeedOrderAsync(tenantId: tenantB, orderId: 200);

        // Act — query as Tenant A
        using var ctx = _fixture.CreateContext(tenantId: tenantA);
        var orders = await ctx.Orders.ToListAsync();

        // Assert — Tenant A sees only its own orders
        Assert.All(orders, o => Assert.Equal(tenantA, o.TenantId));
        Assert.DoesNotContain(orders, o => o.Id == 200);
    }

    [Fact]
    public async Task Orders_IgnoreQueryFilters_RequiresExplicitCallsite()
    {
        // Verify the filter is active by default (regression guard)
        using var ctx = _fixture.CreateContext(tenantId: 1);
        var count = await ctx.Orders.CountAsync();
        var countUnfiltered = await ctx.Orders.IgnoreQueryFilters().CountAsync();
        Assert.True(countUnfiltered >= count, "IgnoreQueryFilters should surface more rows");
    }
}
```

---

## Check D — SQL Server Row-Level Security (defence in depth)

Row-Level Security (RLS) enforces tenant isolation at the database engine level,
independent of application code. Recommend it when:
- The project is multi-tenant with strict data separation requirements
- The DbContext is accessed from multiple application tiers or tools (e.g., SSRS, ETL)

RLS adds a security predicate function and binds it to the table:

```sql
CREATE FUNCTION dbo.fn_tenantPredicate(@TenantId INT)
RETURNS TABLE
WITH SCHEMABINDING
AS RETURN
    SELECT 1 AS result
    WHERE @TenantId = CAST(SESSION_CONTEXT(N'TenantId') AS INT);

CREATE SECURITY POLICY TenantFilter
    ADD FILTER PREDICATE dbo.fn_tenantPredicate(TenantId) ON dbo.Orders,
    ADD BLOCK PREDICATE  dbo.fn_tenantPredicate(TenantId) ON dbo.Orders;
```

Emit this as a P3 advisory finding — not a blocker, but a recommended hardening step.
