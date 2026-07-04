---
name: dotnet-concurrency
description: Reviews EF Core / ASP.NET Core optimistic-concurrency handling. Flags multi-user-editable entities with no RowVersion/Timestamp concurrency token, unhandled DbUpdateConcurrencyException surfacing as a generic 500 instead of a 409 Conflict, PUT/PATCH endpoints with no ETag/If-Match precondition support, and read-modify-write sequences with no transaction/concurrency guard around them. Outputs findings with pilot-dotnet concurrency standard IDs.
when_to_use: optimistic concurrency, RowVersion, Timestamp attribute, DbUpdateConcurrencyException, ETag, If-Match, concurrency token, lost update, read-modify-write, 409 Conflict, concurrent edit
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| CCY-001 | P1 | Multi-user-editable entity has no optimistic-concurrency token |
| CCY-002 | P1 | `DbUpdateConcurrencyException` not caught/handled |
| CCY-003 | P2 | PUT/PATCH endpoint accepts no `If-Match`/`ETag` precondition |
| CCY-004 | P2 | Read-modify-write sequence has no transaction/concurrency guard |

---

## Check A — No optimistic-concurrency token (CCY-001)

### Detection

1. Identify entities editable by multiple users concurrently (shared records like orders,
   inventory, shared documents — not single-owner personal settings).
2. Check for a `RowVersion`/`[Timestamp]` column (or a manually-incremented version int)
   configured as a concurrency token. Without one, EF Core's default `SaveChanges`
   overwrites whatever was in the database with whatever the client last read — the
   second writer's update silently wins, and the first writer's changes vanish with no
   error to anyone.

### BAD — no concurrency token on a shared, frequently-edited entity

```csharp
public class Order
{
    public Guid Id { get; set; }
    public OrderStatus Status { get; set; }
    public decimal Total { get; set; }
    // No RowVersion — two managers editing this order simultaneously silently clobber each other.
}
```

### GOOD — RowVersion concurrency token

```csharp
public class Order
{
    public Guid Id { get; set; }
    public OrderStatus Status { get; set; }
    public decimal Total { get; set; }

    [Timestamp]
    public byte[] RowVersion { get; set; } = default!;
}
```

---

## Check B — DbUpdateConcurrencyException unhandled (CCY-002)

### Detection

Grep `SaveChangesAsync()` call sites for a surrounding `try`/`catch` for
`DbUpdateConcurrencyException`. Without one, a concurrency conflict bubbles up as an
unhandled exception, which `dotnet-error-handling`'s global handler turns into a generic
500 — a conflict is not a server bug, it should be a 409.

### BAD — concurrency exception falls through to a generic 500

```csharp
public async Task UpdateAsync(Order order)
{
    _db.Orders.Update(order);
    await _db.SaveChangesAsync(); // DbUpdateConcurrencyException -> unhandled -> 500
}
```

### GOOD — caught and mapped to a 409 Conflict

```csharp
public async Task<Result> UpdateAsync(Order order)
{
    _db.Orders.Update(order);
    try
    {
        await _db.SaveChangesAsync();
        return Result.Success();
    }
    catch (DbUpdateConcurrencyException)
    {
        return Result.Conflict("This order was modified by someone else. Reload and try again.");
    }
}

// Controller maps Result.Conflict to a 409, in the same ProblemDetails shape as dotnet-error-handling ERR-002
```

---

## Check C — No ETag/If-Match precondition on PUT/PATCH (CCY-003)

### Detection

Check whether a PUT/PATCH endpoint accepts an `If-Match` header (derived from an `ETag`
the client received on the prior GET) and rejects the write with `412 Precondition Failed`
if it doesn't match the current `RowVersion`. Without this, the *client* has no way to
detect it's about to overwrite someone else's change before submitting — it only finds out
after the fact via CCY-002's 409.

### BAD — no precondition check, client finds out only after submitting

```csharp
[HttpPut("{id:guid}")]
public async Task<IActionResult> Update(Guid id, UpdateOrderDto dto)
{
    var order = await _db.Orders.FindAsync(id);
    order!.Total = dto.Total; // no check that the client's view of the order is still current
    await _db.SaveChangesAsync();
    return NoContent();
}
```

### GOOD — ETag issued on GET, verified via If-Match on PUT

```csharp
[HttpGet("{id:guid}")]
public async Task<IActionResult> Get(Guid id)
{
    var order = await _db.Orders.FindAsync(id);
    Response.Headers.ETag = $"\"{Convert.ToBase64String(order!.RowVersion)}\"";
    return Ok(order);
}

[HttpPut("{id:guid}")]
public async Task<IActionResult> Update(Guid id, UpdateOrderDto dto)
{
    var order = await _db.Orders.FindAsync(id);
    var ifMatch = Request.Headers.IfMatch.ToString().Trim('"');
    if (ifMatch != Convert.ToBase64String(order!.RowVersion))
        return StatusCode(StatusCodes.Status412PreconditionFailed);

    order.Total = dto.Total;
    await _db.SaveChangesAsync();
    return NoContent();
}
```

---

## Check D — Read-modify-write with no guard (CCY-004)

### Detection

Grep for a sequence that reads an aggregate, computes something off it in application
code, and writes it back across multiple statements/round trips with no transaction or
concurrency token protecting the whole sequence — a classic race when two requests
interleave between the read and the write.

### BAD — race between reading the balance and writing the decrement

```csharp
var account = await _db.Accounts.FindAsync(accountId);
if (account!.Balance < amount) throw new InsufficientFundsException();
account.Balance -= amount; // two concurrent requests can both pass the check before either writes
await _db.SaveChangesAsync();
```

### GOOD — guarded by a concurrency token (Check A) so the second writer fails and retries

```csharp
var account = await _db.Accounts.FindAsync(accountId);
if (account!.Balance < amount) throw new InsufficientFundsException();
account.Balance -= amount;

try
{
    await _db.SaveChangesAsync(); // RowVersion mismatch -> DbUpdateConcurrencyException if raced
}
catch (DbUpdateConcurrencyException)
{
    // Reload and retry, or surface a 409 per Check B — never silently apply a stale decrement.
}
```
