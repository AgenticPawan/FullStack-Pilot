# pilot-sql

SQL Server / EF Core governance: injection defense, migration safety, multitenancy
isolation, and performance review.

## Agents

- **sql-reviewer** — reviews EF Core and raw SQL changes against all skills below,
  emitting findings with standard IDs (CWE, OWASP, `MIG-*`, `MT-*`, `SDP-*`, `IDX-*`, `BR-*`).
  Read-only. Invoke manually with `@sql-reviewer`.
- **sql-implementor** — the fixing counterpart: takes a reviewer finding or a
  schema/query change request, pairs every migration edit with its `ModelSnapshot.cs`,
  and verifies with `dotnet build`. Stops for your sign-off before any destructive
  migration (column/table drop, type narrowing, `NOT NULL` on existing data) and never
  runs `dotnet ef database update`. Never commits. Invoke with
  `@sql-implementor fix <finding>`.
- **sql-support** — product-support diagnosis for database symptoms (slow queries,
  timeouts, deadlocks, failed migrations, missing rows). Runs read-only diagnostics
  only, checks the classic causes first (non-SARGable predicates, N+1, a global query
  filter silently hiding rows, snapshot drift), and reports the root cause with cited
  evidence, then hands off to `@sql-implementor`. Invoke with
  `@sql-support <describe the symptom>`.

Usage example:

```
> @sql-reviewer review Migrations/20260711_AddOrderStatus.cs
> @sql-implementor fix the MT-001 finding in AppDbContext.cs:30
> @sql-support the orders list query started timing out this week
```

## Skills

| Skill | Covers |
|---|---|
| `sql-injection-defense` | Flags `FromSqlRaw` with non-static arguments, distinguishes safe `FromSqlInterpolated`, reviews `EXEC`/`sp_executesql` and Dapper parameter hygiene. Maps to CWE-89 / OWASP A03:2021. |
| `sql-migration-safety` | Detects destructive migrations (`DROP COLUMN`/`DROP TABLE`, type narrowing, `NOT NULL` on existing data), table-locking DDL, missing rollback/`Down()`, drift against the current model snapshot. |
| `sql-multitenancy` | Verifies `HasQueryFilter` on every `TenantId`/`OrgId` entity, flags unjustified `IgnoreQueryFilters`, generates a cross-tenant test scaffold, documents SQL Server row-level security as defense-in-depth. |
| `sql-performance-review` | Non-SARGable predicates, implicit conversions, N+1 patterns, missing `AsNoTracking`, covering-index recommendations. Reads execution plans via the SQL MCP server when available. |
| `sql-data-protection` | Always Encrypted for highly sensitive columns, Dynamic Data Masking for lower-privilege roles, Transparent Data Encryption verification, backup/restore protection parity — the database-side counterpart to `dotnet-data-protection`. |
| `sql-index-maintenance` | Scheduled fragmentation rebuild/reorganize, statistics-update cadence, unused-index monitoring, online-vs-offline maintenance windows — the ongoing operational counterpart to `sql-performance-review`'s per-query analysis. |
| `sql-backup-recovery` | Scheduled restore-drill testing, backup-integrity checks (`CHECKSUM`/`RESTORE VERIFYONLY`), point-in-time-restore test cadence, retention-vs-RPO alignment — distinct from `azure-dr-multiregion`'s cross-region replication and `sql-index-maintenance`'s ongoing index health. |

Query-optimization *implementation* (as opposed to review) is deferred to the
`dotnet-data` skill from `dotnet/skills` — see the [root README](../README.md#relationship-to-dotnetskills).
