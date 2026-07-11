---
name: dotnet-backend-for-frontend
description: Reviews the BFF pattern — a dedicated API layer aggregating internal services for the Angular client so internal topology never reaches the browser. Flags Angular calling downstream services directly, 1:1 proxy endpoints adding no value, one failing downstream call collapsing an aggregated response, business logic reimplemented in the BFF, and no UI-tuned caching/rate limiting. Outputs pilot-dotnet backend-for-frontend standard IDs.
when_to_use: BFF, backend for frontend, API aggregation, API gateway pattern, Angular calling internal service directly, graphql-style aggregation, response shaping, partial failure aggregation, BFF caching, internal topology leak
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| BFF-001 | P0 | Angular bypasses the BFF and calls internal/downstream services directly |
| BFF-002 | P1 | BFF endpoint is a pure 1:1 proxy with no aggregation/shaping value |
| BFF-003 | P1 | One failing downstream call takes down the entire aggregated response |
| BFF-004 | P1 | BFF reimplements business logic instead of delegating to the domain API |
| BFF-005 | P2 | No BFF-specific caching/rate limiting tuned to the actual UI call pattern |

---

## Check A — Angular bypasses the BFF (BFF-001)

### Detection

Grep the Angular codebase for `environment.ts`/service base URLs pointing directly at
internal service hostnames (`inventory-service.internal`, `pricing-api.internal`) instead
of a single BFF origin. If the browser is aware of internal service topology, it must also
orchestrate multiple round trips itself (waterfalling requests over a slow public network),
and any internal service rename/split becomes a breaking frontend change instead of an
internal refactor hidden behind the BFF contract.

### BAD — Angular services call multiple internal APIs directly

```typescript
// order-detail.service.ts
getOrderDetail(orderId: string) {
  return forkJoin({
    order: this.http.get(`https://order-service.internal/api/orders/${orderId}`),
    inventory: this.http.get(`https://inventory-service.internal/api/stock/${orderId}`),
    pricing: this.http.get(`https://pricing-service.internal/api/price/${orderId}`)
  }); // browser now knows 3 internal hostnames and orchestrates the fan-out itself
}
```

### GOOD — Angular calls a single BFF endpoint; aggregation happens server-side

```csharp
// OrderDetailController.cs (BFF)
[HttpGet("api/bff/orders/{orderId}")]
public async Task<ActionResult<OrderDetailViewModel>> GetOrderDetail(Guid orderId, CancellationToken ct)
{
    var (order, inventory, pricing) = await (
        _orderClient.GetOrderAsync(orderId, ct),
        _inventoryClient.GetStockAsync(orderId, ct),
        _pricingClient.GetPriceAsync(orderId, ct));

    return Ok(new OrderDetailViewModel(order, inventory, pricing));
}
```

```typescript
// Angular now only knows about the BFF origin
getOrderDetail(orderId: string) {
  return this.http.get<OrderDetailViewModel>(`/api/bff/orders/${orderId}`);
}
```

---

## Check B — BFF endpoint is a pure 1:1 proxy (BFF-002)

### Detection

Grep BFF controller actions for a method body that does nothing but forward the request to
a single downstream client and return the result verbatim, with no field shaping,
aggregation, or view-model projection. Every such endpoint is an unnecessary network hop
(added latency, another failure point) that provides zero value over calling the downstream
service directly — either give it real BFF value or remove it and let Angular call the
domain API through the gateway.

### BAD — controller action is a transparent pass-through

```csharp
[HttpGet("api/bff/products/{id}")]
public async Task<ActionResult<ProductDto>> GetProduct(Guid id)
{
    var product = await _productServiceClient.GetProductAsync(id); // no shaping, no aggregation
    return Ok(product); // identical shape to the downstream response — pure proxy, adds only latency
}
```

### GOOD — endpoint projects a UI-specific shape and aggregates related data

```csharp
[HttpGet("api/bff/products/{id}")]
public async Task<ActionResult<ProductDetailViewModel>> GetProduct(Guid id, CancellationToken ct)
{
    var productTask = _productServiceClient.GetProductAsync(id, ct);
    var reviewsTask = _reviewServiceClient.GetTopReviewsAsync(id, count: 3, ct);
    await Task.WhenAll(productTask, reviewsTask);

    return Ok(new ProductDetailViewModel
    {
        Name = productTask.Result.Name,
        Price = productTask.Result.Price,
        TopReviews = reviewsTask.Result.Select(r => new ReviewSummary(r.Author, r.Rating)).ToList()
        // shaped specifically for the product-detail page — not a re-export of the domain DTO
    });
}
```

---

## Check C — Partial failure collapses the whole response (BFF-003)

### Detection

Grep aggregation endpoints that `await Task.WhenAll(...)` (or sequential awaits) and let
any single downstream exception propagate unhandled, returning a 500 to the whole page even
though most of the aggregated data succeeded. A dashboard that needs order data,
inventory data, and pricing data should still render the order and inventory sections if
only the pricing service is briefly down — flag any aggregation with no per-call
try/catch and no partial-success view model.

### BAD — one failing call throws and kills the entire response

```csharp
[HttpGet("api/bff/dashboard/{orderId}")]
public async Task<ActionResult<DashboardViewModel>> GetDashboard(Guid orderId, CancellationToken ct)
{
    var order = await _orderClient.GetOrderAsync(orderId, ct);
    var pricing = await _pricingClient.GetPriceAsync(orderId, ct); // throws if pricing service is down
    var inventory = await _inventoryClient.GetStockAsync(orderId, ct); // never reached
    return Ok(new DashboardViewModel(order, pricing, inventory)); // entire request 500s
}
```

### GOOD — each section degrades independently with a per-section error flag

```csharp
[HttpGet("api/bff/dashboard/{orderId}")]
public async Task<ActionResult<DashboardViewModel>> GetDashboard(Guid orderId, CancellationToken ct)
{
    var order = await _orderClient.GetOrderAsync(orderId, ct); // core data — let this fail loudly

    var pricing = await TryGetAsync(() => _pricingClient.GetPriceAsync(orderId, ct));
    var inventory = await TryGetAsync(() => _inventoryClient.GetStockAsync(orderId, ct));

    return Ok(new DashboardViewModel
    {
        Order = order,
        Pricing = pricing.Value,
        PricingAvailable = pricing.Succeeded, // Angular renders a "unavailable" badge instead of a blank page
        Inventory = inventory.Value,
        InventoryAvailable = inventory.Succeeded
    });
}

private async Task<(bool Succeeded, T? Value)> TryGetAsync<T>(Func<Task<T>> call)
{
    try { return (true, await call()); }
    catch (Exception ex) { _logger.LogWarning(ex, "Non-critical BFF dependency failed"); return (false, default); }
}
```

---

## Check D — BFF reimplements business logic (BFF-004)

### Detection

Grep the BFF layer for domain rules — discount calculation, order-status transition rules,
eligibility checks — implemented directly in a BFF controller/service instead of calling
the domain API that owns that logic. Once the same rule exists in two places, they drift:
a bug fix or policy change applied to the domain service never reaches the BFF's copy, and
the system of record and the API the frontend actually talks to silently disagree.

### BAD — discount rule duplicated in the BFF

```csharp
[HttpGet("api/bff/orders/{orderId}/summary")]
public async Task<ActionResult<OrderSummary>> GetSummary(Guid orderId)
{
    var order = await _orderClient.GetOrderAsync(orderId);

    // business rule re-implemented here instead of asking the domain API
    var discount = order.CustomerTier == "Gold" ? 0.15m : order.CustomerTier == "Silver" ? 0.10m : 0m;
    var total = order.Subtotal * (1 - discount);

    return Ok(new OrderSummary(order.Id, total));
}
```

### GOOD — BFF delegates the rule to the domain/core API

```csharp
[HttpGet("api/bff/orders/{orderId}/summary")]
public async Task<ActionResult<OrderSummary>> GetSummary(Guid orderId)
{
    var pricedOrder = await _orderClient.GetPricedOrderAsync(orderId); // domain service owns discount rules
    return Ok(new OrderSummary(pricedOrder.Id, pricedOrder.Total)); // BFF only reshapes, never recomputes
}
```

---

## Check E — No BFF-specific caching/rate limiting (BFF-005)

### Detection

Grep BFF aggregation endpoints hit repeatedly from multiple Angular components within a
short window (a dashboard whose widgets each independently call the same aggregate
endpoint) with no output caching/response caching configured. Every widget re-triggers the
full downstream fan-out for data that hasn't changed since the last call a few hundred
milliseconds ago, multiplying load on the domain services for no benefit to the user.

### BAD — every widget call re-fetches and re-aggregates from scratch

```csharp
[HttpGet("api/bff/dashboard-summary")]
public async Task<ActionResult<DashboardSummary>> GetSummary(CancellationToken ct)
{
    // called independently by 4 different Angular widgets on the same page load
    var summary = await AggregateFromThreeDownstreamServices(ct); // no caching — 4x the downstream load
    return Ok(summary);
}
```

### GOOD — short-lived output cache tuned to the UI's actual refresh cadence

```csharp
builder.Services.AddOutputCache(o =>
{
    o.AddPolicy("dashboard-summary", p => p.Expire(TimeSpan.FromSeconds(10)).Tag("dashboard"));
});

app.MapGet("/api/bff/dashboard-summary", AggregateFromThreeDownstreamServices)
   .CacheOutput("dashboard-summary"); // widgets loading within the same 10s window share one aggregation
```
