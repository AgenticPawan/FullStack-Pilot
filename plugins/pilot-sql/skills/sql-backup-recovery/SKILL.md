---
name: sql-backup-recovery
description: Reviews backup integrity and restore-drill discipline — distinct from azure-dr-multiregion's cross-region infra replication and sql-index-maintenance's ongoing index health. Flags no scheduled restore-drill verifying a backup is actually restorable, no backup-integrity check (CHECKSUM/RESTORE VERIFYONLY), no documented point-in-time-restore test cadence, and backup retention that doesn't match the RPO documented elsewhere. Outputs findings with pilot-sql backup-recovery standard IDs.
when_to_use: backup verification, restore drill, RESTORE VERIFYONLY, point-in-time restore, backup integrity, backup retention, disaster recovery test, RPO validation, database recovery testing
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| BR-001 | P0 | No scheduled restore drill verifying a backup is actually restorable |
| BR-002 | P1 | No backup-integrity check (`CHECKSUM`/`RESTORE VERIFYONLY`) |
| BR-003 | P1 | No documented point-in-time-restore test cadence |
| BR-004 | P2 | Backup retention doesn't match the RPO documented in the DR plan |

`azure-dr-multiregion` governs cross-region *replication* (a live secondary); this skill
governs whether a *backup* — the last line of defense when replication itself fails or
propagates corruption — is actually usable when needed, which nothing else in this
marketplace verifies.

---

## Check A — No scheduled restore drill (BR-001)

### Detection

Check for a scheduled process that actually restores a backup to a scratch/isolated
environment and validates the result (row counts, a smoke-test query) — versus assuming a
backup is good because the backup *job* reported success. A backup job reporting success
means the write completed; it says nothing about whether the resulting file is actually
restorable, or whether the schema/data inside it is what anyone expects.

### BAD — backup job runs nightly, nobody has ever restored one to verify it works

```
<!-- SQL Agent job "Nightly Backup" has a green checkmark every night for two years.
     Nobody has run a RESTORE DATABASE from any of those backups even once. -->
```

### GOOD — a scheduled restore drill to an isolated scratch database

```sql
-- Runs monthly via SQL Agent (or a Hangfire job, per dotnet-background-jobs)
RESTORE DATABASE OrdersRestoreDrill
FROM DISK = 'https://backupstorage.blob.core.windows.net/backups/orders-latest.bak'
WITH REPLACE, MOVE 'Orders' TO '/var/opt/mssql/data/OrdersRestoreDrill.mdf';

-- Followed by an automated smoke test:
SELECT COUNT(*) FROM OrdersRestoreDrill.dbo.Orders; -- compare against expected row-count range
-- Result logged and alerted on failure via the same pipeline azure-observability wires up.
```

---

## Check B — No backup-integrity check (BR-002)

### Detection

Check whether the backup job includes `WITH CHECKSUM` (detecting page corruption at
backup time) and whether `RESTORE VERIFYONLY` runs against the resulting file — this
catches a corrupted backup file immediately rather than discovering the corruption only
during an actual restore-drill or, worse, a real incident.

### BAD — backup taken with no integrity verification

```sql
BACKUP DATABASE Orders TO DISK = 'orders.bak';
-- No CHECKSUM — silent page corruption in the source database gets backed up unnoticed.
```

### GOOD — checksum on backup, verified immediately after

```sql
BACKUP DATABASE Orders TO DISK = 'orders.bak' WITH CHECKSUM;
RESTORE VERIFYONLY FROM DISK = 'orders.bak' WITH CHECKSUM;
-- Fails fast if the backup file itself is corrupt, instead of finding out during a real restore.
```

---

## Check C — No point-in-time-restore test cadence (BR-003)

### Detection

For a database using the full recovery model with transaction-log backups (supporting
point-in-time restore), check whether the point-in-time restore capability itself is
periodically tested — not just full-backup restores (Check A) but "restore to 2:37pm
yesterday" specifically, since log-chain integrity (no gaps between log backups) is a
distinct failure mode from the full backup being valid.

### BAD — full backups tested, but nobody has verified point-in-time restore works

```
<!-- Full backup restore drill (Check A) passes every month. Nobody has ever tested
     restoring to an arbitrary point in time — a gap in the log-backup chain from
     6 months ago would go completely undetected until an actual incident needs it. -->
```

### GOOD — point-in-time restore explicitly exercised in the drill

```sql
RESTORE DATABASE OrdersRestoreDrill FROM DISK = 'orders-full.bak' WITH NORECOVERY;
RESTORE LOG OrdersRestoreDrill FROM DISK = 'orders-log-1.trn' WITH NORECOVERY;
RESTORE LOG OrdersRestoreDrill FROM DISK = 'orders-log-2.trn'
  WITH RECOVERY, STOPAT = '2026-07-04T14:37:00';
-- Verifies the entire log chain is intact, not just that the full backup is valid.
```

---

## Check D — Backup retention doesn't match the documented RPO (BR-004)

### Detection

Cross-check the backup retention window against the RPO documented in
`azure-dr-multiregion`'s DR plan (ADR-003). A 5-minute RPO target is meaningless if backup
retention only keeps the last 24 hours — restoring to "5 minutes before the incident"
requires log backups frequent and retained long enough to actually hit that target.

### BAD — RPO target and actual backup retention don't match

```markdown
<!-- docs/DR-PLAN.md says "Orders service: RPO 5 minutes" (from azure-dr-multiregion ADR-003)
     but transaction-log backups only run hourly and are retained for 24 hours. -->
```

### GOOD — retention and log-backup frequency actually support the stated RPO

```sql
-- Log backups every 5 minutes, retained 35 days — matches the 5-minute RPO target
-- and gives a full month of point-in-time restore options.
BACKUP LOG Orders TO DISK = 'orders-log.trn' WITH CHECKSUM;
```
