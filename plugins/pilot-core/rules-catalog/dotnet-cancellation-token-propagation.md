---
id: dotnet-cancellation-token-propagation
title: Propagate CancellationToken Through Every Async Call
appliesTo: dotnet
severity: warn
standard: reliability
---
Every `async` method that accepts a `CancellationToken` parameter MUST pass it to every
`await`-able call that also accepts one. Silently dropping the token means an HTTP
connection close or request timeout cannot cancel in-flight I/O, wasting thread-pool
resources and producing orphaned DB queries.

**BAD — token accepted but not forwarded**
```csharp
public async Task<Order> GetOrderAsync(int id, CancellationToken ct)
{
    // ct is accepted but silently dropped on both I/O calls
    var order = await _db.Orders.FindAsync(id);
    var policy = await _http.GetStringAsync("/policy");
    return order;
}
```

**GOOD — token flows through every async call**
```csharp
public async Task<Order> GetOrderAsync(int id, CancellationToken ct)
{
    var order = await _db.Orders.FindAsync(new object[] { id }, ct);
    var policy = await _http.GetStringAsync("/policy", ct);
    return order;
}
```

**Detection hints** (for reviewers):
- Any `async` method where the `CancellationToken` parameter name does NOT appear in an
  `await` expression inside the method body.
- `HttpClient.GetAsync()`, `GetStringAsync()`, `PostAsync()`, `SendAsync()` all have
  `CancellationToken` overloads — prefer them.
- `DbSet.FindAsync(keyValues, ct)` and `DbContext.SaveChangesAsync(ct)` are the EF Core
  entry points.

**Exception:** fire-and-forget tasks intentionally outliving the request use a
`CancellationToken.None` or a linked root-token with a documented lifetime contract.
