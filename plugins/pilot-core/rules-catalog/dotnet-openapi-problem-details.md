---
id: dotnet-openapi-problem-details
title: OpenAPI — Declare ProblemDetails on All Error Response Routes
appliesTo: dotnet
severity: warn
standard: RFC-9457
---

Every ASP.NET Core endpoint or controller action that can return a 4xx or 5xx status
MUST declare a `ProblemDetails`-typed response in its OpenAPI metadata. Undeclared error
responses make API clients unable to deserialize error payloads and break SDK generation.

**BAD**
```csharp
app.MapPost("/invoices", CreateInvoice)
   .Produces<InvoiceDto>(201);  // 400/500 paths undeclared
```

**GOOD**
```csharp
app.MapPost("/invoices", CreateInvoice)
   .Produces<InvoiceDto>(201)
   .ProducesValidationProblem()           // 400
   .ProducesProblem(StatusCodes.Status500InternalServerError);
```

For controllers, apply `[ProducesResponseType(typeof(ProblemDetails), 400)]` at the
controller level and `[ProducesResponseType(typeof(ProblemDetails), 500)]` at the global
filter level to avoid per-action repetition.
