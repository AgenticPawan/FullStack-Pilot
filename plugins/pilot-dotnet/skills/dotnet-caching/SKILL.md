---
name: dotnet-caching
description: Reviews ASP.NET Core / EF Core caching strategy. Flags IMemoryCache used in horizontally-scaled APIs (cache incoherence), cache-aside code with no stampede guard, missing cache invalidation on writes, missed HybridCache adoption on .NET 9+ (advisory), missing HTTP-level caching (ResponseCache/ETags) on cacheable GET endpoints, and caching mutable tracked EF Core entities instead of DTO snapshots.
when_to_use: caching strategy, IMemoryCache, IDistributedCache, Redis, cache-aside, cache stampede, GetOrCreateAsync, cache invalidation, stale cache, HybridCache, ResponseCache, ETag, If-None-Match, cache DTO, tracked entity cache, horizontally scaled cache
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| CH-001 | P1 | `IMemoryCache` used for shared state in a horizontally-scaled/multi-instance API |
| CH-002 | P1 | Cache-aside implemented without a stampede guard around cache population |
| CH-003 | P1 | Cache entry never invalidated/updated on the corresponding write path |
| CH-004 | P3 | Eligible for `HybridCache` (.NET 9+) but still using separate L1/L2 caching (advisory, version-gated) |
| CH-005 | P2 | Cacheable GET endpoint missing `[ResponseCache]`/ETag support |
| CH-006 | P1 | Tracked EF Core entity cached directly instead of a DTO snapshot |

---

## Check A — IMemoryCache in a scaled-out API

### Detection

1. Check `stack-profile.json` / deployment config (Bicep, AKS manifests, App Service scale settings) for more than one instance/replica.
2. If the codebase uses `IMemoryCache` to store data that must be consistent across requests (e.g., feature flags, session-adjacent state, rate-limit counters) and the app is deployed with `instanceCount > 1` or autoscale enabled, flag CH-001.
3. Recommend `IDistributedCache` backed by Redis (`AddStackExchangeRedisCache`) for anything that must be coherent across instances.

### BAD — per-instance cache used for data that must be shared

```csharp
public class PricingService
{
    private readonly IMemoryCache _cache;

    public PricingService(IMemoryCache cache) => _cache = cache;

    public async Task<decimal> GetDiscountAsync(string sku)
    {
        // On a 3-instance deployment, each instance can serve a different
        // discount value for a short window after an update — cache incoherence.
        if (_cache.TryGetValue(sku, out decimal discount))
        {
            return discount;
        }

        discount = await LoadDiscountFromDbAsync(sku);
        _cache.Set(sku, discount, TimeSpan.FromMinutes(10));
        return discount;
    }
}
```

### GOOD — distributed cache shared across all instances

```csharp
public class PricingService
{
    private readonly IDistributedCache _cache;

    public PricingService(IDistributedCache cache) => _cache = cache;

    public async Task<decimal> GetDiscountAsync(string sku)
    {
        var cached = await _cache.GetStringAsync($"discount:{sku}");
        if (cached is not null)
        {
            return decimal.Parse(cached, CultureInfo.InvariantCulture);
        }

        var discount = await LoadDiscountFromDbAsync(sku);
        await _cache.SetStringAsync(
            $"discount:{sku}",
            discount.ToString(CultureInfo.InvariantCulture),
            new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10) });

        return discount;
    }
}
```

---

## Check B — Cache stampede guard

### Detection

1. Look for cache-aside code that checks-then-populates a cache key (`TryGetValue` → miss → expensive load → `Set`) without any locking or single-flight mechanism.
2. Under concurrent load, a key expiring causes every simultaneous caller to fall through to the expensive load — flag CH-002.
3. Recommend `IMemoryCache.GetOrCreateAsync` (which does not itself de-duplicate concurrent misses) combined with a per-key `SemaphoreSlim`, or a library that supports single-flight semantics.

### BAD — every concurrent miss re-executes the expensive load

```csharp
public async Task<Report> GetReportAsync(int tenantId)
{
    if (_cache.TryGetValue(tenantId, out Report? report))
    {
        return report!;
    }

    // Under load, N concurrent requests on expiry all hit the DB/report engine at once.
    report = await _reportEngine.BuildReportAsync(tenantId);
    _cache.Set(tenantId, report, TimeSpan.FromMinutes(5));
    return report;
}
```

### GOOD — per-key lock prevents a stampede on expiry

```csharp
private static readonly ConcurrentDictionary<int, SemaphoreSlim> _locks = new();

public async Task<Report> GetReportAsync(int tenantId)
{
    if (_cache.TryGetValue(tenantId, out Report? report))
    {
        return report!;
    }

    var gate = _locks.GetOrAdd(tenantId, _ => new SemaphoreSlim(1, 1));
    await gate.WaitAsync();
    try
    {
        // Double-check after acquiring the lock — another caller may have populated it.
        if (_cache.TryGetValue(tenantId, out report))
        {
            return report!;
        }

        report = await _reportEngine.BuildReportAsync(tenantId);
        _cache.Set(tenantId, report, TimeSpan.FromMinutes(5));
        return report;
    }
    finally
    {
        gate.Release();
    }
}
```

---

## Check C — Missing cache invalidation on write

### Detection

1. For every cached read key, search the codebase for the corresponding write/update/delete path (same entity/aggregate).
2. If a write path mutates the underlying data but does not call `_cache.Remove(...)` / update the cache entry for the same key, flag CH-003.
3. Pay special attention to update endpoints that call `SaveChangesAsync()` without any cache interaction at all.

### BAD — price updated in the database but the stale cached value keeps serving

```csharp
public async Task UpdatePriceAsync(int productId, decimal newPrice)
{
    var product = await _db.Products.FindAsync(productId);
    product!.Price = newPrice;
    await _db.SaveChangesAsync();
    // No cache invalidation — GetPriceAsync keeps returning the old cached price
    // until the TTL expires.
}
```

### GOOD — cache entry evicted immediately after the write commits

```csharp
public async Task UpdatePriceAsync(int productId, decimal newPrice)
{
    var product = await _db.Products.FindAsync(productId);
    product!.Price = newPrice;
    await _db.SaveChangesAsync();

    await _cache.RemoveAsync($"product-price:{productId}");
}
```

---

## Check D — HybridCache adoption (advisory, .NET 9+)

### Detection

1. Confirm target framework in the `.csproj` is `net9.0` or later (`<TargetFramework>net9.0</TargetFramework>`).
2. If the codebase manually layers `IMemoryCache` (L1) in front of `IDistributedCache` (L2) with hand-rolled fallback logic, flag CH-004 as an advisory suggestion to adopt `HybridCache`, which provides this pattern plus stampede protection built in.
3. Do not flag on `net6.0`–`net8.0` targets — `HybridCache` ships in `Microsoft.Extensions.Caching.Hybrid` for .NET 9+.

### BAD — hand-rolled two-tier cache with no stampede protection

```csharp
public async Task<Product?> GetProductAsync(int id)
{
    if (_memoryCache.TryGetValue(id, out Product? p))
    {
        return p;
    }

    var cachedJson = await _distributedCache.GetStringAsync($"product:{id}");
    if (cachedJson is not null)
    {
        p = JsonSerializer.Deserialize<Product>(cachedJson);
        _memoryCache.Set(id, p, TimeSpan.FromSeconds(30));
        return p;
    }

    p = await _db.Products.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
    await _distributedCache.SetStringAsync($"product:{id}", JsonSerializer.Serialize(p));
    _memoryCache.Set(id, p, TimeSpan.FromSeconds(30));
    return p;
}
```

### GOOD — HybridCache handles L1/L2 and stampede protection

```csharp
builder.Services.AddHybridCache();

public class ProductService(HybridCache cache, AppDbContext db)
{
    public async Task<Product?> GetProductAsync(int id, CancellationToken ct)
    {
        return await cache.GetOrCreateAsync(
            $"product:{id}",
            async token => await db.Products.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, token),
            new HybridCacheEntryOptions { Expiration = TimeSpan.FromSeconds(30) },
            cancellationToken: ct);
    }
}
```

---

## Check E — HTTP-level caching for cacheable GETs

### Detection

1. Identify GET endpoints returning data that changes infrequently (reference/lookup data, public catalog listings).
2. If neither `[ResponseCache(...)]` nor ETag/`If-None-Match` handling is present, flag CH-005.

### BAD — no HTTP caching hints, every request refetches identical data

```csharp
[HttpGet("categories")]
public async Task<IActionResult> GetCategories()
{
    var categories = await _db.Categories.AsNoTracking().ToListAsync();
    return Ok(categories);
}
```

### GOOD — ResponseCache header lets clients/CDNs avoid re-fetching

```csharp
[HttpGet("categories")]
[ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any)]
public async Task<IActionResult> GetCategories()
{
    var categories = await _db.Categories.AsNoTracking().ToListAsync();
    return Ok(categories);
}
```

---

## Check F — Caching tracked EF Core entities directly

### Detection

1. Search cache-population code for entities loaded via a tracking query (no `AsNoTracking()`) being passed directly into `_cache.Set(...)`.
2. Storing a tracked entity risks stale/incorrect data on subsequent context use and can leak change-tracker state across requests if the entity is later attached to a new context. Recommend mapping to a DTO before caching.

### BAD — tracked entity cached and later reused across requests

```csharp
public async Task<Customer> GetCustomerAsync(int id)
{
    if (_cache.TryGetValue(id, out Customer? cached))
    {
        return cached!; // may be attached to a disposed DbContext's change tracker
    }

    var customer = await _db.Customers.FirstAsync(c => c.Id == id); // tracked
    _cache.Set(id, customer, TimeSpan.FromMinutes(5));
    return customer;
}
```

### GOOD — DTO snapshot is cached, entity never leaves the DbContext scope

```csharp
public record CustomerDto(int Id, string Name, string Email);

public async Task<CustomerDto> GetCustomerAsync(int id)
{
    if (_cache.TryGetValue(id, out CustomerDto? cached))
    {
        return cached!;
    }

    var dto = await _db.Customers
        .AsNoTracking()
        .Where(c => c.Id == id)
        .Select(c => new CustomerDto(c.Id, c.Name, c.Email))
        .FirstAsync();

    _cache.Set(id, dto, TimeSpan.FromMinutes(5));
    return dto;
}
```
