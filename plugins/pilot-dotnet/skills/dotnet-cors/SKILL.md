---
name: dotnet-cors
description: Hardens ASP.NET Core CORS configuration. Flags AllowAnyOrigin combined with AllowCredentials, wildcard origins used in a production policy instead of a configuration-sourced allow-list, a single global default policy instead of named per-environment policies, missing WithExposedHeaders when the SPA must read custom response headers, and no preflight cache duration causing excess OPTIONS round-trips.
when_to_use: CORS configuration, AllowAnyOrigin, AllowCredentials, CORS policy, wildcard origin, allow-list, named CORS policy, WithExposedHeaders, preflight, SetPreflightMaxAge, OPTIONS request, cross-origin, SPA backend CORS
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| COR-001 | P0 | `AllowAnyOrigin()` combined with `AllowCredentials()` |
| COR-002 | P1 | Wildcard origin used in a production-configured CORS policy instead of a config-sourced allow-list |
| COR-003 | P2 | Single default CORS policy applied globally instead of named per-environment policies |
| COR-004 | P3 | Missing `WithExposedHeaders` when the SPA needs custom response headers |
| COR-005 | P3 | No preflight cache duration set (`SetPreflightMaxAge`), causing excess OPTIONS round-trips |

---

## Check A — AllowAnyOrigin + AllowCredentials

### Detection

1. Search `Program.cs`/`Startup.cs` CORS policy builders for both `.AllowAnyOrigin()` and `.AllowCredentials()` in the same policy chain.
2. This combination either throws `InvalidOperationException` at runtime, or — if someone works around it by reflecting a request's `Origin` header back verbatim — effectively allows any site to make credentialed requests. Flag COR-001 regardless of which failure mode is present.

### BAD — invalid/dangerous combination

```csharp
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials(); // throws at runtime, or if "fixed" by echoing Origin, leaks credentials to any site
    });
});
```

### GOOD — explicit allow-list required to combine with credentials

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("Spa", policy =>
    {
        policy.WithOrigins("https://app.contoso.com")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});
```

---

## Check B — Wildcard origins in production policy

### Detection

1. Check whether the CORS policy used in the `Production` environment reads origins from `IConfiguration` (e.g., `builder.Configuration["Cors:AllowedOrigins"]`) or hard-codes `AllowAnyOrigin()`.
2. If the same policy object is registered for all environments (no `env.IsDevelopment()` branch) and uses `AllowAnyOrigin()`, flag COR-002.

### BAD — wildcard origin shipped to production

```csharp
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});
```

### GOOD — allow-list sourced from configuration per environment

```csharp
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? Array.Empty<string>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Spa", policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});
```

```json
// appsettings.Production.json
{
  "Cors": {
    "AllowedOrigins": ["https://app.contoso.com"]
  }
}
```

---

## Check C — Single global policy vs named per-environment policies

### Detection

1. Search for `AddDefaultPolicy` usage applied unconditionally via `app.UseCors()` with no policy name argument.
2. If the same permissive policy is active in both Development and Production (no `AddPolicy("DevPermissive", ...)` / `AddPolicy("ProdStrict", ...)` split selected by `env.EnvironmentName`), flag COR-003.

### BAD — one policy for every environment

```csharp
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
    });
});

var app = builder.Build();
app.UseCors(); // same permissive policy in dev and prod
```

### GOOD — named policies selected per environment

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("DevPermissive", policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());

    options.AddPolicy("ProdStrict", policy =>
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod());
});

var app = builder.Build();
app.UseCors(app.Environment.IsDevelopment() ? "DevPermissive" : "ProdStrict");
```

---

## Check D — Missing WithExposedHeaders

### Detection

1. Check whether API responses set custom headers the SPA is expected to read via JavaScript (e.g., `X-Total-Count`, `X-Pagination-NextPage`, `X-Correlation-Id`).
2. If the CORS policy does not call `.WithExposedHeaders(...)` for those headers, the browser's `fetch`/`XMLHttpRequest` will silently hide them from client-side code even though the response contains them. Flag COR-004.

### BAD — custom pagination header set by the API but not exposed via CORS

```csharp
[HttpGet]
public IActionResult GetOrders([FromQuery] int page)
{
    var (orders, totalCount) = _orderService.GetPage(page);
    Response.Headers.Append("X-Total-Count", totalCount.ToString());
    return Ok(orders);
}

builder.Services.AddCors(options =>
{
    options.AddPolicy("Spa", policy =>
        policy.WithOrigins("https://app.contoso.com").AllowAnyHeader().AllowAnyMethod());
    // Missing WithExposedHeaders — the SPA's JS cannot read X-Total-Count.
});
```

### GOOD — header explicitly exposed to cross-origin JavaScript

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("Spa", policy =>
        policy.WithOrigins("https://app.contoso.com")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .WithExposedHeaders("X-Total-Count", "X-Correlation-Id"));
});
```

---

## Check E — No preflight cache duration

### Detection

1. Check the CORS policy for `.SetPreflightMaxAge(...)`.
2. If absent, browsers re-issue an `OPTIONS` preflight request before every non-simple cross-origin request (any request with custom headers, `PUT`/`DELETE`/`PATCH`, or `Content-Type: application/json`), adding latency on every call. Flag COR-005.

### BAD — no preflight caching, every request pays a round-trip

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("Spa", policy =>
        policy.WithOrigins("https://app.contoso.com")
              .AllowAnyHeader()
              .AllowAnyMethod());
    // No SetPreflightMaxAge — browser re-sends OPTIONS before every request.
});
```

### GOOD — preflight responses cached by the browser for a reasonable window

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("Spa", policy =>
        policy.WithOrigins("https://app.contoso.com")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .SetPreflightMaxAge(TimeSpan.FromMinutes(10)));
});
```
