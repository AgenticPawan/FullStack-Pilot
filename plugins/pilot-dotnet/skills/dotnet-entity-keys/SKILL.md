---
name: dotnet-entity-keys
description: Reviews EF Core entity primary-key design. Flags integer identity keys on public-facing entities (ID enumeration/IDOR risk), random (v4) GUIDs used for high-insert-volume clustered-index tables instead of sequential/v7-style GUIDs, missing sequential-GUID configuration in OnModelCreating for SQL Server, and sensitive entities that expose their raw database identifier as the public API resource ID with no opaque layer. Outputs findings with pilot-dotnet entity-keys standard IDs.
when_to_use: entity Id, primary key, GUID key, Guid.NewGuid, sequential guid, NEWSEQUENTIALID, identity column, int PK, IDOR, ID enumeration, clustered index fragmentation, Guid.CreateVersion7, resource identifier, opaque ID
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| EK-001 | P1 | Integer identity primary key on a public-facing entity instead of `Guid` |
| EK-002 | P2 | Random (v4) `Guid.NewGuid()` used for a high-insert-volume table instead of a sequential/v7-style GUID |
| EK-003 | P2 | `Guid` primary key not configured for sequential/clustered-index-friendly generation in `OnModelCreating` on SQL Server |
| EK-004 | P3 | Sensitive entity exposes its raw database `Id` as the public API resource identifier with no opaque layer (advisory) |

---

## Check A — Integer identity keys enable enumeration (EK-001)

### Detection

1. Grep entity classes for `public int Id { get; set; }` / `public long Id { get; set; }` on entities reachable through a public controller/minimal-API route (`GET /api/orders/{id}`).
2. Sequential integer identifiers let a caller enumerate `/api/orders/1`, `/api/orders/2`, ... and combined with a missing/weak ownership check, this is an IDOR (OWASP A01:2021).
3. Internal-only lookup tables (enum-like reference data never exposed by ID in a route) are not a finding.

### BAD — sequential int PK exposed in a public route

```csharp
public class Order
{
    public int Id { get; set; }   // 1, 2, 3, ... trivially enumerable
    public Guid TenantId { get; set; }
    public decimal Total { get; set; }
}

[HttpGet("api/orders/{id:int}")]
public async Task<ActionResult<OrderDto>> GetOrder(int id) => ...
```

### GOOD — Guid PK

```csharp
public class Order
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public decimal Total { get; set; }
}

[HttpGet("api/orders/{id:guid}")]
public async Task<ActionResult<OrderDto>> GetOrder(Guid id) => ...
```

**Detection rule:** flag `int`/`long` `Id` properties on any entity type referenced by a controller/minimal-API parameter binder, unless the entity is an internal reference/lookup table never resolved by ID from a client-facing route.

---

## Check B — Random GUIDs fragment the clustered index (EK-002)

### Detection

1. Grep entity constructors/factories for `Id = Guid.NewGuid()`.
2. Random (version 4) GUIDs are not monotonically increasing, so every insert on a table clustered on `Id` lands at a random point in the B-tree, causing page splits and index fragmentation at scale.
3. This is only a finding for tables with meaningful insert volume (transactional/high-write entities); a rarely-written reference table is not a finding.

### BAD — random GUID as clustered key on a high-write table

```csharp
public class OrderLine
{
    public Guid Id { get; set; } = Guid.NewGuid(); // random v4 — fragments the clustered index
    public Guid OrderId { get; set; }
}
```

### GOOD — sequential/v7-style GUID

```csharp
public class OrderLine
{
    // .NET 9+: RFC 9562 UUIDv7 — time-ordered, monotonically increasing
    public Guid Id { get; set; } = Guid.CreateVersion7();
}

// .NET 8 (no CreateVersion7): use a sequential-GUID helper instead of Guid.NewGuid()
public static class SequentialGuid
{
    public static Guid Create()
    {
        Span<byte> bytes = stackalloc byte[16];
        Guid.NewGuid().TryWriteBytes(bytes);
        var ticks = BitConverter.GetBytes(DateTime.UtcNow.Ticks);
        ticks.AsSpan(2, 6).CopyTo(bytes[10..]); // keep GUIDs increasing over time
        return new Guid(bytes);
    }
}
```

---

## Check C — Sequential GUID not configured at the database (EK-003)

### Detection

1. Open `OnModelCreating` for entities with a `Guid` primary key.
2. On SQL Server, if the app doesn't already generate sequential GUIDs in code (Check B), the column should have `.HasDefaultValueSql("NEWSEQUENTIALID()")` so the *database* generates monotonic keys instead of leaving it to `Guid.NewGuid()` defaults.
3. Flag a `Guid` PK column with neither app-level sequential generation nor `NEWSEQUENTIALID()`.

### BAD — no sequential generation anywhere

```csharp
modelBuilder.Entity<OrderLine>()
    .Property(x => x.Id); // relies on Guid.NewGuid() default — random, fragments clustered index
```

### GOOD — database-generated sequential GUID

```csharp
modelBuilder.Entity<OrderLine>()
    .Property(x => x.Id)
    .HasDefaultValueSql("NEWSEQUENTIALID()")
    .ValueGeneratedOnAdd();
```

---

## Check D — Raw Id as public resource identifier (EK-004, advisory)

### Detection

1. For entities holding sensitive data (financial records, PII-adjacent tables), check whether the database `Id` is returned verbatim as the API resource identifier with no opaque/obfuscation layer.
2. A `Guid` is not secret — if it appears in a shareable URL, log line, or third-party webhook payload, treat it as a stable but non-confidential identifier, not an access-control boundary. This is advisory, not a hard requirement: most entities are fine exposing their `Guid` Id directly since authorization (not obscurity) is the real control (see `dotnet-authorization` AZ-005 resource-based checks).
3. Flag only when a sensitive entity's ID doubles as a bearer-token-like secret (e.g., a password-reset or invite link keyed solely by a guessable/short-lived-looking ID with no additional signature/expiry check).

### BAD — entity Id doubles as an unsigned bearer token

```csharp
[HttpGet("api/password-reset/{id:guid}")]
public async Task<IActionResult> ConsumeResetLink(Guid id)
{
    var reset = await _db.PasswordResets.FindAsync(id);
    // No expiry check, no signature — the Guid IS the secret and never rotates checks.
}
```

### GOOD — opaque, time-boxed, signed token separate from the entity Id

```csharp
[HttpGet("api/password-reset/{token}")]
public async Task<IActionResult> ConsumeResetLink(string token)
{
    var reset = await _resetTokenService.ValidateAsync(token); // signed, single-use, expiring
    if (reset is null) return Unauthorized();
}
```
