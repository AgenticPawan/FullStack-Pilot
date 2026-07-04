---
name: dotnet-authorization
description: Reviews ASP.NET Core authorization for permission-based access control beyond role checks. Flags role-only [Authorize(Roles=...)] where fine-grained permissions are needed, missing IAuthorizationRequirement/AuthorizationHandler policies, magic-string policy names not backed by a generated permission catalog, unprotected minimal API routes, and naive ownership checks that should use resource-based IAuthorizationService.AuthorizeAsync. Outputs findings with pilot-dotnet authorization standard IDs.
when_to_use: authorization, permission-based access control, IAuthorizationRequirement, AuthorizationHandler, policy-based authorization, RBAC vs permissions, minimal API authorization, RequireAuthorization, resource-based authorization, AuthorizeAsync, ownership check, ClaimsPrincipal permission
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| AZ-001 | P1 | Role-only `[Authorize(Roles = "...")]` used where a fine-grained permission check is needed |
| AZ-002 | P0 | No custom `IAuthorizationRequirement` + `AuthorizationHandler<T>` for a permission-based policy |
| AZ-003 | P2 | Policy name is a hard-coded magic string not sourced from a generated permission catalog |
| AZ-004 | P0 | Minimal API route missing `RequireAuthorization()` / endpoint-level `[Authorize]` |
| AZ-005 | P0 | Ownership check done inline (`if (resource.OwnerId == userId)`) instead of via resource-based `IAuthorizationService.AuthorizeAsync` |

---

## Check A — Role checks used as a substitute for permissions

### Detection

1. Grep for `[Authorize(Roles = "...")]` across controllers and minimal API endpoints.
2. Flag any usage guarding an action that is really a discrete permission (approve, export,
   refund, delete-other-users-data) rather than a broad identity concept (Admin vs Member).
3. A role check is acceptable for coarse gating (e.g., admin area entry); it is a finding
   when the same role string is reused to gate many unrelated fine-grained actions, since
   adding a new permission then requires either a new role or loosening an existing one.

### BAD — role check standing in for a permission

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
```

### GOOD — permission-based policy per action

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
```

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
