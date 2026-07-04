---
name: dotnet-error-handling
description: Reviews ASP.NET Core error-handling architecture. Flags missing centralized exception-handling middleware (IExceptionHandler), error responses that don't follow the RFC 7807 ProblemDetails shape, exception detail (stack traces, messages) leaked to clients in production, and business/domain-rule failures thrown as generic exceptions instead of typed domain exceptions mapped to specific ProblemDetails types. Outputs findings with pilot-dotnet error-handling standard IDs.
when_to_use: exception handling, IExceptionHandler, ProblemDetails, RFC 7807, global exception middleware, UseExceptionHandler, error response shape, stack trace leak, domain exception, business rule exception, error contract
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ERR-001 | P0 | No centralized exception-handling middleware (`IExceptionHandler`) |
| ERR-002 | P0 | Error responses don't follow RFC 7807 `ProblemDetails` |
| ERR-003 | P1 | Exception detail leaked to the client in production |
| ERR-004 | P2 | Business-rule failures thrown as generic exceptions instead of typed domain exceptions |

---

## Check A — No centralized exception-handling middleware (ERR-001)

### Detection

Grep for `try`/`catch` blocks repeated in every controller/endpoint instead of one
`IExceptionHandler` (.NET 8+) or `UseExceptionHandler` middleware registered once at the
composition root. Per-endpoint try/catch means every new endpoint has to remember to
replicate the same error-shape logic, and inevitably some don't.

### BAD — every controller catches and formats errors itself

```csharp
[HttpPost]
public async Task<IActionResult> Create(CreateOrderDto dto)
{
    try
    {
        var order = await _orderService.CreateAsync(dto);
        return Ok(order);
    }
    catch (Exception ex)
    {
        return StatusCode(500, new { error = ex.Message }); // ad-hoc shape, duplicated everywhere
    }
}
```

### GOOD — one IExceptionHandler for the whole API

```csharp
public class GlobalExceptionHandler : IExceptionHandler
{
    private readonly ILogger<GlobalExceptionHandler> _logger;

    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken ct)
    {
        _logger.LogError(exception, "Unhandled exception");

        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status500InternalServerError,
            Title = "An unexpected error occurred.",
            Extensions = { ["correlationId"] = httpContext.Items["CorrelationId"] }
        };

        httpContext.Response.StatusCode = problem.Status.Value;
        await httpContext.Response.WriteAsJsonAsync(problem, ct);
        return true;
    }
}

// Program.cs
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddProblemDetails();
// ...
app.UseExceptionHandler();
```

---

## Check B — Error responses don't follow ProblemDetails (ERR-002)

### Detection

Grep error responses across controllers/minimal APIs for ad-hoc JSON shapes
(`{ error: "..." }`, `{ message: "...", code: 123 }`) instead of the standard
`ProblemDetails`/`ValidationProblemDetails` shape. Every endpoint inventing its own error
contract forces every client integration to special-case each one.

### BAD — inconsistent per-endpoint error shape

```csharp
return NotFound(new { message = "Order not found" });      // controller A
return BadRequest(new { error = "Invalid state", code = 42 }); // controller B — different shape entirely
```

### GOOD — one shape everywhere via ProblemDetails

```csharp
return Results.Problem(
    statusCode: StatusCodes.Status404NotFound,
    title: "Order not found",
    type: "https://errors.example.com/orders/not-found");

// Program.cs — ensures unhandled exceptions and validation failures share this shape too
builder.Services.AddProblemDetails();
```

---

## Check C — Exception detail leaked to the client (ERR-003)

### Detection

Check the exception-handling middleware/`IExceptionHandler` for whether it includes the raw
exception message or stack trace in the response body outside of `Development`. Stack
traces reveal internal file paths, package versions, and sometimes connection strings in
exception messages — an information-disclosure risk (OWASP A05:2021 Security
Misconfiguration).

### BAD — exception message returned directly to the client

```csharp
var problem = new ProblemDetails
{
    Title = exception.Message,        // may contain internal details (SQL text, file paths)
    Detail = exception.StackTrace,    // never send a stack trace to a client
};
```

### GOOD — environment-gated detail, generic message + correlation ID otherwise

```csharp
var problem = new ProblemDetails
{
    Status = StatusCodes.Status500InternalServerError,
    Title = "An unexpected error occurred.",
    Detail = env.IsDevelopment() ? exception.ToString() : null,
    Extensions = { ["correlationId"] = correlationId } // support can look up the real error by this
};
```

---

## Check D — Business-rule failures thrown as generic exceptions (ERR-004)

### Detection

Grep the Application/Domain layer for `throw new Exception(...)` or
`throw new InvalidOperationException(...)` used to signal an expected business-rule
violation (insufficient stock, invalid state transition, duplicate email) rather than a
typed domain exception the exception handler can map to a specific `ProblemDetails` type
and status code (409/422 instead of a generic 500).

### BAD — business rule violation looks like an unexpected crash

```csharp
public async Task ApproveAsync(Order order)
{
    if (order.Status != OrderStatus.Pending)
        throw new InvalidOperationException("Order is not pending"); // maps to a 500 — it's not a bug
}
```

### GOOD — typed domain exception mapped to the right status/ProblemDetails type

```csharp
public class OrderNotPendingException : DomainException
{
    public OrderNotPendingException(Guid orderId)
        : base($"Order {orderId} is not in a pending state.") { }
}

public async Task ApproveAsync(Order order)
{
    if (order.Status != OrderStatus.Pending)
        throw new OrderNotPendingException(order.Id);
}

// GlobalExceptionHandler.cs
public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception exception, CancellationToken ct)
{
    if (exception is DomainException domainEx)
    {
        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status409Conflict,
            Title = domainEx.Message,
            Type = "https://errors.example.com/domain-rule-violation"
        };
        ctx.Response.StatusCode = problem.Status.Value;
        await ctx.Response.WriteAsJsonAsync(problem, ct);
        return true;
    }
    // ...fall through to the generic 500 handling from Check A/C
    return false;
}
```
