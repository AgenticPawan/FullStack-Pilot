---
name: sql-index-maintenance
description: Reviews ongoing SQL Server index/statistics maintenance as an operational concern distinct from sql-performance-review's query-level analysis. Flags no scheduled job rebuilding/reorganizing fragmented indexes, no statistics-update cadence for tables with volatile data, no monitoring for unused indexes accumulating write overhead, and no maintenance-window awareness for online vs offline index operations. Outputs findings with pilot-sql index-maintenance standard IDs.
when_to_use: index fragmentation, index rebuild, index reorganize, statistics update, sp_updatestats, unused index, maintenance window, ONLINE index operation, index maintenance job, sys.dm_db_index_physical_stats
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| IDX-001 | P1 | No scheduled job rebuilding/reorganizing fragmented indexes |
| IDX-002 | P1 | No statistics-update cadence for tables with volatile data |
| IDX-003 | P2 | No monitoring for unused indexes accumulating write overhead |
| IDX-004 | P2 | No maintenance-window awareness for online vs offline index operations |

`sql-performance-review` reviews individual queries (SARGability, missing indexes for a
specific access pattern); this skill governs the ongoing operational health of indexes
that already exist — a good index recommendation degrades over time without maintenance.

---

## Check A — No scheduled fragmentation maintenance (IDX-001)

### Detection

Check for a scheduled job (SQL Agent job, Hangfire job per `dotnet-background-jobs`, or
Azure SQL's built-in automatic tuning) that rebuilds/reorganizes indexes once
fragmentation crosses a threshold. Without one, indexes fragment over time as rows are
inserted/updated/deleted, and query performance degrades gradually with no single event
to point to — it just gets slower every month until someone investigates.

### BAD — no maintenance job, fragmentation grows unchecked

```sql
-- No scheduled job anywhere queries sys.dm_db_index_physical_stats or acts on it.
-- Query plans that were fine at launch are 40% slower a year later with no alert fired.
```

### GOOD — a scheduled job applying the standard fragmentation thresholds

```sql
-- Runs weekly via SQL Agent (or a Hangfire recurring job, per dotnet-background-jobs)
SELECT s.name AS SchemaName, t.name AS TableName, i.name AS IndexName, ps.avg_fragmentation_in_percent
INTO #FragmentedIndexes
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ps
JOIN sys.indexes i ON ps.object_id = i.object_id AND ps.index_id = i.index_id
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE ps.avg_fragmentation_in_percent > 5 AND ps.page_count > 1000;

-- 5-30% fragmented: REORGANIZE (online, low-impact)
-- >30% fragmented: REBUILD (prefer WITH (ONLINE = ON) — see Check D)
```

---

## Check B — No statistics-update cadence (IDX-002)

### Detection

Check whether `AUTO_UPDATE_STATISTICS` is relied on alone for tables with high write
volume/volatile data distribution, versus a scheduled `UPDATE STATISTICS`/
`sp_updatestats` run proactively. SQL Server's auto-update triggers only after ~20% of
rows change (by default), which on a large, fast-growing table can mean stats go stale
for a long stretch — leading the query optimizer to pick a plan based on outdated
row-count estimates.

### BAD — relying solely on the auto-update threshold for a high-volume table

```sql
-- Orders table: 50M rows, growing 500K/day. AUTO_UPDATE_STATISTICS default threshold
-- means stats can be significantly stale for days before the ~20% change trigger fires.
```

### GOOD — proactive statistics refresh scheduled alongside the fragmentation job

```sql
-- Runs nightly for high-volatility tables identified in the maintenance plan
UPDATE STATISTICS dbo.Orders WITH FULLSCAN;
-- Or, for a full-database sweep on a maintenance window:
EXEC sp_updatestats;
```

---

## Check C — No monitoring for unused indexes (IDX-003)

### Detection

Check for a periodic query against `sys.dm_db_index_usage_stats` identifying indexes with
high write cost (`user_updates`) but near-zero read benefit (`user_seeks` +
`user_scans` + `user_lookups`) — an unused index still pays its full write-amplification
cost on every insert/update/delete with zero query benefit, and accumulates silently as
features get built and torn down over a codebase's lifetime.

### BAD — indexes accumulate over years, nobody ever audits which are still used

```sql
-- No periodic review of sys.dm_db_index_usage_stats — every index ever created for a
-- feature that's since been removed is still slowing down every write to that table.
```

### GOOD — a periodic audit query flags write-only indexes for review

```sql
SELECT OBJECT_NAME(s.object_id) AS TableName, i.name AS IndexName,
       s.user_seeks + s.user_scans + s.user_lookups AS ReadsUsed, s.user_updates AS WritesCost
FROM sys.dm_db_index_usage_stats s
JOIN sys.indexes i ON s.object_id = i.object_id AND s.index_id = i.index_id
WHERE s.database_id = DB_ID()
  AND (s.user_seeks + s.user_scans + s.user_lookups) = 0
  AND s.user_updates > 1000
ORDER BY s.user_updates DESC;
-- Candidates for removal — confirm no seasonal/quarterly report depends on them first.
```

---

## Check D — No maintenance-window awareness (IDX-004)

### Detection

Check whether index rebuilds run `WITH (ONLINE = ON)` (Enterprise/Azure SQL) or are
explicitly scheduled during a low-traffic maintenance window for editions without online
rebuild support. An offline `ALTER INDEX ... REBUILD` takes a blocking schema
modification lock for the duration of the rebuild — running one against a large table
during business hours causes a very real, very avoidable outage.

### BAD — offline rebuild run with no regard for traffic patterns

```sql
ALTER INDEX IX_Orders_CustomerId ON dbo.Orders REBUILD;
-- Run at 2pm on a weekday against a 200M-row table — blocks every concurrent read/write
-- for the rebuild's duration, taking down checkout for the affected time window.
```

### GOOD — online rebuild, or scheduled during a documented low-traffic window

```sql
ALTER INDEX IX_Orders_CustomerId ON dbo.Orders REBUILD WITH (ONLINE = ON, MAX_DURATION = 60 MINUTES);
```

```markdown
<!-- For editions without ONLINE rebuild support -->
Maintenance window: Sundays 02:00–04:00 UTC, documented in docs/DR-PLAN.md alongside
the RPO/RTO targets azure-dr-multiregion already tracks.
```
