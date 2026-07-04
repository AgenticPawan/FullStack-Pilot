---
name: dotnet-connection-pool-tuning
description: Reviews database connection-pool sizing and exhaustion monitoring — a distinct failure mode from dotnet-resilience's retry/circuit-breaker policies, which handle a connection failing, not a pool running out of connections to hand out in the first place. Flags no explicit Max Pool Size tuned to expected concurrency, no monitoring/alerting on pool exhaustion, connections held open longer than the unit of work requires, and HttpClient/database connections not scoped correctly for the hosting model. Outputs findings with pilot-dotnet connection-pool-tuning standard IDs.
when_to_use: connection pool, Max Pool Size, Min Pool Size, pool exhaustion, SqlConnection pooling, DbContext lifetime, connection leak, pool timeout, concurrent connections
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| CP-001 | P1 | No explicit `Max Pool Size` tuned to expected concurrency |
| CP-002 | P1 | No monitoring/alerting on pool exhaustion |
| CP-003 | P1 | Connection/DbContext held open longer than the unit of work requires |
| CP-004 | P2 | `DbContext` registered with an incorrect lifetime for the hosting model |

`dotnet-resilience`'s `EnableRetryOnFailure` (RES-006) handles a connection *failing*
transiently. This skill handles a different failure mode entirely — the pool having no
more connections to hand out, which manifests as request timeouts under load rather than
a retryable transient error, and needs sizing/lifetime discipline, not a retry policy.

---

## Check A — No explicit Max Pool Size tuned to concurrency (CP-001)

### Detection

Check the connection string for `Max Pool Size` (default 100 in ADO.NET) against the
application's actual expected concurrent-connection need — a default left unexamined
either silently caps throughput under real load (100 is too low for a high-concurrency
API) or, if raised blindly without checking the database's own connection limit, causes
the *database* to reject connections instead of the pool queuing them client-side.

### BAD — default pool size, never evaluated against real concurrency or the DB's own limits

```
Server=sql.internal;Database=Orders;Max Pool Size=100;
<!-- Never validated against the Orders API's actual peak concurrent-connection count,
     or against the SQL Database tier's own max_connections limit. -->
```

### GOOD — pool size sized deliberately, validated against both application concurrency and the database tier's limit

```
Server=sql.internal;Database=Orders;Max Pool Size=200;Min Pool Size=10;
```

```markdown
<!-- docs/CONNECTION-POOL.md -->
Orders API: peak measured concurrency ~150 connections (from Application Insights
dependency telemetry). Max Pool Size set to 200 (25% headroom). SQL Database tier's
max_connections is 400 shared across 2 app instances — 200 each stays well under that.
```

---

## Check B — No monitoring/alerting on pool exhaustion (CP-002)

### Detection

Check whether pool exhaustion (a `InvalidOperationException: Timeout expired. The
timeout period elapsed prior to obtaining a connection from the pool`) is distinguishable
in telemetry from a generic database error, and whether an alert exists specifically for
it — pool exhaustion under a traffic spike is a distinct, actionable signal ("scale out"
or "raise Max Pool Size") that a generic "database errors increased" alert doesn't surface
clearly.

### BAD — pool-exhaustion errors logged as generic exceptions, no dedicated alert

```csharp
catch (Exception ex)
{
    _logger.LogError(ex, "Database operation failed"); // pool-exhaustion timeout looks identical to any other DB error
}
```

### GOOD — pool exhaustion specifically identified and alerted

```csharp
catch (InvalidOperationException ex) when (ex.Message.Contains("Timeout expired"))
{
    _logger.LogError(ex, "Connection pool exhausted for {Database}", "Orders");
    // Distinct log signature feeds a dedicated Azure Monitor alert (azure-observability
    // AOBS-003), differentiated from generic 5xx error-rate alerts.
}
```

---

## Check C — Connection/DbContext held open longer than needed (CP-003)

### Detection

Grep for a `DbContext`/connection resolved at the start of a long-running method (one
that also makes an outbound HTTP call, per `dotnet-resilience`, or does significant
non-DB work) and held open for the method's entire duration instead of being scoped
tightly around just the DB operations. A connection held open during a slow outbound
call to another service is a connection sitting idle in the pool doing nothing useful,
directly contributing to exhaustion under concurrent load.

### BAD — DbContext held open across a slow outbound HTTP call

```csharp
public async Task ProcessOrderAsync(Guid orderId)
{
    var order = await _db.Orders.FindAsync(orderId); // connection acquired here
    var paymentResult = await _paymentGateway.ChargeAsync(order.Total); // slow external call — connection sits idle the whole time
    order.Status = paymentResult.Success ? OrderStatus.Paid : OrderStatus.Failed;
    await _db.SaveChangesAsync(); // connection finally released here
}
```

### GOOD — connection scoped tightly around the actual DB work

```csharp
public async Task ProcessOrderAsync(Guid orderId)
{
    Order order;
    await using (var scope = _dbContextFactory.CreateDbContext())
    {
        order = await scope.Orders.FindAsync(orderId);
    } // connection released immediately

    var paymentResult = await _paymentGateway.ChargeAsync(order.Total); // no connection held during this

    await using var updateScope = _dbContextFactory.CreateDbContext();
    var trackedOrder = await updateScope.Orders.FindAsync(orderId);
    trackedOrder.Status = paymentResult.Success ? OrderStatus.Paid : OrderStatus.Failed;
    await updateScope.SaveChangesAsync();
}
```

---

## Check D — DbContext lifetime mismatched to the hosting model (CP-004)

### Detection

Check whether `DbContext` is registered with `AddDbContext` (scoped, one instance per
HTTP request — correct for typical request/response APIs) versus incorrectly used as a
singleton (a single `DbContext` instance shared across all concurrent requests is not
thread-safe and will corrupt its internal state under concurrent access) or resolved
fresh per operation in a background job/console context where `IDbContextFactory` is the
correct pattern instead.

### BAD — DbContext registered as a singleton

```csharp
builder.Services.AddSingleton<AppDbContext>(); // shared across every concurrent request — not thread-safe
```

### GOOD — scoped for web requests, factory for background jobs

```csharp
builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlServer(connectionString)); // scoped by default

// For Hangfire jobs (dotnet-background-jobs) running outside a request scope:
builder.Services.AddDbContextFactory<AppDbContext>(options => options.UseSqlServer(connectionString));

public class InvoiceReminderJob(IDbContextFactory<AppDbContext> factory)
{
    public async Task RunAsync()
    {
        await using var db = await factory.CreateDbContextAsync(); // fresh, correctly-scoped context per job run
    }
}
```
