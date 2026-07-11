---
name: dotnet-middleware-pipeline
description: Reviews ASP.NET Core middleware ordering in Program.cs. Flags exception handler/HSTS registered too late, CORS after auth breaking Angular preflights, authorization before authentication, rate limiting after expensive work, static files before authentication, and no enforced ordering a refactor can't silently break. Outputs pilot-dotnet middleware-pipeline standard IDs.
when_to_use: middleware order, Program.cs pipeline, UseExceptionHandler, UseHsts, UseCors, UseAuthentication, UseAuthorization, UseRateLimiter, UseStaticFiles, middleware ordering, CORS preflight broken, pipeline misconfiguration
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| MWP-001 | P0 | Exception handler / HSTS registered too late — exceptions escape unhandled |
| MWP-002 | P0 | UseAuthorization() called before UseAuthentication() |
| MWP-003 | P1 | CORS registered after auth middleware, breaking credentialed/preflight requests |
| MWP-004 | P1 | Rate limiting placed after expensive work already executed |
| MWP-005 | P1 | Static files served before authentication, exposing protected assets |
| MWP-006 | P2 | No documented/enforced middleware order — future refactors can silently reorder it |

---

## Check A — Exception handler / HSTS registered too late (MWP-001)

### Detection

Grep `Program.cs` for `app.UseExceptionHandler(...)` and `app.UseHsts()` and check their
position relative to other middleware. Any middleware registered *before* the exception
handler that can throw (custom middleware doing header parsing, a tenant-resolution
middleware querying the DB) bypasses the handler entirely — the exception propagates to
the Kestrel default handler (or crashes the request with a raw 500 and stack trace in
non-Development environments), instead of the standardized `ProblemDetails` response.

### BAD — custom middleware runs before the exception handler is registered

```csharp
var app = builder.Build();

app.UseMiddleware<TenantResolutionMiddleware>(); // can throw (DB lookup) — no handler catches it yet
app.UseExceptionHandler("/error");               // registered too late
app.UseHsts();

app.UseRouting();
app.MapControllers();
app.Run();
```

### GOOD — exception handler and HSTS registered first, before anything that can throw

```csharp
var app = builder.Build();

app.UseExceptionHandler("/error"); // first — catches everything downstream
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

app.UseMiddleware<TenantResolutionMiddleware>(); // now protected by the exception handler
app.UseRouting();
app.UseCors("AngularClient");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.Run();
```

---

## Check B — UseAuthorization() before UseAuthentication() (MWP-002)

### Detection

Grep for the relative order of `app.UseAuthentication()` and `app.UseAuthorization()`.
Authorization middleware reads `HttpContext.User` (the `ClaimsPrincipal`) to evaluate
policies/roles — that principal is only populated by the authentication middleware running
first. If authorization runs first, every request is evaluated against an anonymous
principal, meaning `[Authorize]` either always fails or (worse, if a permissive policy
default exists) always passes without ever checking real claims.

### BAD — authorization registered before authentication

```csharp
app.UseRouting();
app.UseAuthorization();  // runs first — HttpContext.User is not yet populated
app.UseAuthentication(); // too late to affect the authorization decision already made
app.MapControllers();
```

### GOOD — authentication always precedes authorization

```csharp
app.UseRouting();
app.UseAuthentication(); // populates HttpContext.User from the bearer token/cookie
app.UseAuthorization();  // policies now evaluate against the real ClaimsPrincipal
app.MapControllers();
```

---

## Check C — CORS registered after auth middleware (MWP-003)

### Detection

Grep for `app.UseCors(...)` positioned after `app.UseAuthentication()`/
`app.UseAuthorization()`. The CORS preflight `OPTIONS` request carries no credentials/auth
header by design — if authentication middleware runs first and rejects/redirects
unauthenticated `OPTIONS` requests before CORS middleware ever adds the
`Access-Control-Allow-Origin` response headers, the Angular SPA's browser blocks the actual
follow-up request as a CORS failure, even though the API itself would have accepted it.

### BAD — CORS registered after authentication, preflight never gets CORS headers

```csharp
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.UseCors("AngularClient"); // too late — preflight OPTIONS already hit auth and got rejected
app.MapControllers();
```

### GOOD — CORS registered before authentication so preflight always succeeds

```csharp
app.UseRouting();
app.UseCors("AngularClient"); // handles preflight OPTIONS before any auth check
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
```

---

## Check D — Rate limiting placed after expensive work (MWP-004)

### Detection

Grep for `app.UseRateLimiter()` positioned after middleware/endpoints that already do
model binding, DB lookups, or business logic (i.e., placed close to `MapControllers()`
instead of near the top of the pipeline, or applied only inside a controller action after
the request body was already deserialized and validated). Rate limiting exists to protect
an expensive resource from overload — if the expensive work already ran before the limiter
rejects the request, the limiter provides no protection at all, it just adds overhead to
requests that are about to be thrown away anyway.

### BAD — rate limiter runs after routing/model binding already did the expensive work

```csharp
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers(); // model binding + business logic can execute here...
app.UseRateLimiter();  // ...before this middleware ever gets a chance to reject the request
```

### GOOD — rate limiter runs early, rejecting excess requests before any expensive work

```csharp
app.UseRouting();
app.UseRateLimiter(); // rejects over-limit requests immediately, before auth/model binding/business logic
app.UseCors("AngularClient");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers().RequireRateLimiting("api");
```

---

## Check E — Static files served before authentication (MWP-005)

### Detection

Grep for `app.UseStaticFiles()` positioned before `app.UseAuthentication()` when the static
file provider is configured against a directory containing protected assets (uploaded
documents, generated reports) rather than purely public SPA bundle files. Static file
middleware short-circuits the pipeline on a match — anything served by it never reaches the
authentication/authorization middleware that would otherwise gate it.

### BAD — protected uploads directory served before authentication runs

```csharp
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(Path.Combine(env.ContentRootPath, "protected-uploads")),
    RequestPath = "/files"
}); // registered before auth — anyone can GET /files/{doc} unauthenticated
app.UseAuthentication();
app.UseAuthorization();
```

### GOOD — protected files served from an authenticated endpoint, not raw static middleware

```csharp
app.UseStaticFiles(); // only serves the public wwwroot SPA bundle — safe before auth
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/files/{documentId}", async (Guid documentId, IFileStore store, ClaimsPrincipal user) =>
{
    if (!await store.UserCanAccessAsync(user, documentId)) return Results.Forbid();
    var stream = await store.OpenReadAsync(documentId);
    return Results.File(stream, "application/octet-stream");
}).RequireAuthorization(); // protected assets go through an authorized endpoint, never raw static middleware
```

---

## Check F — No enforced/documented middleware order (MWP-006)

### Detection

Check whether the pipeline construction lives inline in `Program.cs` with no extension
method encapsulating the required order, and whether any test asserts the order (e.g. an
integration test hitting an unauthenticated CORS preflight and an authorized endpoint to
confirm both behave correctly). Without either safeguard, a future PR adding "just one more
middleware" can insert it in the wrong position — auth before CORS, rate limiting after
routing — and nothing catches the regression until it reaches production.

### BAD — pipeline order is inline, undocumented, and untested

```csharp
var app = builder.Build();
app.UseExceptionHandler("/error");
app.UseRouting();
app.UseCors("AngularClient");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.Run();
// nothing prevents the next PR from adding app.UseAuthentication() twice or swapping CORS/auth order
```

### GOOD — pipeline order centralized in a single extension method with a comment contract, verified by a test

```csharp
public static class MiddlewarePipelineExtensions
{
    // Order is load-bearing — see dotnet-middleware-pipeline skill for why each position matters.
    // 1. Exception handling / HSTS  2. Routing  3. CORS  4. Rate limiting
    // 5. Authentication  6. Authorization  7. Endpoints
    public static WebApplication UseStandardPipeline(this WebApplication app)
    {
        app.UseExceptionHandler("/error");
        if (!app.Environment.IsDevelopment()) app.UseHsts();

        app.UseRouting();
        app.UseCors("AngularClient");
        app.UseRateLimiter();
        app.UseAuthentication();
        app.UseAuthorization();

        return app;
    }
}

// Program.cs
app.UseStandardPipeline();
app.MapControllers();
app.Run();

// Integration test asserts the contract holds:
// [Fact] public async Task PreflightRequest_SucceedsWithoutAuth() { ... }
```
