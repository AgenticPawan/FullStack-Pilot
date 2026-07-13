---
name: sql-hadr-failover
description: Reviews database-tier high availability and failover — distinct from sql-backup-recovery's restore drills and azure-dr-multiregion's app/infra replication. Flags a single-instance database behind an SLA that needs HA, a connection string not targeting the AG listener / failover-group endpoint, read-only workloads not routed to a readable secondary, no documented data-tier RPO/RTO, and failover never actually tested. Outputs pilot-sql sql-hadr-failover standard IDs.
when_to_use: high availability, HADR, Always On, availability group, AG listener, failover group, Azure SQL failover, read replica, ApplicationIntent ReadOnly, read scale-out, automatic failover, RPO RTO database, geo-replication SQL, synchronous commit, failover test, connection string listener
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| HA-001 | P1 | Single-instance database behind an availability SLA that requires HA/failover |
| HA-002 | P0 | Connection string targets a specific server, not the AG listener / failover-group endpoint |
| HA-003 | P1 | Read-only workloads hit the primary instead of a readable secondary |
| HA-004 | P1 | No documented data-tier RPO/RTO, or sync/async commit mode chosen without reference to it |
| HA-005 | P1 | Failover path never tested — no drill proving the app survives a primary loss |

`sql-backup-recovery` governs whether a *backup* is restorable when all else fails;
`azure-dr-multiregion` governs the *app/infrastructure* tier across regions. Neither governs
whether the database keeps serving through a node/zone loss without a restore. That's this
skill: Always On Availability Groups (SQL Server) or failover groups / active geo-replication
(Azure SQL), the listener/endpoint the app connects through, and read-secondary routing —
the difference between a blip and an outage.

---

## Check A — HA topology matches the SLA (HA-001)

### Detection

Compare the stated availability target against the deployment. A single SQL instance (one VM,
or a Basic/Standard Azure SQL database with no failover group) has a single point of failure;
patching, a zone outage, or a crash is downtime. If an SLA promises "99.9%+" or the workload
is business-critical, there must be a real HA construct — an AG with ≥1 synchronous secondary,
or an Azure SQL failover group / zone-redundant tier.

### BAD — one instance, business-critical SLA

```
<!-- Prod OLTP database runs on a single SQL Server VM. No AG, no secondary.
     SLA doc promises 99.95%. A single OS patch reboot violates it. HA-001. -->
```

### GOOD — Always On AG with a synchronous secondary (auto-failover), or Azure SQL failover group

```sql
-- SQL Server: AG with automatic failover between two synchronous replicas.
ALTER AVAILABILITY GROUP [AppAg]
  MODIFY REPLICA ON 'SQLNODE2'
  WITH (AVAILABILITY_MODE = SYNCHRONOUS_COMMIT, FAILOVER_MODE = AUTOMATIC);
-- Azure SQL equivalent: a failover group across two servers, or a Business Critical /
-- zone-redundant tier — provisioned in Bicep (see azure-dr-multiregion for cross-region).
```

---

## Check B — App connects through the listener / failover endpoint (HA-002)

### Detection

Inspect the connection string. If it names a specific node (`Server=SQLNODE1`) or the primary
server directly, a failover leaves the app pointed at a now-secondary (read-only) or dead
node — the HA construct exists but the app can't follow it. It must target the AG **listener**
name or the Azure SQL **failover-group** endpoint (`<fog-name>.database.windows.net`), which
always resolves to the current primary.

### BAD — pinned to a physical node

```
Server=SQLNODE1;Database=App;...   // HA-002: failover moves the primary; the app doesn't follow
```

### GOOD — the listener / failover-group endpoint, with resilience settings

```
Server=appag-listener;Database=App;MultiSubnetFailover=True;...
// Azure SQL: Server=app-fog.database.windows.net;Database=App;...
// Pair with EF Core EnableRetryOnFailure (dotnet-resilience) so in-flight commands retry
// across the brief failover window instead of surfacing as errors.
```

---

## Check C — Read workloads routed to a readable secondary (HA-003)

### Detection

Check whether read-only queries (reports, dashboards, `dotnet-reporting-etl` extracts) are
offloaded to a readable secondary via `ApplicationIntent=ReadOnly` (AG read-only routing) or
Azure SQL read scale-out. Sending every read to the primary wastes the secondary you're
already paying for and lets heavy reporting queries contend with OLTP writes.

### BAD — reporting connection hits the primary

```
Server=appag-listener;Database=App;...   // HA-003: no ApplicationIntent — reports load the primary
```

### GOOD — read-only intent routes to the secondary

```
Server=appag-listener;Database=App;ApplicationIntent=ReadOnly;MultiSubnetFailover=True;...
// Requires read-only routing configured on the AG (or Azure SQL read scale-out enabled).
// Route report/read DbContexts here; keep the write DbContext on the primary endpoint.
```

---

## Check D — Documented RPO/RTO drives the commit mode (HA-004)

### Detection

Confirm a written data-tier RPO/RTO exists and that synchronous vs asynchronous commit was
chosen against it. Synchronous commit = zero data loss (RPO 0) but latency-coupled and
distance-limited; asynchronous = some data loss window, needed for geographic distance.
Choosing async for a local HA pair (giving up RPO 0 for nothing) or sync across regions
(coupling write latency to WAN) both signal the mode was picked without the target in mind.
The number must reconcile with `sql-backup-recovery`'s RPO and `azure-dr-multiregion`'s.

### GOOD — mode justified by the target

```
<!-- docs/DR-PLAN.md (data tier) -->
RPO 0 / RTO < 60s within the region: synchronous-commit AG, automatic failover.
RPO <= 5 min cross-region: asynchronous-commit secondary / async geo-replication, manual failover.
```

---

## Check E — Failover is actually tested (HA-005)

### Detection

Check for a scheduled drill that forces a failover and verifies the app keeps working — a
configured AG that has never failed over is an untested assumption. The drill proves the
listener redirects, the app's retry logic (Check B) rides through, and read routing still
works — the same discipline `sql-backup-recovery` applies to restores, applied to failover.

### BAD — AG configured at go-live, never failed over since

```
<!-- Automatic failover is "enabled." No one has triggered a failover in prod or staging
     to confirm the app reconnects. First real test will be the first real outage. HA-005. -->
```

### GOOD — a rehearsed, scheduled failover drill

```sql
-- Staging drill (documented cadence, e.g. quarterly): force failover, then smoke-test the app.
ALTER AVAILABILITY GROUP [AppAg] FAILOVER;   -- Azure SQL: az sql failover-group set-primary
-- Verify: app reconnects via the listener, writes resume on the new primary,
-- read-only routing still lands on a secondary. Record RTO actually observed vs target.
```
