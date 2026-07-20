---
name: sql-data-retention-purge
description: "Designs and audits SQL Server data retention and purge policies: temporal table SYSTEM_VERSIONING with retention period, soft-delete with retention date columns, scheduled or partition-switch-based purge jobs, compliance archiving (GDPR right-to-erasure, right-to-be-forgotten), and PII column scrubbing before archive. Ensures purge jobs respect multitenancy isolation."
when_to_use: data retention, purge, gdpr erasure, soft delete purge, temporal table cleanup, partition switch delete, pii scrubbing, right to erasure, archive, data lifecycle, retention policy, cleanup job, scheduled delete
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| RET-001 | P0 | PII columns hard-deleted without scrubbing — GDPR right-to-erasure violated |
| RET-002 | P1 | Table flagged for retention has no `RetainUntil` / `DeletedAt` column or temporal history |
| RET-003 | P1 | Purge job or stored procedure deletes rows without a `TenantId` / `OrganisationId` filter |
| RET-004 | P2 | Batch delete runs as single transaction on >10k rows — risks log growth and blocking |
| RET-005 | P2 | Temporal `SYSTEM_VERSIONING` ON but no `HISTORY_RETENTION_PERIOD` set |

---

## Check A — Retention column pattern (RET-002)

Every table that holds user-generated or personally identifiable data must have either:

**Option 1 — Soft-delete with explicit retention date**

```sql
-- Migration adds RetainUntil
ALTER TABLE dbo.CustomerNotes
    ADD RetainUntil DATE NOT NULL
        CONSTRAINT DF_CustomerNotes_RetainUntil DEFAULT DATEADD(YEAR, 7, GETUTCDATE());
```

**Option 2 — Temporal table with retention policy**

```sql
ALTER TABLE dbo.CustomerNotes
    ADD PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo);

ALTER TABLE dbo.CustomerNotes
    SET (SYSTEM_VERSIONING = ON (
        HISTORY_TABLE = dbo.CustomerNotesHistory,
        HISTORY_RETENTION_PERIOD = 7 YEARS
    ));
```

---

## Check B — Purge job with tenant isolation (RET-003 / RET-004)

### BAD — No tenant filter, single large transaction

```sql
DELETE FROM dbo.CustomerNotes
WHERE RetainUntil < GETUTCDATE();
```

### GOOD — Batched with tenant scope

```sql
DECLARE @BatchSize INT = 5000, @Deleted INT = 1;
WHILE @Deleted > 0
BEGIN
    DELETE TOP (@BatchSize) FROM dbo.CustomerNotes
    WHERE TenantId = @TenantId
      AND RetainUntil < GETUTCDATE();
    SET @Deleted = @@ROWCOUNT;
END
```

---

## Check C — GDPR right-to-erasure (RET-001)

Before deleting a user record, scrub PII columns to a tombstone value rather than relying
on CASCADE DELETE alone. Archive non-PII audit data before scrubbing.

```sql
-- Step 1: archive non-PII audit trail
INSERT INTO dbo.DeletedUserAudit (UserId, TenantId, DeletedAt)
SELECT UserId, TenantId, GETUTCDATE() FROM dbo.Users WHERE UserId = @UserId;

-- Step 2: scrub PII in place
UPDATE dbo.Users
SET Email        = 'deleted@example.invalid',
    DisplayName  = 'Deleted User',
    PhoneNumber  = NULL,
    DateOfBirth  = NULL
WHERE UserId = @UserId AND TenantId = @TenantId;

-- Step 3: mark soft-deleted
UPDATE dbo.Users SET DeletedAt = GETUTCDATE() WHERE UserId = @UserId;
```

---

## Check D — Partition-switch purge for large tables

For tables with >1 M rows per retention cycle, use partition switching instead of batched
deletes to avoid log amplification:

1. Create a staging table with identical schema and constraints.
2. Switch the expired partition out: `ALTER TABLE dbo.Events SWITCH PARTITION @P TO dbo.EventsStaging PARTITION @P`.
3. Truncate or archive the staging table.
4. Requires: partition function aligned to `RetainUntil` date range.

---

## EF Core integration

Map retention columns in the entity configuration:

```csharp
entity.Property(e => e.RetainUntil)
      .HasDefaultValueSql("DATEADD(YEAR, 7, GETUTCDATE())");

// Global query filter excludes hard-expired rows from all queries
modelBuilder.Entity<CustomerNote>()
    .HasQueryFilter(n => n.RetainUntil > DateTime.UtcNow || n.RetainUntil == null);
```
