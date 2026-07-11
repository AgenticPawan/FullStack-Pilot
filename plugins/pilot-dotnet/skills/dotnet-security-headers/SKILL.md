---
name: dotnet-security-headers
description: Hardens ASP.NET Core HTTP response security headers and request-binding safety. Flags missing HSTS/Strict-Transport-Security, missing X-Content-Type-Options, missing clickjacking protection (X-Frame-Options/frame-ancestors), anti-forgery/CSRF tokens absent on cookie-authenticated state-changing endpoints, permissive polymorphic JSON deserialization of untrusted input, and request models bound directly to EF entities (mass-assignment/over-posting).
when_to_use: security headers, HSTS, Strict-Transport-Security, X-Content-Type-Options, nosniff, X-Frame-Options, frame-ancestors, clickjacking, anti-forgery, antiforgery, CSRF token, XSRF-TOKEN, JSON deserialization, TypeNameHandling, polymorphic deserialization, mass assignment, over-posting, bind to entity, insecure deserialization
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| SECH-001 | P1 | No `UseHsts()` / `Strict-Transport-Security` header in production |
| SECH-002 | P2 | No `X-Content-Type-Options: nosniff` |
| SECH-003 | P1 | No clickjacking protection — missing `X-Frame-Options` or CSP `frame-ancestors` |
| SECH-004 | P0 | Cookie-authenticated state-changing endpoint has no anti-forgery token validation |
| SECH-005 | P0 | Permissive polymorphic JSON deserialization (`TypeNameHandling.Auto`/`All`) of untrusted input |
| SECH-006 | P1 | Request model binds directly to an EF entity instead of a dedicated DTO (mass-assignment/over-posting) |

This skill governs response-header hardening and request-binding safety — distinct from
`dotnet-authentication` (login/token issuance), `dotnet-authorization` (permission checks),
and `dotnet-cors` (cross-origin policy). `angular-csrf-dotnet` (pilot-angular) is the client
side of SECH-004; both must agree on cookie/header names.

---

## Check A — Missing HSTS (SECH-001)

### Detection

1. Check `Program.cs` for `app.UseHsts()` in the non-development branch.
2. Missing HSTS means a client that reaches the site over plain HTTP once (e.g. a typo'd
   bookmark, a stale link) is never told to upgrade future requests, leaving a downgrade
   window for a network attacker to intercept.

### BAD — no HSTS in the production pipeline

```csharp
var app = builder.Build();
app.UseHttpsRedirection();
app.MapControllers();
app.Run();
```

### GOOD — HSTS enabled outside Development

```csharp
var app = builder.Build();
if (!app.Environment.IsDevelopment())
{
    app.UseHsts(); // adds Strict-Transport-Security; browsers cache the upgrade
}
app.UseHttpsRedirection();
app.MapControllers();
app.Run();
```

---

## Check B — Missing X-Content-Type-Options (SECH-002)

### Detection

Check for a middleware or `UseSecurityHeaders`-style extension setting
`X-Content-Type-Options: nosniff`. Without it, a browser may MIME-sniff a response body
and execute it as a different content type than declared (e.g. treating a JSON error body
containing HTML as `text/html`), enabling reflected-content attacks.

### BAD — no header, browser free to MIME-sniff

```csharp
var app = builder.Build();
app.MapControllers();
```

### GOOD — nosniff set for every response

```csharp
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.Append("X-Content-Type-Options", "nosniff");
    await next();
});
```

---

## Check C — No clickjacking protection (SECH-003)

### Detection

Check for `X-Frame-Options` or a CSP `frame-ancestors` directive on responses that render
HTML (server-rendered views, Razor pages, Blazor Server) or serve tokens an attacker could
harvest via an invisible iframe. A pure JSON API with no browser-rendered surface is exempt.

### BAD — HTML-rendering endpoint with no frame protection

```csharp
app.MapRazorPages(); // no frame-ancestors / X-Frame-Options anywhere in the pipeline
```

### GOOD — explicit frame protection

```csharp
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.Append("X-Frame-Options", "DENY");
    ctx.Response.Headers.Append("Content-Security-Policy", "frame-ancestors 'none';");
    await next();
});
```

---

## Check D — Missing anti-forgery on cookie-authenticated endpoints (SECH-004)

### Detection

If the app authenticates via cookies (not solely bearer tokens), every state-changing
endpoint (`POST`/`PUT`/`PATCH`/`DELETE`) must validate an anti-forgery token — otherwise a
malicious page can trigger the browser's ambient cookie auth via a forged cross-site
request. Bearer-token-only APIs (no cookie auth) are exempt — there's no ambient credential
for CSRF to exploit. See `angular-csrf-dotnet` for the matching Angular-side configuration.

### BAD — cookie auth configured, no anti-forgery validation anywhere

```csharp
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie();
// No AddAntiforgery(); no [ValidateAntiForgeryToken] / IAntiforgery.ValidateRequestAsync anywhere.
```

### GOOD — anti-forgery configured and enforced

```csharp
builder.Services.AddAntiforgery(opts =>
{
    opts.Cookie.Name = "XSRF-TOKEN";
    opts.HeaderName = "X-XSRF-TOKEN"; // must match the Angular withXsrfConfiguration()
    opts.Cookie.SameSite = SameSiteMode.Strict;
    opts.Cookie.SecurePolicy = CookieSecurePolicy.Always;
});

app.Use(async (ctx, next) =>
{
    if (HttpMethods.IsPost(ctx.Request.Method) || HttpMethods.IsPut(ctx.Request.Method)
        || HttpMethods.IsPatch(ctx.Request.Method) || HttpMethods.IsDelete(ctx.Request.Method))
    {
        await ctx.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(ctx);
    }
    await next();
});
```

---

## Check E — Permissive polymorphic JSON deserialization (SECH-005)

### Detection

Search for `TypeNameHandling.Auto`/`TypeNameHandling.All` (Newtonsoft.Json) or a custom
`JsonConverter` resolving a `$type` discriminator from untrusted input without an allow-list.
Deserializing an attacker-controlled type name lets the payload instantiate arbitrary types
on the server — a well-known deserialization RCE vector.

### BAD — arbitrary type resolution from client-supplied JSON

```csharp
var settings = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.Auto };
var payload = JsonConvert.DeserializeObject(untrustedJson, settings); // attacker picks the type
```

### GOOD — no type-name handling, or an explicit allow-list `SerializationBinder`

```csharp
// Default System.Text.Json — no polymorphic type resolution from the wire at all
var result = JsonSerializer.Deserialize<OrderRequest>(untrustedJson);

// If polymorphism is genuinely required, bind against a closed, allow-listed set of types
// via a custom JsonConverter<T> that switches on a known discriminator value — never a
// free-form assembly-qualified type name.
```

---

## Check F — Mass-assignment / over-posting (SECH-006)

### Detection

Check whether an endpoint's request parameter is bound directly to an EF Core entity type
instead of a dedicated request DTO. A client can then set fields the UI never exposed
(e.g. `IsAdmin`, `AccountBalance`) simply by adding them to the JSON body — this is the
same underlying issue `dotnet-dto-mapping` DTM-001 flags for response leakage; here it's the
request-binding direction. Cross-reference `dotnet-dto-mapping` rather than duplicating its
mapping-profile guidance.

### BAD — entity bound directly from the request body

```csharp
[HttpPut("{id}")]
public async Task<IActionResult> UpdateUser(Guid id, [FromBody] User user)
{
    // Client can set user.IsAdmin = true even though no UI field exposes it.
    _db.Users.Update(user);
    await _db.SaveChangesAsync();
    return NoContent();
}
```

### GOOD — a request DTO exposing only the fields the client may set

```csharp
public record UpdateUserRequest(string DisplayName, string Email);

[HttpPut("{id}")]
public async Task<IActionResult> UpdateUser(Guid id, [FromBody] UpdateUserRequest request)
{
    var user = await _db.Users.FindAsync(id);
    if (user is null) return NotFound();
    user.DisplayName = request.DisplayName;
    user.Email = request.Email;
    await _db.SaveChangesAsync();
    return NoContent();
}
```
