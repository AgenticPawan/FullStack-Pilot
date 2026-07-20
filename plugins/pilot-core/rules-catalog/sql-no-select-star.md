---
id: sql-no-select-star
title: No SELECT * in Application SQL Strings
appliesTo: sql
severity: warn
standard: CWE-1024
---
Never write `SELECT *` in application-level SQL strings (raw SQL passed to
`ExecuteSqlRaw`, `FromSqlRaw`, Dapper queries, or ADO.NET `CommandText`). Always
project the specific columns needed.

**Why:** `SELECT *` creates silent over-fetching (pulls columns the app discards),
breaks any covering-index optimisation (SQL Server must do a Key Lookup for non-index
columns), and couples the application to schema changes — adding a new column with
sensitive data (e.g. a `PasswordHash` column added later) silently exposes it in an
existing query result.

**BAD**
```csharp
var orders = await _db.Orders
    .FromSqlRaw("SELECT * FROM Orders WHERE TenantId = {0}", tenantId)
    .ToListAsync(ct);
```

**GOOD**
```csharp
// Use EF Core LINQ projection — columns explicit, change-tracked only for writes
var orders = await _db.Orders
    .Where(o => o.TenantId == tenantId)
    .Select(o => new OrderDto { Id = o.Id, Status = o.Status, Total = o.Total })
    .AsNoTracking()
    .ToListAsync(ct);
```

**Scope:** this rule targets SQL strings in `.cs` files only. ORM-generated SQL and
migration scripts that use `SELECT *` for structural queries (e.g. `sys.columns`) are
out of scope.

Cross-reference: `sql-performance-review` (Check D — covering index), `dotnet-data`.
