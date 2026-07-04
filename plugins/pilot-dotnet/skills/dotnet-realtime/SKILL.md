---
name: dotnet-realtime
description: Reviews ASP.NET Core real-time/streaming patterns — SignalR hubs and server-sent/IAsyncEnumerable streaming responses. Flags SignalR hubs with role-based or missing authorization instead of the permissions-only model, no backplane configured for multi-instance scale-out, streaming endpoints that buffer the full result before writing instead of yielding incrementally, and no client-side reconnection/backoff policy. Outputs findings with pilot-dotnet realtime standard IDs.
when_to_use: SignalR, hub authorization, IAsyncEnumerable streaming, Server-Sent Events, SSE, backplane, Azure SignalR Service, HubConnection reconnect, real-time notifications, WebSocket ASP.NET Core
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| RT-001 | P0 | SignalR hub uses role-based or missing authorization instead of the permissions-only model |
| RT-002 | P1 | No backplane configured for multi-instance/scaled-out SignalR deployment |
| RT-003 | P2 | Streaming endpoint buffers the full result before writing instead of yielding incrementally |
| RT-004 | P2 | No client-side reconnection/backoff policy on the SignalR connection |

---

## Check A — Hub authorization not permissions-only (RT-001)

### Detection

Grep `Hub`-derived classes for `[Authorize(Roles = "...")]` or missing `[Authorize]`
entirely on methods that push/receive sensitive data. SignalR hubs are a separate
authorization surface from MVC/minimal-API controllers and are easy to forget — the
permissions-only rule from `dotnet-authorization` AZ-001 applies here with no exception,
same as everywhere else in the API surface.

### BAD — hub method with no authorization, or role-based gating

```csharp
public class OrderNotificationsHub : Hub
{
    [Authorize(Roles = "Manager")] // role check — same AZ-001 violation as anywhere else
    public async Task SubscribeToOrder(Guid orderId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, orderId.ToString());
    }

    public async Task SendUpdate(Guid orderId, string message) // no [Authorize] at all
    {
        await Clients.Group(orderId.ToString()).SendAsync("OrderUpdated", message);
    }
}
```

### GOOD — permission-based hub authorization throughout

```csharp
[Authorize] // authentication required for the whole hub
public class OrderNotificationsHub : Hub
{
    private readonly IAuthorizationService _authz;

    public async Task SubscribeToOrder(Guid orderId)
    {
        var result = await _authz.AuthorizeAsync(Context.User!, orderId, "Orders.View");
        if (!result.Succeeded) throw new HubException("Not authorized for this order.");
        await Groups.AddToGroupAsync(Context.ConnectionId, orderId.ToString());
    }
}

builder.Services.AddSignalR(); // authorization enforced per-method via IAuthorizationService, not roles
```

---

## Check B — No backplane for scaled-out deployments (RT-002)

### Detection

If the API runs as more than one instance (Container Apps with `minReplicas` > 1, per
`dotnet-observability`/scaling config), check whether SignalR has a backplane configured
(Azure SignalR Service, or a Redis backplane). Without one, a message sent from instance A
never reaches a client connected to instance B — real-time notifications silently fail for
a fraction of users depending on which instance they landed on.

### BAD — scaled out with no backplane

```csharp
builder.Services.AddSignalR();
// Container App has minReplicas: 3 — clients connected to different instances never
// receive messages broadcast from a different instance's server-side code.
```

### GOOD — Azure SignalR Service as the backplane

```csharp
builder.Services.AddSignalR().AddAzureSignalR(builder.Configuration["AzureSignalR:ConnectionString"]);
```

---

## Check C — Streaming endpoint buffers the full result (RT-003)

### Detection

Grep `IAsyncEnumerable<T>` return types or Server-Sent-Events endpoints for whether the
underlying data source is fully materialized (`.ToListAsync()`) before being yielded,
defeating the purpose of streaming — the client waits for the entire dataset just like a
non-streaming response, just with extra ceremony.

### BAD — "streaming" endpoint that isn't actually streaming

```csharp
[HttpGet("orders/stream")]
public async IAsyncEnumerable<OrderDto> StreamOrders()
{
    var all = await _db.Orders.AsNoTracking().ToListAsync(); // fully materialized first
    foreach (var order in all)
        yield return order.ToDto();
}
```

### GOOD — genuinely incremental streaming from the database cursor

```csharp
[HttpGet("orders/stream")]
public async IAsyncEnumerable<OrderDto> StreamOrders()
{
    await foreach (var order in _db.Orders.AsNoTracking().AsAsyncEnumerable())
        yield return order.ToDto(); // each row streams to the client as it's read
}
```

---

## Check D — No client-side reconnection policy (RT-004)

### Detection

Check the Angular `HubConnectionBuilder` setup for `.withAutomaticReconnect()` (with a
backoff array, not the bare default) — without it, a transient network blip drops the
real-time connection permanently until the user manually refreshes the page.

### BAD — no reconnection handling

```typescript
const connection = new signalR.HubConnectionBuilder()
  .withUrl('/hubs/orders')
  .build();
// A dropped WebSocket connection stays dropped until the page is manually reloaded.
```

### GOOD — automatic reconnect with backoff, and a UI state for "reconnecting"

```typescript
const connection = new signalR.HubConnectionBuilder()
  .withUrl('/hubs/orders')
  .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
  .build();

connection.onreconnecting(() => this.connectivity.setReconnecting(true)); // ties to angular-pwa-offline's ConnectivityService
connection.onreconnected(() => this.connectivity.setReconnecting(false));
```
