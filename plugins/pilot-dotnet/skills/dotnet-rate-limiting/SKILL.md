---
name: dotnet-rate-limiting
description: Reviews ASP.NET Core rate-limiting coverage. Flags login/auth endpoints with no rate limiting (brute-force/credential-stuffing exposure), the background-jobs admin controller lacking a rate limit on its trigger endpoint, no application-layer AddRateLimiter baseline for public APIs, and rate-limit rejections that omit a Retry-After header. Outputs findings with pilot-dotnet rate-limiting standard IDs.
when_to_use: rate limiting, AddRateLimiter, brute force, credential stuffing, login throttling, Retry-After header, fixed window limiter, sliding window limiter, token bucket limiter, concurrency limiter, 429 too many requests
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| RL-001 | P0 | Login/auth endpoint has no rate limiting |
| RL-002 | P1 | Background-jobs admin trigger endpoint has no rate limit |
| RL-003 | P2 | No global `AddRateLimiter` baseline for public APIs |
| RL-004 | P2 | Rate-limit rejection doesn't return a `Retry-After` header |

---

## Check A — No rate limiting on login/auth endpoints (RL-001)

### Detection

Grep the login/token-issuance endpoint for a rate-limiting policy attached
(`.RequireRateLimiting(...)`). An unthrottled login endpoint is a direct brute-force/
credential-stuffing target — this matters even more once permissions are resolved
per-request from a live store (`dotnet-authorization`), since a compromised account has
immediate effect with no stale-token delay to notice it in.

### BAD — login endpoint with no throttling

```csharp
app.MapPost("/api/auth/login", async (LoginDto dto, IAuthService auth) =>
{
    var result = await auth.LoginAsync(dto.Email, dto.Password);
    return result.Succeeded ? Results.Ok(result.Token) : Results.Unauthorized();
});
// Unlimited login attempts per second from a single IP or account.
```

### GOOD — a dedicated, tighter rate-limit policy on auth endpoints

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("auth", opt =>
    {
        opt.PermitLimit = 5;
        opt.Window = TimeSpan.FromMinutes(1);
        opt.QueueLimit = 0; // reject immediately, don't queue login attempts
    });
});

app.MapPost("/api/auth/login", async (LoginDto dto, IAuthService auth) => { ... })
   .RequireRateLimiting("auth");
```

---

## Check B — Background-jobs admin trigger endpoint has no rate limit (RL-002)

### Detection

Check the `BackgroundJobsController`/admin endpoint from `dotnet-background-jobs` BGJ-003
for a rate-limiting policy in addition to its `[Authorize]` guard. Authorization proves
*who* can call it; rate limiting bounds the damage if that caller's credentials are
compromised or a script bug fires the trigger in a loop.

### BAD — authorized but unbounded

```csharp
[Authorize(Policy = Permissions.Jobs.Manage)]
[HttpPost("{name}/trigger")]
public IActionResult Trigger(string name)
{
    BackgroundJob.Enqueue(name); // one compromised admin token = unlimited job triggers
    return Accepted();
}
```

### GOOD — authorized and rate-limited

```csharp
[Authorize(Policy = Permissions.Jobs.Manage)]
[HttpPost("{name}/trigger")]
[EnableRateLimiting("admin-jobs")]
public IActionResult Trigger(string name)
{
    BackgroundJob.Enqueue(name);
    return Accepted();
}

builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("admin-jobs", opt =>
    {
        opt.PermitLimit = 20;
        opt.Window = TimeSpan.FromMinutes(1);
    });
});
```

---

## Check C — No global rate-limiting baseline (RL-003)

### Detection

Check whether the API relies solely on infrastructure-level throttling (API Management,
Front Door) with nothing configured at the application layer via `AddRateLimiter`. Relying
only on infrastructure means local dev/test environments and any deployment path that
bypasses that infrastructure layer have no protection at all — defense-in-depth means the
app itself should have a sane global baseline regardless of what sits in front of it.

### BAD — no app-level limiter, entirely dependent on infrastructure

```csharp
// No AddRateLimiter() anywhere in Program.cs — protection exists only in APIM/Front Door config,
// invisible to this repo and bypassed entirely in local/dev environments.
```

### GOOD — a sane global baseline, with tighter per-endpoint policies layered on top (Checks A/B)

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        RateLimitPartition.GetFixedWindowLimiter(
            ctx.User.Identity?.Name ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 100, Window = TimeSpan.FromMinutes(1) }));
});

app.UseRateLimiter();
```

---

## Check D — Rejection omits Retry-After header (RL-004)

### Detection

Check the `OnRejected` callback (or the limiter's default behavior) for whether it sets a
`Retry-After` header on the `429` response. Without it, a well-behaved client/SDK has no
signal for how long to back off before retrying, and may retry immediately, compounding
the load the limiter was meant to shed.

### BAD — 429 with no guidance for the caller

```csharp
options.OnRejected = (context, ct) =>
{
    context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
    return ValueTask.CompletedTask; // caller has no idea when to retry
};
```

### GOOD — Retry-After header included

```csharp
options.OnRejected = (context, ct) =>
{
    context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
    context.HttpContext.Response.Headers.RetryAfter = "60";
    return ValueTask.CompletedTask;
};
```
