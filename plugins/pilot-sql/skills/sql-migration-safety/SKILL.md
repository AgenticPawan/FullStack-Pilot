---
name: sql-migration-safety
description: Reviews EF Core migration files before deployment: detects destructive operations (DROP COLUMN, DROP TABLE, column type narrowing, NOT NULL constraint on existing data), flags table-locking DDL on tables that should use online-safe patterns (add-nullable-then-backfill), verifies rollback scripts or reversible Down() implementations, and cross-checks migration intent against the current model snapshot. Outputs findings with sql-migration-safety standard IDs.
when_to_use: EF Core migration, migration safety, DROP COLUMN, DROP TABLE, destructive migration, irreversible migration, rollback script, online migration, zero-downtime, migration review, data loss, schema change
---

## Migration safety standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| MIG-001 | P1 | DROP COLUMN — irreversible without data loss |
| MIG-002 | P1 | DROP TABLE — irreversible without data loss |
| MIG-003 | P1 | Column type narrowing (e.g. nvarchar(max) → nvarchar(50)) |
| MIG-004 | P1 | NOT NULL constraint added to existing column without a default |
| MIG-005 | P2 | Table lock risk — operation that acquires SCH-M lock on large table |
| MIG-006 | P2 | Missing or empty Down() method on a destructive migration |
| MIG-007 | P2 | Unique constraint added without verifying duplicates first |
| MIG-008 | P3 | Migration modifies a column used in an active index without rebuilding it |

---

## Step 1 — Locate migration files

Glob `**/Migrations/*.cs` (exclude `Designer.cs`, `Snapshot.cs`). Read each file's `Up()` and `Down()` methods.

---

## Step 2 — Destructive operation detection

### MIG-001: DropColumn

```csharp
// FINDING: MIG-001 P1 — data is lost if column contains values
migrationBuilder.DropColumn(name: "LegacyNotes", table: "Orders");
```

**Safe pattern:** deploy a code change that stops writing to the column first, verify no
reads remain, then drop in a follow-up migration. Flag any `DropColumn` where the
preceding migration that stopped using the column is not referenced.

### MIG-002: DropTable

```csharp
migrationBuilder.DropTable(name: "AuditLogs");  // MIG-002: all rows lost
```

### MIG-003: Column type narrowing

```csharp
migrationBuilder.AlterColumn<string>(
    name: "Notes",
    table: "Orders",
    maxLength: 100,      // was unlimited — existing rows > 100 chars will be truncated
    nullable: false,
    oldClrType: typeof(string));
```

Check: `AlterColumn` where the new `maxLength` is smaller than the old, or where the
CLR type changes from a wider type (`decimal(18,4)`) to narrower (`int`).

### MIG-004: NOT NULL without default

```csharp
migrationBuilder.AddColumn<int>(
    name: "TenantId",
    table: "Users",
    nullable: false);    // will fail if table has rows — no defaultValue
```

Safe pattern:
1. Add as nullable: `nullable: true`
2. Backfill with `Sql("UPDATE Users SET TenantId = 1 WHERE TenantId IS NULL")`
3. Alter to NOT NULL in a subsequent migration

---

## Step 3 — Online-safe pattern check

SQL Server requires an exclusive lock for the following DDL:

| Operation | Lock type | Risk |
|-----------|-----------|------|
| ADD COLUMN NOT NULL without default | SCH-M | Blocks all reads/writes |
| ALTER COLUMN (type change) | SCH-M | Blocks all reads/writes |
| ADD UNIQUE CONSTRAINT | S + SCH-M | Blocks writes |
| DROP COLUMN | SCH-M | Blocks all reads/writes |

Flag any of the above on tables whose row estimate (from the migration snapshot or model) suggests > 100k rows (or any table in a high-traffic context noted in the project CLAUDE.md).

Recommended online-safe pattern for adding a non-nullable column:

```csharp
// Migration 001: add nullable
migrationBuilder.AddColumn<int>("TenantId", "Orders", nullable: true);

// Application code: write TenantId on every new/updated row

// Migration 002 (separate deployment): backfill + constrain
migrationBuilder.Sql("UPDATE Orders SET TenantId = 1 WHERE TenantId IS NULL");
migrationBuilder.AlterColumn<int>("TenantId", "Orders", nullable: false);
```

---

## Step 4 — Rollback verification (MIG-006)

Check that the `Down()` method is non-empty and reverses each operation in `Up()`.

Empty `Down()` is only acceptable for non-destructive additive migrations (add a new table,
add a nullable column). Flag as MIG-006 when:
- `Down()` is empty AND `Up()` contains any DROP or ALTER
- `Down()` does not contain a `CreateTable` matching a `DropTable` in `Up()`

---

## Finding output format

```json
{
  "source": "semantic",
  "severity": "P1",
  "cwe": null,
  "owasp": null,
  "file": "src/Api/Migrations/20240101_AddOrders.cs",
  "line": 12,
  "title": "MIG-001: DropColumn — irreversible data loss on Orders.LegacyNotes",
  "evidence": "migrationBuilder.DropColumn(name: \"LegacyNotes\", table: \"Orders\");",
  "proposedFix": "Verify column is unused; deploy code removal first; run DropColumn in a separate deployment",
  "batchable": false,
  "confidence": "high"
}
```

`batchable: false` — migration changes require human review; /pilot-fix should not auto-apply.
