---
name: dotnet-idempotency
description: Reviews idempotency for synchronous client-facing APIs — distinct from dotnet-outbox-pattern's async consumer idempotency. Flags state-changing POST/PATCH endpoints accepting no Idempotency-Key, idempotency stores with no expiry, replayed duplicates returning fresh results instead of the original response, and concurrent duplicates racing past the check. Outputs pilot-dotnet idempotency standard IDs.
when_to_use: idempotency key, Idempotency-Key header, duplicate request, retry safety, at-least-once client retry, double submission, double charge, exactly-once semantics, idempotent POST, request deduplication
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| IDM-001 | P0 | State-changing endpoint (payment, order submission) accepts no `Idempotency-Key` |
| IDM-002 | P2 | Idempotency-key store has no expiry/TTL policy |
| IDM-003 | P1 | Replayed request with the same key returns a fresh result instead of the original cached response |
| IDM-004 | P1 | Concurrent duplicate requests race past the idempotency check instead of being serialized |

---

## Check A — No Idempotency-Key on state-changing endpoints (IDM-001)

### Detection

Grep `[HttpPost]`/`[HttpPatch]` endpoints with financial or otherwise non-repeatable side
effects (charge card, submit order, send payment) for whether they read an
`Idempotency-Key` request header at all. A client behind a flaky network — or a gateway
retrying a timed-out request — cannot tell whether the original attempt succeeded, and will
resubmit. Without a key, that resubmission becomes a second charge/second order.

### BAD — payment endpoint with no protection against a client retry

```csharp
[HttpPost("charge")]
public async Task<IActionResult> Charge(ChargeRequest request)
{
    var result = await _paymentGateway.ChargeAsync(request.Amount, request.CardToken);
    return Ok(result); // a network-timeout retry from the client charges the card twice
}
```

### GOOD — Idempotency-Key required, prior result replayed on retry

```csharp
[HttpPost("charge")]
public async Task<IActionResult> Charge([FromHeader(Name = "Idempotency-Key")] string idempotencyKey, ChargeRequest request)
{
    if (string.IsNullOrEmpty(idempotencyKey))
        return BadRequest("Idempotency-Key header is required for this endpoint.");

    var cached = await _idempotencyStore.TryGetAsync(idempotencyKey);
    if (cached is not null) return Ok(cached); // replay the original result, don't charge again

    var result = await _paymentGateway.ChargeAsync(request.Amount, request.CardToken);
    await _idempotencyStore.SaveAsync(idempotencyKey, result);
    return Ok(result);
}
```

---

## Check B — No expiry policy on the idempotency store (IDM-002)

### Detection

Check the idempotency-key store's schema/cache configuration for a TTL. Keys that live
forever mean the table/cache grows without bound and, more subtly, a key reused by a
different client (or the same client, months later, for an unrelated request) after the
original business context is gone can return a stale cached result.

### BAD — idempotency keys persisted with no expiry

```csharp
public async Task SaveAsync(string key, object result)
{
    await _db.IdempotencyKeys.AddAsync(new IdempotencyKeyRecord { Key = key, ResultJson = JsonSerializer.Serialize(result) });
    await _db.SaveChangesAsync(); // never cleaned up — table grows forever
}
```

### GOOD — bounded TTL matching the client's realistic retry window

```csharp
public async Task SaveAsync(string key, object result)
{
    await _cache.SetStringAsync(
        $"idem:{key}",
        JsonSerializer.Serialize(result),
        new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(24) }); // long enough for realistic client retries, not forever
}
```

---

## Check C — Replay returns a fresh result instead of the cached one (IDM-003)

### Detection

Confirm the idempotency check happens *before* the side-effecting call, and that a cache
hit short-circuits straight to the stored response — not a version where the key is only
used for logging/analytics while the underlying charge/order logic re-runs regardless.

### BAD — idempotency key recorded but the operation always re-executes

```csharp
[HttpPost("charge")]
public async Task<IActionResult> Charge([FromHeader(Name = "Idempotency-Key")] string key, ChargeRequest request)
{
    await _idempotencyStore.LogAsync(key); // recorded, but never checked before charging
    var result = await _paymentGateway.ChargeAsync(request.Amount, request.CardToken); // runs every time regardless of key
    return Ok(result);
}
```

### GOOD — cache hit short-circuits before the side effect runs (see Check A's GOOD example)

Reuse the `TryGetAsync` check from Check A — the gate must sit strictly before the
gateway/database call that produces the side effect, not alongside it.

---

## Check D — Concurrent duplicates race past the check (IDM-004)

### Detection

Consider two identical requests (same key) arriving within milliseconds of each other —
before the first one has finished and written its result to the store. If the idempotency
check is a plain read with no locking, both requests can pass the "not found" check and
both execute the side effect. Confirm a distributed lock, unique-constraint insert-first
pattern, or an atomic `SETNX`-style claim guards the window between check and write.

### BAD — check-then-act with no lock — a race window both requests can pass through

```csharp
var cached = await _idempotencyStore.TryGetAsync(key); // both concurrent requests see "not found"
if (cached is not null) return Ok(cached);
var result = await _paymentGateway.ChargeAsync(...);   // both requests execute the charge
await _idempotencyStore.SaveAsync(key, result);
```

### GOOD — claim the key atomically first; only the winner proceeds

```csharp
var claimed = await _idempotencyStore.TryClaimAsync(key); // atomic INSERT with a unique constraint on Key, or cache SETNX
if (!claimed)
{
    var result = await _idempotencyStore.WaitForResultAsync(key, timeout: TimeSpan.FromSeconds(10));
    return result is not null ? Ok(result) : Conflict("Request already in progress.");
}

var chargeResult = await _paymentGateway.ChargeAsync(...);
await _idempotencyStore.SaveAsync(key, chargeResult);
return Ok(chargeResult);
```

---

## Idempotency checklist

- [ ] Every financial/state-changing POST/PATCH endpoint requires and honors an `Idempotency-Key` header
- [ ] The idempotency store has a bounded TTL matched to realistic client retry windows
- [ ] A cache hit on the key short-circuits to the stored result before the side effect runs, never after
- [ ] Key claiming is atomic (unique-constraint insert or distributed lock), closing the race between concurrent duplicate requests
- [ ] This is distinct from `dotnet-outbox-pattern`'s consumer idempotency — that skill covers async message delivery; this one covers synchronous client-facing retries
