---
id: sql-no-destructive-migration
title: No Unreviewed Destructive Migration (DROP COLUMN/TABLE)
appliesTo: sql
severity: block
standard: InternalPolicy
---
An EF Core migration's `Up()` method must not contain `DropColumn`, `DropTable`, or a type-narrowing `AlterColumn` without an accompanying rollback-safe comment explaining the data-loss impact and confirming a backup/rollback plan exists. This is a fast deterministic backstop — `sql-migration-safety` covers the full judgment-based review (data backfill order, `NOT NULL` on existing data, snapshot drift); this rule exists so a destructive op can never land silently without at least a reviewed justification comment.

**BAD**
```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    migrationBuilder.DropColumn(name: "LegacyStatus", table: "Orders");
}
```

**GOOD**
```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    // Data-loss reviewed: LegacyStatus fully superseded by StatusId (migration 2026...),
    // backfill verified in staging, rollback = restore from pre-deploy backup.
    migrationBuilder.DropColumn(name: "LegacyStatus", table: "Orders");
}
```
