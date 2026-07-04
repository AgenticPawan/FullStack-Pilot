---
id: dotnet-efcore-projection
title: EF Core — Projection-First, AsNoTracking, Verified Global Filters
appliesTo: dotnet
severity: warn
standard: CWE-89
---
Use `Select()` projections and `AsNoTracking()` for read queries. Never allow client-side evaluation (no `ToList()` before `Where`/`Select`). Global query filters for tenant isolation and soft-delete must be covered by at least one test asserting the filter fires.

**BAD**
```csharp
// Client-side evaluation: loads entire table, then filters in memory
var names = db.Products.ToList().Where(p => p.IsActive).Select(p => p.Name);
```

**GOOD**
```csharp
var names = await db.Products
    .AsNoTracking()
    .Where(p => p.IsActive)
    .Select(p => p.Name)
    .ToListAsync(cancellationToken);
```
