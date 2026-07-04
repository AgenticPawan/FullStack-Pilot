---
name: dotnet-performance
description: Reviews ASP.NET Core and EF Core code for runtime performance regressions: sync-over-async blocking that starves the thread pool, ValueTask/Task misuse in hot paths, large in-memory materialization instead of streaming with IAsyncEnumerable, minimal API vs MVC controller overhead, missing response compression for large JSON payloads, and string concatenation in loops instead of StringBuilder/string.Create.
when_to_use: performance review, thread pool starvation, .Result, .Wait(), blocking call, ValueTask, IAsyncEnumerable, streaming query, ToList, minimal API, ApiController overhead, response compression, string concatenation, StringBuilder, hot path, high throughput endpoint
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| PF-001 | P0 | Sync-over-async blocking call (`.Result`, `.Wait()`, `GetAwaiter().GetResult()`) on a hot path |
| PF-002 | P3 | Frequently-synchronous-completing async method returns `Task<T>` instead of `ValueTask<T>` (advisory) |
| PF-003 | P1 | Large query result fully materialized with `.ToList()`/`.ToListAsync()` where streaming is possible |
| PF-004 | P2 | High-throughput endpoint implemented as MVC controller with unnecessary `[ApiController]` filter pipeline |
| PF-005 | P2 | Large JSON API responses served without response compression configured |
| PF-006 | P2 | String concatenation inside a loop instead of `StringBuilder`/`string.Create` |

---

## Check A — Sync-over-async blocking

### Detection

1. Search for `.Result`, `.Wait()`, `.GetAwaiter().GetResult()` in controller actions, minimal API handlers, or any method reachable from a request path.
2. Exclude usages inside `Main`/console bootstrap code and `[Fact]`-free synchronous test setup — those are lower risk but still flag as advisory if inside ASP.NET Core request pipeline code.
3. Any hit inside a request-handling method → PF-001.

### BAD — blocking on async work in a controller action

```csharp
[HttpGet("{id}")]
public IActionResult GetOrder(int id)
{
    // Blocks a thread-pool thread until the async call completes —
    // under load this starves the pool and tanks throughput/latency.
    var order = _orderService.GetOrderAsync(id).Result;
    return order is null ? NotFound() : Ok(order);
}
```

### GOOD — async all the way through

```csharp
[HttpGet("{id}")]
public async Task<IActionResult> GetOrder(int id)
{
    var order = await _orderService.GetOrderAsync(id);
    return order is null ? NotFound() : Ok(order);
}
```

---

## Check B — ValueTask vs Task in hot paths

### Detection

1. Identify methods called at high frequency (per-request, per-item-in-loop) that often complete synchronously (e.g., cache hits).
2. If such a method returns `Task<T>` and allocates a new `Task` on every call even for the synchronous-completion branch, flag PF-002 as advisory.
3. Do **not** flag methods that are awaited multiple times, stored, or passed across async boundaries — `ValueTask<T>` must not be reused/awaited twice.

### BAD — allocates a Task even on the common cache-hit path

```csharp
public Task<Product?> GetProductAsync(int id)
{
    if (_cache.TryGetValue(id, out Product? cached))
    {
        return Task.FromResult(cached); // allocation on every cache hit
    }

    return LoadFromDatabaseAsync(id);
}
```

### GOOD — ValueTask avoids the allocation on the hot, synchronous path

```csharp
public ValueTask<Product?> GetProductAsync(int id)
{
    if (_cache.TryGetValue(id, out Product? cached))
    {
        return ValueTask.FromResult(cached);
    }

    return new ValueTask<Product?>(LoadFromDatabaseAsync(id));
}

// Caller must await exactly once and must not store the ValueTask.
private async Task<Product?> LoadFromDatabaseAsync(int id)
    => await _db.Products.FindAsync(id);
```

---

## Check C — Streaming instead of full materialization

### Detection

1. Search EF Core LINQ queries for `.ToList()` / `.ToListAsync()` applied to queries without a `Take`/paging clause, especially ones exposed via export/report endpoints.
2. If the result set can plausibly be large (no `Take`, no pagination parameters) and the consumer only iterates once (e.g., writes to a stream/CSV), flag PF-003 and recommend `AsAsyncEnumerable()`.

### BAD — loads the entire table into memory before streaming to the client

```csharp
[HttpGet("export")]
public async Task<IActionResult> ExportOrders()
{
    var orders = await _db.Orders.AsNoTracking().ToListAsync(); // full materialization

    var stream = new MemoryStream();
    await using var writer = new StreamWriter(stream, leaveOpen: true);
    foreach (var order in orders)
    {
        await writer.WriteLineAsync($"{order.Id},{order.Total}");
    }

    stream.Position = 0;
    return File(stream, "text/csv", "orders.csv");
}
```

### GOOD — streams rows from the database as they are written to the response

```csharp
[HttpGet("export")]
public async Task ExportOrders(CancellationToken ct)
{
    Response.ContentType = "text/csv";
    Response.Headers.ContentDisposition = "attachment; filename=orders.csv";

    await foreach (var order in _db.Orders.AsNoTracking().AsAsyncEnumerable().WithCancellation(ct))
    {
        await Response.WriteAsync($"{order.Id},{order.Total}\n", ct);
    }
}
```

---

## Check D — Minimal API vs MVC controller overhead

### Detection

1. Locate high-throughput endpoints (identified by naming, comments, or load-test annotations) implemented as `[ApiController]` MVC actions.
2. Check whether the controller pulls in filters (`[ServiceFilter]`, global `MvcOptions.Filters`) that add per-request overhead not needed for a simple, single-purpose endpoint.
3. Recommend a minimal API endpoint when the action has no model-binding complexity, no view rendering, and no shared filter logic that couldn't be expressed as endpoint filters.

### BAD — simple, hot GET endpoint paying for the full MVC pipeline

```csharp
[ApiController]
[Route("api/[controller]")]
public class PingController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(new { status = "ok", time = DateTimeOffset.UtcNow });
}
```

### GOOD — minimal API for a hot, simple endpoint

```csharp
app.MapGet("/api/ping", () => Results.Ok(new { status = "ok", time = DateTimeOffset.UtcNow }))
   .WithName("Ping")
   .CacheOutput(p => p.Expire(TimeSpan.FromSeconds(5)));
```

---

## Check E — Response compression for large JSON payloads

### Detection

1. In `Program.cs`, check whether `builder.Services.AddResponseCompression(...)` and `app.UseResponseCompression()` are registered.
2. If large JSON-returning endpoints exist (list/report/export controllers) and compression is not configured, flag PF-005.
3. Confirm HTTPS compression is enabled deliberately (`EnableForHttps = true`) — some teams disable it by default due to BREACH-style concerns; if disabled without justification comment, note it as informational, not a blocker.

### BAD — no response compression configured for large payload endpoints

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();

var app = builder.Build();
app.MapControllers();
app.Run();
```

### GOOD — response compression registered and enabled for HTTPS

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(new[] { "application/json" });
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
builder.Services.AddControllers();

var app = builder.Build();
app.UseResponseCompression();
app.MapControllers();
app.Run();
```

---

## Check F — String concatenation in loops

### Detection

1. Search for `+=` string concatenation, or `+` chains building a string, inside `for`/`foreach`/`while` loop bodies.
2. Exclude cases where the loop runs a small, fixed, known-small number of iterations (e.g., under 5) — flag only when the iteration count is data-driven or unbounded.
3. Recommend `StringBuilder` for incremental appends, or `string.Create` for fixed-length, high-frequency formatting.

### BAD — quadratic string allocation in a loop over a large collection

```csharp
public string BuildReport(IEnumerable<OrderLine> lines)
{
    var report = string.Empty;
    foreach (var line in lines)
    {
        report += $"{line.Sku}\t{line.Quantity}\t{line.Price}\n"; // new string allocated each iteration
    }

    return report;
}
```

### GOOD — StringBuilder accumulates without repeated reallocation

```csharp
public string BuildReport(IEnumerable<OrderLine> lines)
{
    var sb = new StringBuilder();
    foreach (var line in lines)
    {
        sb.Append(line.Sku).Append('\t')
          .Append(line.Quantity).Append('\t')
          .Append(line.Price).Append('\n');
    }

    return sb.ToString();
}
```
