---
name: sql-performance-review
description: Reviews .NET + EF Core query patterns for SQL Server performance: detects non-SARGable predicates (function on indexed column, implicit type conversion), identifies N+1 load patterns, flags missing AsNoTracking on read-only paths, recommends covering index columns from WHERE/ORDER patterns, and reads execution plans via the sql-mcp MCP server when available. Defers EF Core query-optimization implementation to the dotnet-data plugin skill.
when_to_use: SQL performance, slow query, N+1, missing index, SARGable, implicit conversion, AsNoTracking, Include, execution plan, query plan, covering index, EF Core performance
---

## Scope and escalation

This skill **identifies** performance issues and recommends fixes. It does **not** implement
EF Core query rewrites — route those to the `dotnet-data` plugin skill.

If the `sql-mcp` MCP server is available (`@sql` tools present in the session), use it
to read actual execution plans. If not, analyse query patterns from source code alone.

---

## Check A — SARGability

A predicate is SARGable (Search ARGument able) when SQL Server can use a B-tree index seek
rather than a full scan.

### Non-SARGable patterns (always a finding)

```csharp
// BAD: function on the indexed column — forces scan
.Where(u => u.Email.ToLower() == email.ToLower())
// FIX: use case-insensitive collation or EF.Functions.Collate

// BAD: YEAR() / MONTH() functions — forces scan
.Where(o => o.CreatedAt.Year == 2024)
// FIX: .Where(o => o.CreatedAt >= new DateTime(2024, 1, 1) && o.CreatedAt < new DateTime(2025, 1, 1))

// BAD: string conversion on a numeric PK — implicit conversion
.Where(u => u.Id.ToString() == idParam)
// FIX: parse idParam to int before the Where clause
```

**Detection rule:** scan for `.Where(` expressions calling `.ToLower()`, `.ToUpper()`,
`.ToString()`, `.Year`, `.Month`, `.Day`, `EF.Functions.Like` on a non-string column.

---

## Check B — N+1 query patterns

```csharp
// BAD: Select inside a loop triggers one query per outer row
foreach (var order in orders)
{
    var items = await _db.OrderItems.Where(i => i.OrderId == order.Id).ToListAsync();
}

// GOOD: Include loads items in one JOIN
var orders = await _db.Orders
    .Include(o => o.Items)
    .ToListAsync();

// GOOD (projection): when only a subset of columns is needed
var result = await _db.Orders
    .Select(o => new { o.Id, ItemCount = o.Items.Count })
    .ToListAsync();
```

**Detection rule:** nested async calls to `_db.<Entity>` inside a `foreach` / `for` loop
that iterates over a previously loaded collection.

---

## Check C — Missing AsNoTracking

EF Core tracks every entity returned by default. Read-only queries pay the tracking overhead
for no benefit.

```csharp
// BAD: tracked query — allocates snapshot for change detection
var orders = await _db.Orders.Where(o => o.Status == "Active").ToListAsync();

// GOOD: no tracking — faster, less memory
var orders = await _db.Orders
    .AsNoTracking()
    .Where(o => o.Status == "Active")
    .ToListAsync();
```

**Detection rule:** any `ToListAsync()` / `FirstOrDefaultAsync()` / `SingleOrDefaultAsync()`
call that is not preceded by `.AsNoTracking()` and is in a method not also calling
`.Add()`, `.Update()`, `.Remove()`, or `SaveChangesAsync()` on the result.

---

## Check D — Missing covering index recommendations

When a `WHERE` or `ORDER BY` clause references a column that is neither the primary key
nor an apparent index candidate, flag it for index review.

Common missed cases:
- `WHERE Status = @Status` on a high-cardinality status enum column
- `ORDER BY CreatedAt DESC` on a table without a descending index on that column
- Composite `WHERE TenantId = @t AND Status = @s` without a composite index

Output as P2 findings with the recommended index DDL:

```sql
-- Recommended: covering index for (TenantId, Status) with include columns
CREATE INDEX IX_Orders_TenantId_Status
ON Orders (TenantId, Status)
INCLUDE (Id, CreatedAt, Total);
```

---

## Check E — Execution plan review (sql-mcp only)

When `sql-mcp` MCP server tools are available:

1. Identify the top 3 slowest queries by pattern complexity (N+1, missing index, scan).
2. Call the MCP tool to retrieve the actual execution plan for each query.
3. Look for: Clustered Index Scan on large tables, Key Lookup operators, Sort operators
   without a supporting index, high estimated row count mismatches (statistics stale).
4. Report each operator with cost % > 30 as a separate finding.

If sql-mcp is not available, note "execution plan review skipped — sql-mcp not configured"
and continue with static analysis only.

---

## Finding severity

| Pattern | Severity |
|---------|----------|
| N+1 in hot path (API endpoint) | P1 |
| Non-SARGable predicate on large table | P1 |
| Missing AsNoTracking on read endpoint | P2 |
| Missing index recommendation | P2 |
| N+1 in batch/background job | P2 |
