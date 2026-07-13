---
name: sql-temporal-cdc
description: Reviews SQL Server change-capture — the data-side foundation dotnet-outbox-pattern, dotnet-audit-trail, and zero-downtime-deployment assume. Flags audit history via hand-rolled triggers/shadow tables instead of system-versioned temporal tables, CDC/Change Tracking with no cleanup/retention, downstream sync polling timestamp columns instead of Change Tracking/CDC, temporal history not covered by tenant filters or retention, and CDC capture instances not refreshed after a schema change. Outputs pilot-sql standard IDs (CDC-*).
when_to_use: temporal tables, system-versioned table, SYSTEM_VERSIONING, Change Data Capture, CDC, Change Tracking, audit history table, outbox change capture, cleanup retention CDC, capture instance schema change, history table tenant filter, point in time query FOR SYSTEM_TIME
---

## Purpose

Several skills assume a reliable way to know *what changed and when*: `dotnet-audit-trail` (who
changed what), `dotnet-outbox-pattern` (publish committed changes downstream), and
`zero-downtime-deployment` (backfill safely). SQL Server offers three native mechanisms —
**system-versioned temporal tables** (full row history), **Change Tracking** (which rows changed,
lightweight), and **Change Data Capture / CDC** (what changed, with column-level detail). This
skill reviews whether change capture uses the right native mechanism instead of a fragile
hand-built one.

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| CDC-001 | P1 | Audit/history requirement met with app-side triggers or a manual shadow table instead of system-versioned temporal tables |
| CDC-002 | P2 | CDC / Change Tracking enabled but no cleanup/retention policy — capture tables grow unbounded |
| CDC-003 | P2 | Downstream sync/outbox polls by timestamp column instead of Change Tracking/CDC — misses concurrent writes or double-processes rows |
| CDC-004 | P2 | Temporal history table not covered by the tenant query filter or a retention policy — cross-version/cross-tenant leakage |
| CDC-005 | P3 | CDC capture instance not re-created after a column add — new columns silently not captured |

---

## Check A — Hand-rolled history instead of temporal tables (CDC-001)

### Detection

Look for `AFTER UPDATE/DELETE` triggers whose only job is copying the old row into a `*_History`/
`*_Audit` table, or application code writing history rows in a second `SaveChanges`. SQL Server
maintains this automatically and atomically with `SYSTEM_VERSIONING` — the trigger approach misses
rows changed by paths that bypass it (bulk ops, other apps) and isn't transaction-atomic.

### GOOD — system-versioned temporal table

```sql
CREATE TABLE dbo.Orders (
    Id INT PRIMARY KEY,
    Status NVARCHAR(20) NOT NULL,
    ValidFrom DATETIME2 GENERATED ALWAYS AS ROW START NOT NULL,
    ValidTo   DATETIME2 GENERATED ALWAYS AS ROW END   NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.OrdersHistory));
-- point-in-time query, no bespoke audit code:
-- SELECT * FROM dbo.Orders FOR SYSTEM_TIME AS OF '2026-01-01' WHERE Id = 1;
```

EF Core: `entity.ToTable("Orders", t => t.IsTemporal())`. Flag manual history tables where
temporal versioning would serve the same requirement.

---

## Check B — No cleanup / retention (CDC-002)

Temporal history, CDC change tables, and Change Tracking side tables all grow with every change.
Flag the absence of a retention policy:

```sql
-- temporal: bound history growth
ALTER TABLE dbo.Orders SET (SYSTEM_VERSIONING = ON
    (HISTORY_TABLE = dbo.OrdersHistory, HISTORY_RETENTION_PERIOD = 12 MONTHS));
-- CDC: the capture-job retention (default 3 days) must match the consumer's tolerance
EXEC sys.sp_cdc_change_job @job_type = 'cleanup', @retention = 4320; -- minutes
-- Change Tracking: CHANGE_RETENTION must exceed the longest sync gap or consumers get full-resync
ALTER DATABASE AppDb SET CHANGE_TRACKING (CHANGE_RETENTION = 7 DAYS, AUTO_CLEANUP = ON);
```

CDC-002 also covers a Change Tracking retention shorter than the slowest consumer's poll interval
— the consumer silently falls off the tracked window and must full-resync.

---

## Check C — Timestamp polling instead of native change capture (CDC-003)

### Detection

Outbox/ETL/sync code with `WHERE ModifiedAt > @lastRun` is unreliable: rows committed in a
transaction that started before `@lastRun` but committed after it are missed, and equal
timestamps cause duplicates. Prefer Change Tracking (`CHANGETABLE(CHANGES ...)` with a version
watermark) or CDC (`cdc.fn_cdc_get_all_changes_*` with an LSN watermark).

```sql
-- BAD — timestamp watermark misses concurrent/late-committing rows
SELECT * FROM dbo.Orders WHERE ModifiedAt > @lastRun;
-- GOOD — Change Tracking version watermark: exact, gap-free, no missed concurrent writes
SELECT o.* FROM CHANGETABLE(CHANGES dbo.Orders, @lastSyncVersion) ct
JOIN dbo.Orders o ON o.Id = ct.[Id];
```

Cross-reference `dotnet-outbox-pattern`: the transactional outbox is still preferred for
publishing *domain events*; CDC/Change Tracking is for syncing *row state* to a read model or
downstream store. Flag the wrong tool, not the mere presence of one.

---

## Check D — History not tenant-filtered / retained (CDC-004)

In a multitenant database (`sql-multitenancy`), the temporal **history** table is a separate
table and is **not** covered by the current table's `HasQueryFilter`. Direct `FOR SYSTEM_TIME`
queries can read other tenants' historical rows. Flag temporal tables on tenant-scoped entities
with no equivalent filtering/retention applied to history access.

---

## Check E — Capture instance stale after schema change (CDC-005)

CDC capture instances are bound to the table's column set at creation. Adding a column does **not**
flow into the existing capture instance — the new column is silently not captured until a second
capture instance is created and consumers cut over. Flag a migration that `AddColumn`s to a
CDC-tracked table with no accompanying `sys.sp_cdc_enable_table` for a new capture instance.

---

## Read budget

≤ 10 files: the entity/table definitions under review, their migrations (temporal/CDC enablement),
and any sync/outbox/ETL reader that consumes changes. Reference `dotnet-outbox-pattern` (event
publishing), `dotnet-audit-trail` (who/what), `sql-multitenancy` (query filters), and
`zero-downtime-deployment` (backfill) rather than re-deriving them. Budgets bound exploration,
not quality — if the sync watermark logic lives in a separate service, read it and say why.
