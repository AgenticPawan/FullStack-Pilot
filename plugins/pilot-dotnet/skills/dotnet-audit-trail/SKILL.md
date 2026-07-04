---
name: dotnet-audit-trail
description: Reviews compliance-grade access-audit logging — distinct from dotnet-audit-fields' CreatedBy/ModifiedBy change tracking. Flags no append-only log of who viewed sensitive/PII data (not just who changed it), an access log stored in a table the application can UPDATE/DELETE from (defeating tamper-evidence), no query surface for compliance/SOC2/HIPAA audits, and access-log writes done synchronously in the request path instead of via a non-blocking pipeline. Outputs findings with pilot-dotnet audit-trail standard IDs.
when_to_use: access audit log, who viewed, compliance logging, SOC2 audit trail, HIPAA access log, tamper-evident log, append-only audit table, data access logging, PII view tracking, audit query, compliance reporting
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ATR-001 | P0 | No append-only log of who *viewed* sensitive/PII data |
| ATR-002 | P0 | Access-log table is mutable by the application (UPDATE/DELETE possible) |
| ATR-003 | P1 | No query surface for compliance/SOC2/HIPAA audit requests |
| ATR-004 | P2 | Access-log write done synchronously in the request path instead of a non-blocking pipeline |

This skill is distinct from `dotnet-audit-fields` (which tracks who *changed* a row via
`CreatedBy`/`ModifiedBy`) and from `dotnet-data-protection` (which protects PII at rest).
This is the third leg: who *read* the data, which SOC2/HIPAA-style audits require
independently of whether anything was modified.

---

## Check A — No access-audit log for sensitive data reads (ATR-001)

### Detection

For entities/endpoints already flagged as PII-bearing by `dotnet-data-protection`
(`[PersonalData]`-tagged columns), check whether a `GET`/read path that returns that data
writes an access-log entry (who, what record, when) — versus only the *write* path being
tracked via `dotnet-audit-fields`. A compliance auditor asking "who has viewed customer
X's SSN in the last 90 days" has no answer if only writes are logged.

### BAD — only writes are audited; reads of PII are invisible

```csharp
[HttpGet("{id:guid}")]
public async Task<ActionResult<CustomerDto>> Get(Guid id)
{
    var customer = await _db.Customers.FindAsync(id); // contains [PersonalData] fields — nobody logs that this happened
    return Ok(customer.ToDto());
}
```

### GOOD — read of PII-bearing data writes an access-log entry

```csharp
[HttpGet("{id:guid}")]
public async Task<ActionResult<CustomerDto>> Get(Guid id, IAuditTrailService auditTrail)
{
    var customer = await _db.Customers.FindAsync(id);
    await auditTrail.LogAccessAsync(new AccessLogEntry
    {
        UserId = User.GetUserId(),      // Guid — ties to dotnet-audit-fields AUD-006
        Resource = nameof(Customer),
        ResourceId = id,
        Action = "View",
        Timestamp = DateTime.UtcNow
    });
    return Ok(customer.ToDto());
}
```

---

## Check B — Access-log table is mutable by the application (ATR-002)

### Detection

Check the `AccessLog` entity/table for whether the application's DbContext has `UPDATE`/
`DELETE` permission on it, or whether it's genuinely append-only (write-only role grant,
or a database trigger rejecting updates/deletes). An access log the application itself can
edit is not tamper-evident — it fails the first question any real audit asks ("can the
system under audit alter its own audit trail?").

### BAD — same DbContext, same permissions as every other table

```csharp
public class AppDbContext : DbContext
{
    public DbSet<AccessLogEntry> AccessLog { get; set; } // same read/write/delete permissions as Orders, Customers, etc.
}
```

### GOOD — append-only enforced at the database level, not just by convention

```sql
-- The application's SQL login is granted INSERT and SELECT on AccessLog, but NOT
-- UPDATE or DELETE — enforced by database permissions, not by application code discipline.
GRANT INSERT, SELECT ON AccessLog TO [AppServiceLogin];
DENY UPDATE, DELETE ON AccessLog TO [AppServiceLogin];
```

```csharp
// EF Core is configured read/insert-only for this entity — no Update()/Remove() call exists in the codebase
modelBuilder.Entity<AccessLogEntry>().ToTable("AccessLog", t => t.ExcludeFromMigrations());
```

---

## Check C — No compliance query surface (ATR-003)

### Detection

Confirm there's a documented, authorized way to answer a compliance question ("show every
access to record X in the last year", "show everything user Y has viewed") — either a
reporting endpoint gated by a dedicated `Audit.Query` permission (per `dotnet-authorization`'s
permissions-only model) or a direct read-only reporting connection, rather than requiring
a DBA to hand-write ad-hoc SQL against the audit table for every request.

### BAD — no reporting surface, every compliance request is a bespoke SQL query

```
# Compliance asks "who viewed customer X's record in Q1" — someone writes a one-off
# SQL query by hand each time, with no consistent authorization gate on who can run it.
```

### GOOD — a permission-gated reporting endpoint

```csharp
[Authorize(Policy = Permissions.Audit.Query)]
[HttpGet("api/audit/access-log")]
public async Task<IActionResult> QueryAccessLog(
    [FromQuery] Guid? resourceId, [FromQuery] Guid? userId, [FromQuery] DateTime? since)
{
    var query = _db.AccessLog.AsNoTracking().AsQueryable();
    if (resourceId is not null) query = query.Where(a => a.ResourceId == resourceId);
    if (userId is not null) query = query.Where(a => a.UserId == userId);
    if (since is not null) query = query.Where(a => a.Timestamp >= since);
    return Ok(await query.ToListAsync());
}
```

---

## Check D — Access-log write done synchronously in the request path (ATR-004)

### Detection

Check whether writing the access-log entry blocks the response — a slow/contended audit
table write shouldn't add latency to (or fail) the user-facing read it's logging. Prefer
queuing the log entry (in-process channel, or the outbox pattern from
`dotnet-outbox-pattern`) and writing it out-of-band.

### BAD — audit write is a blocking call on the critical path

```csharp
var customer = await _db.Customers.FindAsync(id);
await _db.SaveChangesAsync(); // includes the AccessLogEntry insert — if this table is contended, the read slows down too
return Ok(customer.ToDto());
```

### GOOD — access-log write queued, doesn't block the response

```csharp
var customer = await _db.Customers.FindAsync(id);
_auditQueue.Enqueue(new AccessLogEntry { /* ... */ }); // in-memory channel, drained by a background writer
return Ok(customer.ToDto());
```
