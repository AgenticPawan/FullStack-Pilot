---
name: zero-downtime-deployment
description: Reviews the migration-to-deploy seam — is a schema change safe while N-1 and N app versions run at once during a rolling deploy? Flags destructive changes shipped with their own code instead of expand/contract, migrations not backward-compatible with N-1, table-locking migrations causing downtime, and migration/rollout not sequenced in CI. Outputs zero-downtime-deployment standard IDs.
when_to_use: zero downtime deployment, expand contract migration, parallel change, rolling deploy, blue green deploy, backward compatible migration, N-1 compatibility, drop column safety, rename column migration, add NOT NULL column default, online index build, locking migration, table lock backfill, migration ordering CI, deploy gate migration, schema change during deploy, breaking schema change, two-phase migration
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ZDD-001 | P0 | Destructive change (drop/rename column, drop table) shipped in the same release as the code change |
| ZDD-002 | P1 | No expand/contract (parallel-change) discipline — migrations assume all instances update atomically |
| ZDD-003 | P0 | Migration not backward-compatible with the still-running N-1 app version |
| ZDD-004 | P1 | Long-running / table-locking migration causes de-facto downtime during the deploy |
| ZDD-005 | P1 | Migration and app rollout not sequenced/gated in CI/CD (race or wrong order) |

`sql-migration-safety` owns whether a single migration is *mechanically* safe (guards a drop,
checks a rename); `azure-cicd-security` owns the *pipeline*. Neither checks the thing that
actually causes outages: during a rolling/blue-green deploy, **two app versions run against one
database at the same time**, so the schema must be compatible with *both*. That coordination is
this skill's job. The governing rule: **expand/contract (parallel change)** — never ship a
destructive schema change and the code that depends on it in the same release.

---

## Check A — Destructive change shipped with its code (ZDD-001)

### Detection

Flag a migration that drops or renames a column/table in the **same release** as the code that
stops using it. During the rollout the old instances still reference the old shape; the moment
the migration runs, they throw. Drops must trail the code by one full release.

### BAD — column dropped in the release that removes its usage

```csharp
// v2 migration, shipped together with the v2 code that no longer reads LegacyStatus:
migrationBuilder.DropColumn("LegacyStatus", "Orders");
// Rolling deploy: v1 instances still SELECT LegacyStatus → SqlException until they drain.
```

### GOOD — expand/contract across two releases

```
Release N   (expand):  add new column, write BOTH old+new, backfill; drop nothing.
Release N+1 (contract): once no running instance reads the old column, drop it.
```

---

## Check B — No expand/contract discipline (ZDD-002)

### Detection

Check for a documented parallel-change policy. A rename is the classic trap: `rename A → B` is
two incompatible schemas. The zero-downtime form is add `B`, dual-write `A`+`B`, backfill,
migrate readers, then drop `A` in a later release — four steps, not one.

### BAD — rename in a single migration

```csharp
migrationBuilder.RenameColumn("EmailAddr", "Users", "Email");
// N-1 instances read EmailAddr (gone); N reads Email. One of them is always broken mid-deploy.
```

### GOOD — additive step now, cleanup later (documented)

```
<!-- docs/MIGRATION-POLICY.md -->
Renames/drops follow expand/contract: add the new column, dual-write in app code, backfill,
switch readers, and only drop the old column in a release after all instances read the new one.
```

---

## Check C — Not backward-compatible with N-1 (ZDD-003)

### Detection

Check that a migration leaves the schema usable by the **currently running** app version. Adding
a `NOT NULL` column with no default breaks N-1 inserts (they don't supply it); adding a new
required FK the old code never populates does the same. Add columns nullable or with a default
first; tighten the constraint in a later release once all writers supply the value.

### BAD — NOT NULL with no default, added before the app writes it

```csharp
migrationBuilder.AddColumn<Guid>("TenantId", "Orders", nullable: false);
// N-1 INSERTs omit TenantId → every write from the old version fails during rollout.
```

### GOOD — nullable now, enforce later

```csharp
// Release N: nullable, app starts populating it.
migrationBuilder.AddColumn<Guid>("TenantId", "Orders", nullable: true);
// Release N+1 (after backfill + all writers populate it): ALTER COLUMN ... NOT NULL.
```

---

## Check D — Locking / long-running migration = downtime (ZDD-004)

### Detection

Flag migrations that hold a blocking lock or rewrite the whole table during the deploy window:
adding a non-nullable column with a computed default (table rewrite), building an index without
`ONLINE = ON` (SQL Server Enterprise) / `CONCURRENTLY`, or backfilling millions of rows inside
the migration transaction. These block reads/writes — a "zero-downtime" deploy that freezes the
table for 90s is not zero-downtime. Move big backfills to a batched, out-of-band job.

### BAD — synchronous backfill inside the migration

```csharp
migrationBuilder.Sql("UPDATE Orders SET TenantId = '...' WHERE TenantId IS NULL;");
// Single transaction over the whole table → long lock, blocked app, timeouts.
```

### GOOD — online index + batched out-of-band backfill

```sql
CREATE INDEX IX_Orders_TenantId ON Orders(TenantId) WITH (ONLINE = ON);
-- Backfill runs in a separate batched job (small ranges, own transactions), not the migration.
```

---

## Check E — Migration/rollout not sequenced in CI/CD (ZDD-005)

### Detection

Check that the pipeline (`azure-cicd-security`) runs the migration as a **distinct, gated step**
in the right order relative to the app rollout, not as an app-startup side effect where multiple
scaling instances race to apply it. Expand migrations run **before** the new code; contract
migrations run **after** the old code is fully drained. `EnsureCreated`/auto-migrate-on-startup
across N replicas is the anti-pattern.

### BAD — every instance migrates on boot

```csharp
app.Services.GetRequiredService<AppDbContext>().Database.Migrate();  // in Program.cs
// A rollout of 5 replicas races to apply the same migration; ordering vs. rollout is undefined.
```

### GOOD — a dedicated pipeline stage gates the rollout

```yaml
# deploy.yml
- stage: migrate            # expand migration BEFORE the app rollout; contract AFTER drain
  run: dotnet ef database update --project Data
- stage: deploy_app
  dependsOn: migrate        # app rollout only proceeds once the migration stage succeeds
```

---

## Read budget

≤ 10 files: the pending migration(s) and their `Down`, the entity/DTO the change touches (to
judge N-1 compatibility), the deploy workflow, and any startup `Database.Migrate()` call.
Reference `sql-migration-safety` for per-migration mechanics and `azure-cicd-security` for the
pipeline rather than re-deriving them — this skill only checks the two-versions-at-once seam.
Budgets bound exploration, not quality: if judging backward-compatibility needs the app's write
path, read it and say why rather than guessing.
