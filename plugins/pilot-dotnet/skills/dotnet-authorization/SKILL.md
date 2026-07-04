---
name: dotnet-authorization
description: Enforces permissions-ONLY access control in ASP.NET Core — no [Authorize(Roles=...)] check is ever acceptable, including coarse/admin-area gating; roles may only exist as a role-to-permission assignment mechanism, never as the thing a request is authorized against. Flags role-based authorization of any kind, missing IAuthorizationRequirement/AuthorizationHandler policies, magic-string policy names not backed by a generated permission catalog, unprotected minimal API routes, naive ownership checks that should use resource-based IAuthorizationService.AuthorizeAsync, and JWTs that embed a permission list or PII instead of resolving permissions per-request server-side. Outputs findings with pilot-dotnet authorization standard IDs.
when_to_use: authorization, permission-based access control, permissions only, IAuthorizationRequirement, AuthorizationHandler, policy-based authorization, RBAC vs permissions, Authorize Roles, role-based authorization, minimal API authorization, RequireAuthorization, resource-based authorization, AuthorizeAsync, ownership check, ClaimsPrincipal permission, JWT claims, PII in JWT, permissions in token, JwtSecurityToken
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| AZ-001 | P0 | `[Authorize(Roles = "...")]` / `User.IsInRole(...)` used to gate a request — access control must be permission-based ONLY, with no exception for coarse/admin gating |
| AZ-002 | P0 | No custom `IAuthorizationRequirement` + `AuthorizationHandler<T>` for a permission-based policy |
| AZ-003 | P2 | Policy name is a hard-coded magic string not sourced from a generated permission catalog |
| AZ-004 | P0 | Minimal API route missing `RequireAuthorization()` / endpoint-level `[Authorize]` |
| AZ-005 | P0 | Ownership check done inline (`if (resource.OwnerId == userId)`) instead of via resource-based `IAuthorizationService.AuthorizeAsync` |
| AZ-006 | P0 | Permission list embedded as a JWT claim instead of resolved per-request from a live permission store |
| AZ-007 | P0 | PII (email, full name, phone, etc.) placed in JWT claims beyond a minimal subject identifier |

---

## Check A — Access control must be permission-based ONLY (no role checks, ever)

### Detection

1. Grep for `[Authorize(Roles = "...")]`, `User.IsInRole(...)`, and `policy.RequireRole(...)`
   across controllers, minimal API endpoints, and policy registrations.
2. Flag **every** match, with no exception. Earlier guidance in this skill allowed a role
   check for "coarse" gating (e.g., admin-area entry) — that carve-out is retired. Even
   coarse gating must be modeled as its own permission (e.g., `admin.access`), because:
   - a role name says nothing about *what* the holder can do, so every new capability either
     reuses an existing role too broadly or forces a new role to be minted and shipped;
   - revoking one capability from a user who has several forces splitting or replacing their
     role instead of removing a single grant;
   - two independent axes (identity grouping vs. access decisions) collapse into one,
     so the authorization system can never be audited or tested capability-by-capability.
3. Roles may still exist purely as an **assignment convenience** — an admin UI can grant a
   "Manager" role to a user as shorthand for a bundle of permissions — but the bundle must be
   expanded into discrete permission grants at assignment time. The runtime authorization
   check (`[Authorize]`, `AuthorizeAsync`, minimal API `RequireAuthorization`) must always
   evaluate a **permission** policy, never a role name, and never `User.IsInRole(...)`.

### BAD — role check standing in for a permission, including "coarse" admin gating

```csharp
[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase
{
    // "Manager" role is being asked to mean "can approve orders",
    // "can export orders", and "can void orders" all at once.
    [Authorize(Roles = "Manager")]
    [HttpPost("{id:int}/approve")]
    public async Task<IActionResult> Approve(int id) => Ok();

    [Authorize(Roles = "Manager")]
    [HttpPost("{id:int}/void")]
    public async Task<IActionResult> Void(int id) => Ok();
}

[ApiController]
[Route("api/admin")]
[Authorize(Roles = "Admin")] // "coarse gating" is still a role check — no longer acceptable
public class AdminController : ControllerBase { ... }
```

### GOOD — permission-based policy per action, including admin-area entry

```csharp
[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase
{
    [Authorize(Policy = Permissions.Orders.Approve)]
    [HttpPost("{id:int}/approve")]
    public async Task<IActionResult> Approve(int id) => Ok();

    [Authorize(Policy = Permissions.Orders.Void)]
    [HttpPost("{id:int}/void")]
    public async Task<IActionResult> Void(int id) => Ok();
}

[ApiController]
[Route("api/admin")]
[Authorize(Policy = Permissions.Admin.Access)] // "admin area entry" is a permission too
public class AdminController : ControllerBase { ... }
```

Role assignment (an admin grants "Manager" to a user) is a separate, upstream concern from
authorization — it may bulk-grant a set of permissions at assignment time, but the request
pipeline never re-checks the role name itself.

---

## Check B — Missing `IAuthorizationRequirement` + `AuthorizationHandler<T>`

### Detection

1. Search for `AddAuthorization(options => options.AddPolicy(...))` registrations.
2. For any policy backed only by `RequireRole(...)` or `RequireClaim(...)` where the claim
   is a raw role name, flag AZ-002 — a permission-shaped policy should be backed by a
   requirement/handler pair so authorization logic is testable and centrally located.

### BAD — policy with no requirement/handler, just a claim check

```csharp
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("CanApproveOrders", policy =>
        policy.RequireClaim("role", "Manager")); // not a real permission model
});
```

### GOOD — requirement + handler

```csharp
public class PermissionRequirement : IAuthorizationRequirement
{
    public PermissionRequirement(string permission) => Permission = permission;
    public string Permission { get; }
}

public class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PermissionRequirement requirement)
    {
        if (context.User.HasClaim("permission", requirement.Permission))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}

// Program.cs
builder.Services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(Permissions.Orders.Approve, policy =>
        policy.Requirements.Add(new PermissionRequirement(Permissions.Orders.Approve)));
});
```

---

## Check C — Magic-string policy names without a permission catalog

### Detection

1. Grep for `[Authorize(Policy = "...")]` and `AddPolicy("...")` using inline string literals.
2. If the same string does not resolve to a constant/enum defined in one central catalog
   file (e.g., `Permissions.cs`), flag AZ-003 — typos silently create a policy that never
   matches any granted claim, failing open or closed depending on default policy behavior.

### BAD — scattered magic strings

```csharp
[Authorize(Policy = "orders.approve")]   // controller A
...
[Authorize(Policy = "order.approve")]    // controller B — typo, different string!
```

### GOOD — generated/central permission catalog

```csharp
public static class Permissions
{
    public static class Orders
    {
        public const string Approve = "orders.approve";
        public const string Void = "orders.void";
        public const string Export = "orders.export";
    }
}

// usage
[Authorize(Policy = Permissions.Orders.Approve)]
[HttpPost("{id:int}/approve")]
public async Task<IActionResult> Approve(int id) => Ok();
```

Recommend registering every constant in the catalog as a policy in a single loop at
startup, so a new permission cannot be referenced without also being wired up:

```csharp
builder.Services.AddAuthorization(options =>
{
    foreach (var permission in Permissions.All)
    {
        options.AddPolicy(permission, policy =>
            policy.Requirements.Add(new PermissionRequirement(permission)));
    }
});
```

---

## Check D — Unprotected minimal API routes

### Detection

1. Glob for `MapGet`, `MapPost`, `MapPut`, `MapDelete`, and `MapGroup` calls.
2. For each route or group that mutates or reads sensitive data, verify a
   `.RequireAuthorization(...)` call is chained, or that the group it belongs to has one.
3. Controller-level `[Authorize]` does not protect minimal API endpoints — they are a
   separate routing system and are anonymous by default unless explicitly required.

### BAD — minimal API group with no authorization

```csharp
var orders = app.MapGroup("/api/orders");

orders.MapPost("/{id:int}/approve", async (int id, IOrderService svc) =>
{
    await svc.ApproveAsync(id);
    return Results.Ok();
});
// Anyone, authenticated or not, can hit this endpoint.
```

### GOOD — group-level and endpoint-level authorization

```csharp
var orders = app.MapGroup("/api/orders").RequireAuthorization();

orders.MapPost("/{id:int}/approve", async (int id, IOrderService svc) =>
{
    await svc.ApproveAsync(id);
    return Results.Ok();
})
.RequireAuthorization(Permissions.Orders.Approve);
```

---

## Check E — Naive ownership checks instead of resource-based authorization

### Detection

1. Grep for inline ownership comparisons such as `if (x.OwnerId == userId)`,
   `if (entity.UserId != currentUserId)`, or similar patterns scattered across handlers.
2. Flag AZ-005 when this logic is duplicated in more than one place — it should be a single
   reusable `AuthorizationHandler` invoked via `IAuthorizationService.AuthorizeAsync`.

### BAD — inline ownership check duplicated per endpoint

```csharp
[HttpPut("{id:int}")]
public async Task<IActionResult> Update(int id, UpdateOrderDto dto)
{
    var order = await _db.Orders.FindAsync(id);
    if (order is null) return NotFound();

    var userId = User.GetUserId();
    if (order.OwnerId != userId) // duplicated in Delete(), Approve(), etc.
    {
        return Forbid();
    }

    order.Apply(dto);
    await _db.SaveChangesAsync();
    return NoContent();
}
```

### GOOD — resource-based authorization handler reused everywhere

```csharp
public class OrderOwnerRequirement : IAuthorizationRequirement { }

public class OrderOwnerAuthorizationHandler : AuthorizationHandler<OrderOwnerRequirement, Order>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        OrderOwnerRequirement requirement,
        Order resource)
    {
        if (context.User.GetUserId() == resource.OwnerId)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}

[HttpPut("{id:int}")]
public async Task<IActionResult> Update(
    int id, UpdateOrderDto dto, IAuthorizationService authz)
{
    var order = await _db.Orders.FindAsync(id);
    if (order is null) return NotFound();

    var result = await authz.AuthorizeAsync(User, order, new OrderOwnerRequirement());
    if (!result.Succeeded) return Forbid();

    order.Apply(dto);
    await _db.SaveChangesAsync();
    return NoContent();
}
```

---

## Check F — Permissions and PII must not live in the JWT

### Detection

1. Grep the token-issuance code (`SecurityTokenDescriptor`, `new JwtSecurityToken(...)`, `ClaimsIdentity` built at login) for a claim that carries a permission list (`"permissions"`, `"scopes"` populated from a per-user permission table) → **AZ-006**.
2. Grep the same code for claims carrying PII beyond a minimal subject identifier — full name, email, phone number, address, government ID — placed in the token body → **AZ-007**.
3. JWTs are bearer-readable by anything that logs, proxies, or caches the `Authorization` header, and their claims live until expiry even after a permission is revoked or the DB record is corrected. Neither permissions nor PII belong there.

### BAD — permissions and PII baked into the token

```csharp
var claims = new List<Claim>
{
    new Claim("sub", user.Id.ToString()),
    new Claim("email", user.Email),                       // PII — AZ-007
    new Claim("fullName", $"{user.FirstName} {user.LastName}"), // PII — AZ-007
    new Claim("permissions", JsonSerializer.Serialize(     // AZ-006 — stale until token expiry
        await _permissionService.GetPermissionsAsync(user.Id)))
};
var token = new JwtSecurityToken(issuer, audience, claims, expires: DateTime.UtcNow.AddHours(8));
```

### GOOD — minimal claims; permissions resolved per-request server-side

```csharp
var claims = new List<Claim>
{
    new Claim("sub", user.Id.ToString()),   // Guid subject identifier only — ties to dotnet-audit-fields AUD-006
    new Claim("tenant_id", user.TenantId.ToString()),
    new Claim("auth_scheme", "password")
};
var token = new JwtSecurityToken(issuer, audience, claims, expires: DateTime.UtcNow.AddMinutes(15));

// Permission checks happen per-request against a live (cached) store, not stale token claims:
public class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    private readonly IPermissionService _permissionService; // reads a cached DB table, invalidated on change

    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        var userId = Guid.Parse(context.User.FindFirst("sub")!.Value);
        if (await _permissionService.HasPermissionAsync(userId, requirement.Permission))
            context.Succeed(requirement);
    }
}
```

Revoking a permission takes effect on the next request instead of waiting out the token's
remaining lifetime, and no PII is exposed to anything that can read the bearer token.
