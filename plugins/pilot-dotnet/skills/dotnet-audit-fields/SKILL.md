---
name: dotnet-audit-fields
description: Audits EF Core entities for audit-trail hygiene — verifies CreatedAt/CreatedBy/ModifiedAt/ModifiedBy are populated centrally via a SaveChanges override or ISaveChangesInterceptor rather than duplicated per service method, checks for an IAuditable marker interface, validates CreatedBy/ModifiedBy resolve from an injected current-user abstraction, checks Modified fields only update on actually-changed entities, and flags DateTime.Now instead of DateTime.UtcNow. Outputs findings with pilot-dotnet audit-fields standard IDs.
when_to_use: audit trail, CreatedAt, CreatedBy, ModifiedAt, ModifiedBy, IAuditable, SaveChangesInterceptor, ChangeTracker, ICurrentUserService, DateTime.Now, DateTime.UtcNow, audit columns, timestamp fields
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| AUD-001 | P1 | Audit fields populated manually per service method instead of centrally |
| AUD-002 | P1 | No IAuditable marker interface — duplicated per-entity audit logic |
| AUD-003 | P2 | CreatedBy/ModifiedBy hardcoded instead of resolved from ICurrentUserService |
| AUD-004 | P1 | ModifiedAt/ModifiedBy updated on unchanged entities, or not updated on EntityState.Modified |
| AUD-005 | P2 | DateTime.Now used instead of DateTime.UtcNow for audit timestamps |

---

## Check A — Centralized audit population

### Detection

1. Grep service/repository classes for direct assignment to `CreatedAt`, `CreatedBy`, `ModifiedAt`, or `ModifiedBy` properties outside of a `DbContext.SaveChanges`/`SaveChangesAsync` override or an `ISaveChangesInterceptor` implementation.
2. If found in more than one service method → AUD-001.

### BAD — audit fields set in every service method

```csharp
public class OrderService
{
    private readonly AppDbContext _db;

    public OrderService(AppDbContext db) => _db = db;

    public async Task<Order> CreateOrderAsync(Order order)
    {
        order.CreatedAt = DateTime.Now;
        order.CreatedBy = "system";
        _db.Orders.Add(order);
        await _db.SaveChangesAsync();
        return order;
    }

    public async Task UpdateOrderAsync(Order order)
    {
        order.ModifiedAt = DateTime.Now;
        order.ModifiedBy = "system";
        _db.Orders.Update(order);
        await _db.SaveChangesAsync();
    }
}
```

### GOOD — centralized via SaveChanges override

```csharp
public class AppDbContext : DbContext
{
    public override int SaveChanges()
    {
        ApplyAuditInfo();
        return base.SaveChanges();
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        ApplyAuditInfo();
        return base.SaveChangesAsync(cancellationToken);
    }

    private void ApplyAuditInfo()
    {
        var now = DateTime.UtcNow;
        foreach (var entry in ChangeTracker.Entries<IAuditable>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.CreatedAt = now;
                entry.Entity.CreatedBy = _currentUser.UserId;
            }
            if (entry.State == EntityState.Modified)
            {
                entry.Entity.ModifiedAt = now;
                entry.Entity.ModifiedBy = _currentUser.UserId;
            }
        }
    }
}
```

---

## Check B — IAuditable marker interface

### Detection

1. Search for entity classes that each declare their own `CreatedAt`/`CreatedBy`/`ModifiedAt`/`ModifiedBy` properties with separate ad-hoc population code, and no shared interface ties them together.
2. If two or more entities duplicate this population logic independently → AUD-002.

### BAD — duplicated per-entity audit logic

```csharp
public class Order
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
}

public class Invoice
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
}

// Each service duplicates the same "set CreatedAt/CreatedBy" logic independently.
```

### GOOD — shared marker interface handled by one interceptor

```csharp
public interface IAuditable
{
    DateTime CreatedAt { get; set; }
    string CreatedBy { get; set; }
    DateTime? ModifiedAt { get; set; }
    string? ModifiedBy { get; set; }
}

public class Order : IAuditable
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }
}

public class Invoice : IAuditable
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }
}

public class AuditableEntitiesInterceptor : ISaveChangesInterceptor
{
    private readonly ICurrentUserService _currentUser;

    public AuditableEntitiesInterceptor(ICurrentUserService currentUser)
        => _currentUser = currentUser;

    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData, InterceptionResult<int> result)
    {
        ApplyAuditInfo(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        ApplyAuditInfo(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private void ApplyAuditInfo(DbContext? context)
    {
        if (context is null) return;
        var now = DateTime.UtcNow;

        foreach (var entry in context.ChangeTracker.Entries<IAuditable>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.CreatedAt = now;
                    entry.Entity.CreatedBy = _currentUser.UserId;
                    break;
                case EntityState.Modified:
                    entry.Entity.ModifiedAt = now;
                    entry.Entity.ModifiedBy = _currentUser.UserId;
                    break;
            }
        }
    }
}
```

---

## Check C — CreatedBy/ModifiedBy resolved from current-user abstraction

### Detection

1. Search interceptor/`SaveChanges` code for hardcoded string literals (`"system"`, `"admin"`, `"unknown"`) assigned to `CreatedBy`/`ModifiedBy`.
2. If no `ICurrentUserService`/`IUserContext` dependency is injected and used instead → AUD-003.

### BAD — hardcoded system value

```csharp
private void ApplyAuditInfo(DbContext context)
{
    foreach (var entry in context.ChangeTracker.Entries<IAuditable>())
    {
        if (entry.State == EntityState.Added)
        {
            entry.Entity.CreatedBy = "system"; // no idea which user actually did this
        }
    }
}
```

### GOOD — resolved from injected current-user service

```csharp
public interface ICurrentUserService
{
    string UserId { get; }
}

public class HttpContextCurrentUserService : ICurrentUserService
{
    private readonly IHttpContextAccessor _accessor;

    public HttpContextCurrentUserService(IHttpContextAccessor accessor)
        => _accessor = accessor;

    public string UserId =>
        _accessor.HttpContext?.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? "background-job";
}

// Registered in the interceptor and resolved per operation instead of hardcoded.
```

---

## Check D — Modified fields updated only on real changes

### Detection

1. Check whether the interceptor/`SaveChanges` override branches only on `EntityState.Added` and `EntityState.Modified`, and whether `EntityState.Modified` is actually handled (a common bug is checking only `Added`).
2. Check whether `ChangeTracker.DetectChanges()` runs before the audit pass so no-op updates (entity attached and saved without real property changes) don't touch `ModifiedAt`.
3. If `ModifiedAt` is stamped on entities with no actual modified properties, or `EntityState.Modified` is never handled → AUD-004.

### BAD — only handles Added, and stamps ModifiedAt unconditionally

```csharp
private void ApplyAuditInfo(DbContext context)
{
    foreach (var entry in context.ChangeTracker.Entries<IAuditable>())
    {
        if (entry.State == EntityState.Added)
        {
            entry.Entity.CreatedAt = DateTime.UtcNow;
        }
        // BUG: EntityState.Modified never handled — ModifiedAt/ModifiedBy stay stale forever.
    }
}
```

### GOOD — handles both states and skips genuinely unchanged entities

```csharp
private void ApplyAuditInfo(DbContext context)
{
    context.ChangeTracker.DetectChanges();
    var now = DateTime.UtcNow;

    foreach (var entry in context.ChangeTracker.Entries<IAuditable>())
    {
        if (entry.State == EntityState.Added)
        {
            entry.Entity.CreatedAt = now;
            entry.Entity.CreatedBy = _currentUser.UserId;
        }
        else if (entry.State == EntityState.Modified)
        {
            // Only stamp when a property other than the audit fields themselves changed.
            var hasRealChanges = entry.Properties.Any(p =>
                p.IsModified &&
                p.Metadata.Name is not (nameof(IAuditable.ModifiedAt) or nameof(IAuditable.ModifiedBy)));

            if (hasRealChanges)
            {
                entry.Entity.ModifiedAt = now;
                entry.Entity.ModifiedBy = _currentUser.UserId;
            }
        }
    }
}
```

---

## Check E — UtcNow instead of local Now

### Detection

Grep for `DateTime.Now` assigned to any property named `CreatedAt`, `ModifiedAt`, or ending in `At`/`Date`/`Timestamp`. Local server time is ambiguous across deployment regions and breaks comparisons across servers in different time zones.

### BAD — local time

```csharp
entry.Entity.CreatedAt = DateTime.Now;
entry.Entity.ModifiedAt = DateTime.Now;
```

### GOOD — UTC time

```csharp
entry.Entity.CreatedAt = DateTime.UtcNow;
entry.Entity.ModifiedAt = DateTime.UtcNow;
```

**Detection rule:** flag `DateTime.Now` (or `DateTimeOffset.Now`, unless immediately converted `.ToUniversalTime()`) anywhere it is assigned to a property whose name matches `Created*`, `Modified*`, `*At`, `*Date`, or `*Timestamp`.
