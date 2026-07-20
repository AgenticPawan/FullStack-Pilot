---
name: sql-performance-review
description: "Reviews .NET + EF Core query patterns for SQL Server performance: detects non-SARGable predicates (function on indexed column, implicit type conversion), identifies N+1 load patterns, flags missing AsNoTracking on read-only paths, recommends covering index columns from WHERE/ORDER patterns, and reads execution plans via the sql-mcp MCP server when available. Defers EF Core query-optimization implementation to the dotnet-data plugin skill."
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

## Check F — Query Store review

SQL Server Query Store captures query plans, runtimes, and statistics without external tooling.
Use it when `sql-mcp` is not available or to identify **plan regression** (the optimizer chose
a worse plan after a statistics update or index change).

### Enabling (must be on for the pattern to work)

```sql
ALTER DATABASE [YourDb] SET QUERY_STORE = ON
    WITH (OPERATION_MODE = READ_WRITE,
          CLEANUP_POLICY = (STALE_QUERY_THRESHOLD_DAYS = 30),
          DATA_FLUSH_INTERVAL_SECONDS = 900,
          MAX_STORAGE_SIZE_MB = 1024,
          QUERY_CAPTURE_MODE = AUTO);
```

### Finding regressions

```sql
-- Top 10 queries by average CPU increase over last 24 hours vs prior 24 hours
SELECT TOP 10
    qsq.query_id,
    qsqt.query_sql_text,
    AVG(qsrs.avg_cpu_time)        AS avg_cpu_recent,
    AVG(qsrs_prior.avg_cpu_time)  AS avg_cpu_prior,
    AVG(qsrs.avg_cpu_time) - AVG(qsrs_prior.avg_cpu_time) AS cpu_delta
FROM sys.query_store_query qsq
JOIN sys.query_store_query_text qsqt ON qsq.query_text_id = qsqt.query_text_id
JOIN sys.query_store_plan qsp ON qsq.query_id = qsp.query_id
JOIN sys.query_store_runtime_stats qsrs
    ON qsp.plan_id = qsrs.plan_id
    AND qsrs.last_execution_time >= DATEADD(hour, -24, GETUTCDATE())
JOIN sys.query_store_runtime_stats qsrs_prior
    ON qsp.plan_id = qsrs_prior.plan_id
    AND qsrs_prior.last_execution_time
        BETWEEN DATEADD(hour, -48, GETUTCDATE()) AND DATEADD(hour, -24, GETUTCDATE())
GROUP BY qsq.query_id, qsqt.query_sql_text
ORDER BY cpu_delta DESC;
```

### Forcing a stable plan (regression mitigation)

```sql
-- After identifying the last-good plan_id from Query Store:
EXEC sp_query_store_force_plan @query_id = <id>, @plan_id = <good-plan-id>;
```

**Findings**

| ID | Severity | What it checks |
|----|----------|----------------|
| QS-001 | P1 | Query Store is OFF on a production database (blind to plan regressions) |
| QS-002 | P1 | A query shows >2× CPU increase between consecutive 24-hour windows (plan regression candidate) |
| QS-003 | P2 | Query Store `MAX_STORAGE_SIZE_MB` is ≤ 100 MB on a busy database (data gaps likely) |
| QS-004 | P2 | `QUERY_CAPTURE_MODE = ALL` on a high-throughput database (excessive capture noise) |

---

## Finding severity

| Pattern | Severity |
|---------|----------|
| N+1 in hot path (API endpoint) | P1 |
| Non-SARGable predicate on large table | P1 |
| Missing AsNoTracking on read endpoint | P2 |
| Missing index recommendation | P2 |
| N+1 in batch/background job | P2 |
