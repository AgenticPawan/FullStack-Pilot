---
name: dotnet-api-versioning
description: Reviews ASP.NET Core API versioning setup. Flags missing Asp.Versioning wiring (endpoints versioned only by folder/route convention), a version reader limited to the URL segment with no header/query fallback, breaking changes made in-place to an existing version's contract instead of introducing a new version, missing deprecation/sunset signaling on superseded versions, and Swagger/OpenAPI docs not grouped per version. Outputs findings with pilot-dotnet api-versioning standard IDs.
when_to_use: API versioning, Asp.Versioning, AddApiVersioning, ApiVersionReader, MapToApiVersion, breaking change, deprecated API version, sunset header, versioned Swagger, versioned OpenAPI, v1 v2 endpoint, ReportApiVersions
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| AV-001 | P1 | No `Asp.Versioning.*` package / `AddApiVersioning()` wired — versioning is convention-only |
| AV-002 | P2 | Version read only from the URL segment with no header/query-string fallback |
| AV-003 | P1 | Breaking change applied in-place to an existing version's DTO/contract |
| AV-004 | P2 | No deprecation policy — superseded version has no `Deprecated = true` / sunset header |
| AV-005 | P3 | Swagger/OpenAPI generation not grouped per API version (advisory) |

---

## Check A — No enforced versioning (AV-001)

### Detection

1. Check the API project's `.csproj` for `Asp.Versioning.Mvc` / `Asp.Versioning.Http` (minimal APIs), and `Program.cs` for `AddApiVersioning()`.
2. If versioning exists only as a route-string convention (`api/v1/orders` hardcoded per controller) with no `IApiVersionReader`/negotiation, a client can't discover supported versions and the server can't enforce a default or reject unsupported ones.

### BAD — versioning by folder/route-string convention only

```csharp
[ApiController]
[Route("api/v1/orders")]
public class OrdersV1Controller : ControllerBase { ... }

[ApiController]
[Route("api/v2/orders")]
public class OrdersV2Controller : ControllerBase { ... }
// No AddApiVersioning() — "v1"/"v2" are just route text, not negotiated versions.
```

### GOOD — Asp.Versioning wired with a version set

```csharp
builder.Services.AddApiVersioning(options =>
{
    options.DefaultApiVersion = new ApiVersion(1, 0);
    options.AssumeDefaultVersionWhenUnspecified = true;
    options.ReportApiVersions = true;
}).AddApiExplorer(options =>
{
    options.GroupNameFormat = "'v'VVV";
    options.SubstituteApiVersionInUrl = true;
});

[ApiController]
[Route("api/v{version:apiVersion}/orders")]
[ApiVersion("1.0")]
[ApiVersion("2.0")]
public class OrdersController : ControllerBase
{
    [MapToApiVersion("2.0")]
    [HttpGet]
    public async Task<ActionResult<OrderDtoV2>> GetV2() => ...
}
```

---

## Check B — Version reader limited to URL segment (AV-002)

### Detection

Check the `AddApiVersioning` options for `ApiVersionReader`. If unset (URL-segment-only default) or explicitly `new UrlSegmentApiVersionReader()` with no combination, a caller that can't rewrite its base path (some API gateways, generated SDKs pinned to headers) has no alternative negotiation path.

### BAD — URL segment only

```csharp
builder.Services.AddApiVersioning(); // defaults to URL-segment reader only
```

### GOOD — combined header/query/URL negotiation

```csharp
builder.Services.AddApiVersioning(options =>
{
    options.ApiVersionReader = ApiVersionReader.Combine(
        new UrlSegmentApiVersionReader(),
        new HeaderApiVersionReader("Api-Version"),
        new QueryStringApiVersionReader("api-version"));
});
```

---

## Check C — Breaking change made in-place (AV-003)

### Detection

1. Diff a DTO/contract used by an already-shipped API version for a removed field, renamed field, changed type, or changed validation that a consuming client already depends on.
2. Additive changes (new optional field) are not a finding. Removing/renaming/retyping a field on a version already in use by external/mobile/partner clients is a breaking change and must land as a new `[ApiVersion]`, not an edit to the existing one.

### BAD — v1 contract changed in place

```csharp
// v1.0 OrderDto originally had `decimal Total`
public class OrderDto
{
    public decimal TotalAmount { get; set; } // renamed in place — breaks every v1.0 client
}
```

### GOOD — new version introduced, old version untouched

```csharp
[MapToApiVersion("1.0")]
[HttpGet]
public async Task<ActionResult<OrderDtoV1>> GetV1() => ...; // unchanged contract

[MapToApiVersion("2.0")]
[HttpGet]
public async Task<ActionResult<OrderDtoV2>> GetV2() => ...; // TotalAmount lives only here
```

---

## Check D — No deprecation signaling (AV-004)

### Detection

Once a newer version ships, check whether the superseded `[ApiVersion("1.0")]` declares `Deprecated = true` and whether responses carry a `Sunset`/`Deprecation` header so clients get advance notice before removal.

### BAD — old version silently kept with no deprecation signal

```csharp
[ApiVersion("1.0")]
[ApiVersion("2.0")]
public class OrdersController : ControllerBase { ... }
```

### GOOD — deprecated version flagged with a sunset header

```csharp
[ApiVersion("1.0", Deprecated = true)]
[ApiVersion("2.0")]
public class OrdersController : ControllerBase { ... }

// middleware adds: Sunset: Sat, 31 Jan 2026 00:00:00 GMT  and  Deprecation: true
```

---

## Check E — Swagger/OpenAPI not grouped per version (AV-005, advisory)

### Detection

Confirm `IConfigureOptions<SwaggerGenOptions>` (or the OpenAPI equivalent) generates one document per discovered `ApiVersionDescription` instead of a single flattened doc that mixes all versions' operations together, which makes it impossible for consumers to browse "just v2."
