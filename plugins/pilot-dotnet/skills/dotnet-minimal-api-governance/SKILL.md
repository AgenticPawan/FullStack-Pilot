---
name: dotnet-minimal-api-governance
description: Reviews Minimal APIs vs MVC Controllers usage. Flags no team convention for endpoint style, fat inline lambdas holding business logic, cross-cutting concerns re-implemented per endpoint instead of IEndpointFilter/route groups, missing typed results breaking OpenAPI, no MapGroup strategy, and no migration path between styles. Outputs pilot-dotnet minimal-api-governance standard IDs.
when_to_use: Minimal API, MapGet, MapPost, MapGroup, IEndpointFilter, TypedResults, Results<T1,T2>, Controller vs Minimal API, endpoint filter, route group, OpenAPI Minimal API, migrating to Minimal APIs, RequireAuthorization endpoint, mixing controllers and minimal apis
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| MAG-001 | P2 | No documented convention for which endpoint families use Minimal APIs vs Controllers |
| MAG-002 | P1 | Fat inline lambda handler containing business logic instead of delegating to a handler/mediator |
| MAG-003 | P1 | Cross-cutting concern (validation, auth, logging) re-implemented ad-hoc per endpoint instead of via `IEndpointFilter` / shared route-group configuration |
| MAG-004 | P2 | Endpoint missing typed results (`TypedResults` / `Results<T1,T2>`), producing an inaccurate or missing OpenAPI schema |
| MAG-005 | P2 | No consistent `MapGroup` strategy, causing duplicated route-prefix strings and per-endpoint configuration |
| MAG-006 | P1 | Controller-to-Minimal-API (or reverse) migration with no incremental strategy, breaking the API contract on switchover |

---

## Check A — No documented convention for Minimal API vs Controller usage (MAG-001)

### Detection

1. Check whether the repo has any written guidance (README, ADR, `docs/` file, or a comment
   block in `Program.cs`) stating which endpoint families use Minimal APIs and which use
   Controllers, and why (e.g., "CRUD resource APIs use Controllers for model binding/filter
   parity with existing infra; small, high-traffic read endpoints use Minimal APIs for
   allocation savings").
2. Grep the solution for both `[ApiController]` classes and `Map{Get,Post,Put,Delete}` calls.
   If both styles are present with no discoverable rationale, flag MAG-001 — new endpoints
   will keep being added in whichever style the last author happened to prefer, and reviewers
   have no criteria to push back with.

### BAD — both styles coexist with no stated rule

```csharp
// OrdersController.cs — MVC
[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase { ... }

// Program.cs — Minimal API, same solution, no comment explaining the split
app.MapGet("/api/invoices/{id:int}", async (int id, IInvoiceService svc) => ...);
app.MapPost("/api/customers", async (CustomerDto dto, ICustomerService svc) => ...);
// Nothing documents why Orders is a controller and Invoices/Customers are not.
```

### GOOD — documented convention, both styles used deliberately

```csharp
// docs/adr/0007-api-endpoint-style.md
// Decision: Controllers for resource-oriented CRUD APIs that need model-binding
// validation attributes and existing filter pipeline reuse. Minimal APIs for
// narrow, high-throughput read endpoints and internal/bff aggregation routes.

// Program.cs
// --- Minimal API surface: narrow, high-throughput reads (see ADR-0007) ---
app.MapGroup("/api/catalog")
   .MapCatalogEndpoints();

// Controllers still handle full CRUD resource areas (Orders, Invoices, Customers).
app.MapControllers();
```

---

## Check B — Fat inline lambda handlers with business logic (MAG-002)

### Detection

1. Grep `Map{Get,Post,Put,Delete,Patch}` lambda bodies for multi-step logic: multiple
   database calls, branching business rules, manual validation, or orchestration across
   more than one service — anything beyond "bind, delegate, map result."
2. This mirrors the dotnet-cqrs / dotnet-clean-architecture concern about handlers owning
   business logic — a Minimal API lambda is not exempt from that boundary just because it's
   inline. Flag MAG-002 when the lambda body exceeds a few lines of orchestration.

### BAD — business logic inlined directly in the route lambda

```csharp
app.MapPost("/api/orders/{id:int}/approve", async (int id, AppDbContext db, IEmailSender email) =>
{
    var order = await db.Orders.FindAsync(id);
    if (order is null) return Results.NotFound();
    if (order.Status != OrderStatus.PendingApproval) return Results.Conflict("Not pending");
    if (order.Total > 10_000m && !order.HasDualSignoff) return Results.BadRequest("Needs dual signoff");

    order.Status = OrderStatus.Approved;
    order.ApprovedAtUtc = DateTime.UtcNow;
    await db.SaveChangesAsync();
    await email.SendAsync(order.CustomerEmail, "Order approved", $"Order {id} approved");

    return Results.Ok();
});
```

### GOOD — lambda delegates to a handler/mediator, stays a thin adapter

```csharp
app.MapPost("/api/orders/{id:int}/approve", async (int id, ISender sender) =>
{
    var result = await sender.Send(new ApproveOrderCommand(id));
    return result.IsSuccess ? Results.Ok() : Results.BadRequest(result.Error);
});

// ApproveOrderCommandHandler.cs owns the business rules — ties to dotnet-cqrs
public class ApproveOrderCommandHandler : IRequestHandler<ApproveOrderCommand, Result>
{
    // dual-signoff rule, status transition, notification dispatch all live here
}
```

---

## Check C — Cross-cutting concerns re-implemented ad-hoc per endpoint (MAG-003)

### Detection

1. Grep Minimal API lambda bodies for repeated boilerplate: manual `if (!ModelState...)`-style
   validation calls, manual `User.HasClaim(...)` auth checks, or manual `_logger.LogInformation`
   calls copy-pasted into every handler.
2. If the same concern is hand-rolled in more than one endpoint instead of centralized via an
   `IEndpointFilter` or applied once at the route-group level (`.AddEndpointFilter<T>()`,
   `.RequireAuthorization()` on the group), flag MAG-003.

### BAD — validation and logging duplicated in every handler

```csharp
app.MapPost("/api/orders", async (CreateOrderDto dto, IOrderService svc, ILogger<Program> log) =>
{
    if (dto.Items.Count == 0) return Results.BadRequest("Items required");
    if (dto.CustomerId <= 0) return Results.BadRequest("Invalid customer");
    log.LogInformation("Creating order for customer {CustomerId}", dto.CustomerId);
    var id = await svc.CreateAsync(dto);
    return Results.Created($"/api/orders/{id}", id);
});

app.MapPost("/api/invoices", async (CreateInvoiceDto dto, IInvoiceService svc, ILogger<Program> log) =>
{
    if (dto.OrderId <= 0) return Results.BadRequest("Invalid order");
    log.LogInformation("Creating invoice for order {OrderId}", dto.OrderId); // same pattern, copy-pasted
    var id = await svc.CreateAsync(dto);
    return Results.Created($"/api/invoices/{id}", id);
});
```

### GOOD — shared endpoint filter for validation + logging, applied once at the group

```csharp
public class ValidationFilter<T> : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var arg = ctx.Arguments.OfType<T>().FirstOrDefault();
        var validator = ctx.HttpContext.RequestServices.GetRequiredService<IValidator<T>>();
        var result = await validator.ValidateAsync(arg!);
        if (!result.IsValid) return Results.ValidationProblem(result.ToDictionary());
        return await next(ctx);
    }
}

var orders = app.MapGroup("/api/orders")
    .AddEndpointFilter<RequestLoggingFilter>()
    .RequireAuthorization();

orders.MapPost("/", async (CreateOrderDto dto, IOrderService svc) =>
{
    var id = await svc.CreateAsync(dto);
    return Results.Created($"/api/orders/{id}", id);
})
.AddEndpointFilter<ValidationFilter<CreateOrderDto>>();
```

---

## Check D — Missing typed results breaks OpenAPI generation (MAG-004)

### Detection

1. Grep Minimal API handlers returning bare `Results.Ok(...)`, `Results.NotFound()`, or a
   mixed set of `IResult` return paths with no `TypedResults` / `Results<T1,T2,...>` signature.
2. Untyped `IResult` return types give Swashbuckle/NSwag/OpenAPI generation no compile-time
   information about the possible response shapes and status codes, so the generated client
   (see dotnet-nswag-codegen) is missing or wrong. Flag MAG-004.

### BAD — untyped IResult, OpenAPI can't infer response shapes

```csharp
app.MapGet("/api/orders/{id:int}", async (int id, IOrderService svc) =>
{
    var order = await svc.GetAsync(id);
    return order is null ? Results.NotFound() : Results.Ok(order); // return type is just IResult
});
```

### GOOD — typed results document every possible response

```csharp
app.MapGet("/api/orders/{id:int}", async Task<Results<Ok<OrderDto>, NotFound>> (int id, IOrderService svc) =>
{
    var order = await svc.GetAsync(id);
    return order is null
        ? TypedResults.NotFound()
        : TypedResults.Ok(order);
})
.WithName("GetOrderById")
.Produces<OrderDto>(StatusCodes.Status200OK)
.ProducesProblem(StatusCodes.Status404NotFound);
```

---

## Check E — No consistent MapGroup route-grouping strategy (MAG-005)

### Detection

1. Grep for repeated literal route prefixes (`"/api/orders/..."` typed out on every
   `MapGet`/`MapPost` call) instead of a single `MapGroup("/api/orders")` the individual
   endpoints hang off of.
2. If shared configuration (auth, versioning, filters, tags) is repeated on every individual
   endpoint instead of applied once to the group, flag MAG-005.

### BAD — route prefix and shared config repeated per endpoint

```csharp
app.MapGet("/api/orders", async (IOrderService svc) => ...).RequireAuthorization().WithTags("Orders");
app.MapGet("/api/orders/{id:int}", async (int id, IOrderService svc) => ...).RequireAuthorization().WithTags("Orders");
app.MapPost("/api/orders", async (CreateOrderDto dto, IOrderService svc) => ...).RequireAuthorization().WithTags("Orders");
app.MapDelete("/api/orders/{id:int}", async (int id, IOrderService svc) => ...).RequireAuthorization().WithTags("Orders");
```

### GOOD — one group owns the prefix and shared configuration

```csharp
var orders = app.MapGroup("/api/orders")
    .RequireAuthorization()
    .WithTags("Orders");

orders.MapGet("/", async (IOrderService svc) => ...);
orders.MapGet("/{id:int}", async (int id, IOrderService svc) => ...);
orders.MapPost("/", async (CreateOrderDto dto, IOrderService svc) => ...);
orders.MapDelete("/{id:int}", async (int id, IOrderService svc) => ...);
```

---

## Check F — Migrating between styles with no incremental strategy (MAG-006)

### Detection

1. When a PR converts an entire Controller to Minimal API endpoints (or the reverse) in one
   shot, check whether route templates, status codes, and response shapes are diffed against
   the previous contract (e.g., via a contract/snapshot test, or a side-by-side OpenAPI diff).
2. If the migration lands as a single big-bang cutover with no endpoint-by-endpoint
   verification and no versioned/parallel-run period, flag MAG-006 — clients calling the
   old shape can silently break (renamed route parameter, different casing, dropped header)
   with nothing catching the regression before it ships.

### BAD — big-bang rewrite, no contract verification

```csharp
// Whole OrdersController deleted and replaced by Minimal API endpoints in the same PR,
// with no OpenAPI diff, no contract test, and no staged rollout.
- [ApiController]
- [Route("api/orders")]
- public class OrdersController : ControllerBase { ... 8 actions ... }
+ app.MapGroup("/api/order")   // note: prefix silently changed from "orders" to "order"
+    .MapOrderEndpoints();
```

### GOOD — incremental migration with contract verification

```csharp
// Step 1: add Minimal API endpoints under a feature-flagged parallel route, controller stays live.
var ordersV2 = app.MapGroup("/api/orders").RequireAuthorization();
if (featureFlags.IsEnabled("MinimalApi.Orders"))
{
    ordersV2.MapOrdersEndpoints();
}

// Step 2: CI runs an OpenAPI diff between the old controller spec and the new group's spec,
// failing the build on any route, status code, or schema drift.

// Step 3: once parity is verified and traffic is shifted, remove OrdersController in a
// follow-up PR — never in the same commit that introduces the replacement.
```
