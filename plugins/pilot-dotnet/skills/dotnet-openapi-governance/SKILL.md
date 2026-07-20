---
name: dotnet-openapi-governance
description: "Audits and generates versioned OpenAPI specs in ASP.NET Core: spec format, ProblemDetails response types on error routes, versioned document endpoints, Swashbuckle/NSwag configuration, security scheme declarations (Bearer/OAuth2), XML doc comment wiring, and breaking-change awareness. Aligns with API versioning conventions from dotnet-api-versioning."
when_to_use: openapi, swagger, nswag, swashbuckle, api spec, versioned spec, problem details, breaking change, api document, openapi json, bearer scheme, security scheme, xml documentation, api contract
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| OAS-001 | P0 | Error response routes (4xx/5xx) missing `ProblemDetails` response-type declaration |
| OAS-002 | P1 | OpenAPI document endpoint not versioned (single document covers all API versions) |
| OAS-003 | P1 | Security scheme (Bearer/OAuth2) not declared in the OpenAPI document |
| OAS-004 | P2 | Controller/endpoint missing XML summary comment (`<summary>`) for doc generation |
| OAS-005 | P2 | Breaking-change indicator: a path or response property removed between spec versions |

---

## Check A — ProblemDetails on error routes

### Detection

1. Locate all Minimal API `app.Map*` or controller `[Http*]` endpoints.
2. For each, check whether the `ProducesResponseType` / `Produces` attribute or `.Produces()`
   chain includes a 400 and/or 500 type mapped to `ProblemDetails` or a derived type.

### BAD

```csharp
app.MapPost("/orders", CreateOrder)
   .Produces<OrderDto>(201);      // no error response types declared
```

### GOOD

```csharp
app.MapPost("/orders", CreateOrder)
   .Produces<OrderDto>(201)
   .ProducesValidationProblem()
   .ProducesProblem(StatusCodes.Status500InternalServerError);
```

---

## Check B — Security scheme declaration

### Detection

Search for `AddSwaggerGen` or `AddOpenApi` registration. Verify a `SecurityDefinition`
for `Bearer` (JWT) or an OAuth2/OIDC flow is registered and referenced on all non-public
endpoints via `AddSecurityRequirement`.

### BAD

```csharp
builder.Services.AddSwaggerGen(); // no security scheme
```

### GOOD

```csharp
builder.Services.AddSwaggerGen(c =>
{
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT"
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        [new OpenApiSecurityScheme { Reference = new OpenApiReference
            { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }] = Array.Empty<string>()
    });
});
```

---

## Check C — Versioned OpenAPI documents

Each API version defined via `Asp.Versioning` must have its own OpenAPI document endpoint
(e.g. `/swagger/v1/swagger.json`, `/swagger/v2/swagger.json`). A single document for all
versions is OAS-002.

### GOOD pattern (Swashbuckle + Asp.Versioning)

```csharp
foreach (var desc in apiVersionDescProvider.ApiVersionDescriptions)
    c.SwaggerEndpoint($"/swagger/{desc.GroupName}/swagger.json", desc.GroupName);
```

---

## Breaking-change checklist

Run whenever an endpoint, DTO property, or status code is removed or renamed:

- [ ] Removed path → add deprecation notice to previous version, not removal from current
- [ ] Renamed DTO property → add `[JsonPropertyName("old_name")]` bridge for one version
- [ ] Changed status code → update `ProducesResponseType` on both versions
- [ ] Removed required field → bump major API version
