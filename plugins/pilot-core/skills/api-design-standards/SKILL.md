---
name: api-design-standards
description: Reviews the cross-cutting REST contract tying dotnet-api-pagination, dotnet-error-handling, and dotnet-api-versioning to angular-api-client-codegen's generated client. Flags inconsistent resource naming, pagination shape differing per endpoint, error bodies not following ProblemDetails, no versioning strategy tied to client regeneration, and misused HTTP status codes. Outputs pilot-core api-design-standards standard IDs.
when_to_use: API contract, resource naming convention, REST endpoint naming, pagination envelope, paged response shape, ProblemDetails consistency, API versioning strategy, NSwag client regeneration, HTTP status code misuse, frontend backend contract drift, shared API convention
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| API-001 | P1 | Inconsistent resource naming across endpoints |
| API-002 | P1 | Pagination response shape differs between endpoints |
| API-003 | P0 | Error response bodies don't consistently follow the ProblemDetails shape |
| API-004 | P1 | No documented API versioning strategy tied to client regeneration cadence |
| API-005 | P1 | HTTP status codes misused for success/error signaling |

Four other skills each own one side of this contract in isolation: `dotnet-api-pagination`
(backend paging mechanics), `dotnet-error-handling` (backend ProblemDetails shape),
`dotnet-api-versioning` (backend versioning mechanics), and `angular-api-client-codegen`
(NSwag-generated frontend client). None of them checks that the two sides actually agree
with each other — that's this skill's job: the shared contract layer above all four.

---

## Check A — Inconsistent resource naming (API-001)

### Detection

Scan controller route attributes for a consistent noun-based, pluralized resource-naming
convention. Verb-based URLs (`/getOrders`, `/createOrder`) mixed with proper REST nouns
(`/orders`), or inconsistent singular/plural naming, signal no shared convention was ever
agreed — and the inconsistency propagates directly into the NSwag-generated Angular client
(`angular-api-client-codegen`), where operation names and route shapes become unpredictable
per feature.

### BAD — verb-based and noun-based routing mixed with no convention

```csharp
[HttpGet("getOrders")]
public IActionResult GetOrders() { ... }

[HttpGet("customer/{id}")]      // singular here...
public IActionResult GetCustomer(int id) { ... }

[HttpGet("products")]           // ...plural here, no stated rule either way
public IActionResult GetProducts() { ... }
```

### GOOD — consistent noun-based, pluralized resource naming

```csharp
[HttpGet("orders")]
public IActionResult GetOrders() { ... }

[HttpGet("customers/{id}")]
public IActionResult GetCustomer(int id) { ... }

[HttpGet("products")]
public IActionResult GetProducts() { ... }
```

```
<!-- docs/API-CONVENTIONS.md -->
All resource routes are plural nouns (/orders, /customers), never verbs. Non-CRUD actions
(e.g. "approve an order") use a sub-resource noun: POST /orders/{id}/approval, not
POST /approveOrder.
```

---

## Check B — Pagination shape differs between endpoints (API-002)

### Detection

Compare paginated endpoints' response shapes against `dotnet-api-pagination`'s established
envelope. If one endpoint returns `{ items, total, page, pageSize }` and another returns a
bare array with an `X-Total-Count` header, the NSwag-generated Angular client
(`angular-api-client-codegen`) produces a different generated model per endpoint, forcing
every consuming component to special-case how it reads "how many total records exist"
instead of using one shared `PagedResult<T>` type across the whole app.

### BAD — two paginated endpoints, two incompatible shapes

```csharp
// OrdersController — matches dotnet-api-pagination's envelope
[HttpGet("orders")]
public PagedResult<OrderDto> GetOrders(int page, int pageSize) { ... }

// ProductsController — bare array + header instead
[HttpGet("products")]
public IActionResult GetProducts(int page, int pageSize)
{
    Response.Headers["X-Total-Count"] = total.ToString();
    return Ok(products);   // just an array — no page/pageSize/total in the body at all
}
```

### GOOD — every paginated endpoint returns the same shared envelope

```csharp
public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

[HttpGet("products")]
public PagedResult<ProductDto> GetProducts(int page, int pageSize) { ... }
// The NSwag-generated client now exposes one shared PagedResultOfProductDto model,
// consumed identically by every feature's data table (see angular-shared-libraries).
```

---

## Check C — Error bodies don't consistently follow ProblemDetails (API-003)

### Detection

Check that every endpoint's error responses — validation failures, not-found, unhandled
exceptions — return the RFC 7807 ProblemDetails shape established by
`dotnet-error-handling`, not a bespoke ad-hoc error object. The Angular side's global error
interceptor (`angular-error-handling`) is written once against the ProblemDetails shape; an
endpoint that returns a different shape breaks that generic handling silently, and the
user sees a raw/blank error instead of the intended message.

### BAD — one controller returns a custom error shape instead of ProblemDetails

```csharp
[HttpPost("orders")]
public IActionResult CreateOrder(CreateOrderRequest request)
{
    if (!ModelState.IsValid)
        return BadRequest(new { error = "Invalid request", fields = ModelState.Keys });
        // Custom shape — the Angular interceptor expects `.title`/`.errors`, gets undefined.
    ...
}
```

### GOOD — every error path returns the shared ProblemDetails shape

```csharp
[HttpPost("orders")]
public IActionResult CreateOrder(CreateOrderRequest request)
{
    if (!ModelState.IsValid)
        return ValidationProblem(ModelState);   // standard ASP.NET Core ProblemDetails
    ...
}
// angular-error-handling's interceptor now works for every endpoint because the
// { type, title, status, detail, errors } shape is guaranteed consistent.
```

---

## Check D — No versioning strategy tied to client regeneration (API-004)

### Detection

Check whether the backend's versioning policy (`dotnet-api-versioning`) is connected to a
trigger that regenerates the Angular NSwag client (`angular-api-client-codegen`). Without
one, the two drift apart silently — the frontend keeps calling the old version, or breaks
against a contract change, with no one noticing until a runtime failure.

### BAD — backend versions bump freely; nothing regenerates the frontend client

```csharp
[ApiVersion("2.0")]
[HttpGet("orders")]
public PagedResult<OrderDtoV2> GetOrders() { ... }
// Shipped. nswag.json still points at v1's spec URL; no CI step regenerates the client;
// no one on the frontend team was told a v2 exists.
```

### GOOD — a documented policy and a CI check tying version bumps to client regen

```
<!-- docs/API-CONVENTIONS.md: Versioning <-> client regeneration policy -->
Any API version bump (dotnet-api-versioning) must be accompanied, in the same PR or a
same-day follow-up, by regenerating the Angular client against the new spec URL
(nswag.json updated, npm run generate:api-client re-run and diffed).
```

```yaml
# .github/workflows/api-contract-check.yml
- run: dotnet run --project Api -- --generate-openapi-spec > openapi-current.json
- run: diff openapi-current.json openapi-checked-in.json
  # Fails CI if the live spec has drifted from what the checked-in Angular client
  # was generated against — forces a client regen before merge.
```

---

## Check E — HTTP status codes misused (API-005)

### Detection

Check for endpoints returning a status code that doesn't match the actual outcome — most
commonly `200 OK` wrapping an error payload, or a generic `500` for a client-side
validation failure that should be `400`. Frontend logic that branches on status code
(`angular-http-resilience` retries, the `angular-error-handling` interceptor) breaks the
moment a status code lies about what actually happened.

### BAD — 200 OK returned alongside an error payload; a 500 used for bad input

```csharp
[HttpPost("orders")]
public IActionResult CreateOrder(CreateOrderRequest request)
{
    if (request.Quantity <= 0)
        return Ok(new { success = false, message = "Quantity must be positive" });
        // 200 OK — the Angular http-resilience retry/error logic sees "success" and moves on.

    try { ... }
    catch (Exception ex)
    {
        return StatusCode(500, ex.Message);   // a bad quantity isn't a server fault — it's 400.
    }
}
```

### GOOD — status codes accurately reflect the outcome

```csharp
[HttpPost("orders")]
public IActionResult CreateOrder(CreateOrderRequest request)
{
    if (request.Quantity <= 0)
        return ValidationProblem("Quantity must be positive");   // 400

    try { ... }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Unexpected error creating order");
        return Problem(statusCode: 500);   // reserved for genuine server-side failures
    }
}
```
