---
name: angular-realtime
description: Reviews the Angular SignalR client — the frontend counterpart to dotnet-realtime's hub. Flags a raw HubConnection scattered across components instead of a typed connection service, no automatic reconnect with backoff, the access token not attached (or not refreshed) on the socket, untyped on()/invoke() calls that drift from the hub's method contract, and subscriptions/connections not torn down on component destroy. Targets Angular 17+ standalone + Signals. Outputs pilot-angular angular-realtime standard IDs.
when_to_use: SignalR, real-time Angular, HubConnection, HubConnectionBuilder, withAutomaticReconnect, accessTokenFactory, hub method, on off invoke, websocket reconnect, live updates, notifications stream, presence, signalr client teardown, takeUntilDestroyed, typed hub proxy
applies_to: angular>=17
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ART-001 | P1 | Raw `HubConnection` built inside components instead of one typed connection service |
| ART-002 | P1 | No `withAutomaticReconnect` + no manual reconnect on `onclose` — a dropped socket stays dead |
| ART-003 | P0 | Access token not attached via `accessTokenFactory`, or never refreshed for a long-lived socket |
| ART-004 | P1 | `on()`/`invoke()` use string literals + `any` payloads that drift from the hub contract |
| ART-005 | P0 | Hub subscriptions / the connection itself not disposed on component destroy (leak) |

`dotnet-realtime` governs the server hub (methods, groups, auth, backplane). This skill
governs the browser half: one resilient, typed, authenticated connection whose lifetime is
tied to Angular's, so the client half doesn't leak sockets, silently stop receiving after a
network blip, or send a shape the hub can't bind. Method names and payload types here MUST
match the hub's — that seam is where a real-time feature breaks.

---

## Check A — One typed connection service, not per-component connections (ART-001)

### Detection

Look for `HubConnectionBuilder` invoked inside component classes. Each component that builds
its own connection opens a separate socket, re-authenticates independently, and duplicates
reconnect logic. There should be exactly one injectable connection service per hub, exposing
typed streams (Signals or Observables) that components consume.

### BAD — every component builds its own `HubConnection`

```typescript
@Component({ /* ... */ })
export class NotificationsComponent implements OnInit {
  ngOnInit() {
    const conn = new HubConnectionBuilder().withUrl('/hubs/notifications').build();
    conn.start();                              // ART-001: a second socket per component
    conn.on('notify', (n: any) => this.items.push(n));   // ART-004 + ART-005 too
  }
}
```

### GOOD — one connection service, components consume a typed Signal

```typescript
@Injectable({ providedIn: 'root' })
export class NotificationHubService {
  private readonly connection = new HubConnectionBuilder()
    .withUrl('/hubs/notifications', { accessTokenFactory: () => this.auth.accessToken() })
    .withAutomaticReconnect()
    .build();

  readonly notifications = signal<Notification[]>([]);
  // start() once, register typed handlers once; components just read notifications().
}
```

---

## Check B — Automatic reconnect + resubscribe (ART-002)

### Detection

Check that the connection is built with `withAutomaticReconnect()` (or has an explicit
`onclose` handler that restarts with backoff). Without it, the first transient network drop
kills the socket permanently and the UI silently stops updating — the worst failure mode
because nothing errors. Also confirm server→client group membership / state is re-established
after a reconnect (`onreconnected`), since reconnect starts a fresh connection id.

### BAD — no reconnect; a 2-second network blip ends live updates for the session

```typescript
new HubConnectionBuilder().withUrl('/hubs/orders').build();   // ART-002: no reconnect at all
```

### GOOD — reconnect with backoff, and re-join groups on reconnect

```typescript
new HubConnectionBuilder()
  .withUrl('/hubs/orders', { accessTokenFactory: () => this.auth.accessToken() })
  .withAutomaticReconnect([0, 2000, 5000, 10000])
  .build();
// connection.onreconnected(() => this.rejoinActiveGroups());
```

---

## Check C — Token attached and refreshed on the socket (ART-003)

### Detection

If the hub requires auth (`dotnet-realtime` + `dotnet-authentication`), the client MUST
supply the token via `accessTokenFactory` — a function, so the *current* token is read on
each (re)connect, not a stale one captured once. For WebSockets the token rides the query
string at negotiate time, so a long-lived socket started with an expired-soon token fails on
the next reconnect unless the factory returns a fresh one (see `auth-token-contract`).

### BAD — token captured once as a value; stale after silent renew

```typescript
.withUrl('/hubs/orders', { accessTokenFactory: () => this.tokenValue })  // ART-003: snapshot
```

### GOOD — factory reads the live token each (re)negotiation

```typescript
.withUrl('/hubs/orders', {
  accessTokenFactory: () => this.auth.accessToken(),   // current token on every reconnect
})
// angular-authentication owns the renew; this just always reads the latest.
```

---

## Check D — Typed hub method contract, not string + `any` (ART-004)

### Detection

Flag `connection.on('SomeMethod', (x: any) => ...)` and `connection.invoke('DoThing', ...)`
with bare string literals and untyped payloads. The method names and DTO shapes must match
the .NET hub (`dotnet-realtime`); a rename on the server silently breaks a string literal
here with no compile error. Centralize the method names and payload interfaces so a drift is
a TypeScript error, not a runtime no-op.

### BAD — magic strings, `any` payload

```typescript
connection.on('orderUpdated', (o: any) => this.apply(o));   // ART-004: no contract, no types
connection.invoke('subscribe', someId);
```

### GOOD — shared method names + typed payloads (ideally generated/shared with the API)

```typescript
export const OrdersHub = { OrderUpdated: 'OrderUpdated', Subscribe: 'Subscribe' } as const;

connection.on(OrdersHub.OrderUpdated, (o: OrderDto) => this.apply(o));   // typed to the DTO
connection.invoke(OrdersHub.Subscribe, orderId);
// OrderDto is the same contract angular-api-client-codegen generates for REST — one source.
```

---

## Check E — Teardown on destroy (ART-005)

### Detection

Confirm handlers registered with `on()` are removed and, where the connection is
component-scoped, `stop()` is called on destroy. Leaked handlers accumulate across
navigations (each visit adds another `on` callback → duplicated UI updates), and a leaked
component-scoped connection keeps a socket open forever (see `angular-memory-leaks`). Prefer
`takeUntilDestroyed()` for stream bridges and an explicit `off()`/`stop()` in the service's
`ngOnDestroy`/`DestroyRef`.

### BAD — handler registered every time the component mounts, never removed

```typescript
ngOnInit() { this.hub.connection.on('notify', this.handler); }   // ART-005: never off()'d
// Navigate away and back 5×  →  5 handlers fire per message.
```

### GOOD — bridge to a Signal/Observable scoped to the component lifetime

```typescript
constructor() {
  this.hub.notifications$
    .pipe(takeUntilDestroyed())     // auto-unsubscribes on destroy
    .subscribe(n => this.items.set(n));
}
// Root-scoped connection stays up; only the component's subscription is torn down.
```
