---
name: realtime-contract
description: Reviews the cross-cutting SignalR seam tying dotnet-realtime (hub) to angular-realtime (client), as auth-token-contract and api-design-standards govern theirs. Flags hub method/event names duplicated as magic strings instead of a shared contract, push payloads with no matching typed Angular interface, the hub token diverging from REST auth, no hub-contract versioning tied to client regeneration, and reconnect gaps where missed messages are neither replayed nor re-fetched. Outputs pilot-core standard IDs (RTC-*).
when_to_use: SignalR contract, hub method name drift, client event name mismatch, real-time payload contract, hub DTO typed interface, accessTokenFactory hub auth, SignalR reconnect missed messages, hub versioning, server push shape, on() event string, real-time seam SPA API, HubConnection typed
---

## Purpose

`dotnet-realtime` reviews the C# hub; `angular-realtime` reviews the Angular `HubConnection`.
Neither can see the **seam**: the method names, event names, and payload shapes the two sides
must agree on, plus the auth token and reconnection semantics that span both. This is the
real-time analogue of `auth-token-contract` (auth seam) and `api-design-standards` (REST seam).
Drift here fails silently — a renamed hub method or a reshaped payload compiles cleanly on both
sides and only breaks at runtime for connected users.

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| RTC-001 | P1 | Hub method / client-event names are magic strings duplicated on both sides with no shared source of truth |
| RTC-002 | P1 | Server push payload (C# type) has no matching typed Angular interface — received as `any` |
| RTC-003 | P2 | Hub access token not propagated consistently with `auth-token-contract` — hub auth diverges from REST auth |
| RTC-004 | P2 | No hub-contract versioning / regeneration trigger — client and hub can drift across a deploy |
| RTC-005 | P2 | Reconnect gap not reconciled — messages missed during a drop are neither replayed nor re-fetched |

---

## Check A — Magic-string method/event names (RTC-001)

### Detection

Compare the hub's method names (`public Task SubscribeToOrder(...)`) and its
`Clients.*.SendAsync("OrderUpdated", ...)` event names against the Angular
`connection.invoke('...')` and `connection.on('...')` strings. Each name appears independently on
both sides with no shared constant — a rename on one side is a silent break.

### BAD — the string `'OrderUpdated'` is authored twice, unlinked

```csharp
await Clients.Group(id).SendAsync("OrderUpdated", dto); // C#
```
```typescript
connection.on('OrderUpdated', (dto) => this.apply(dto)); // TS — nothing links these
```

### GOOD — a single generated/shared contract both sides consume

Generate the event/method names (and payload types, see RTC-002) from one source — e.g. emit a
`hub-contract.ts` from the C# hub definitions, or share a small hand-maintained
`RealtimeEvents` const on each side reviewed as a pair — and reference the constant, never a
literal:

```typescript
import { HubEvents } from './hub-contract'; // generated from the C# hub
connection.on(HubEvents.OrderUpdated, (dto: OrderUpdatedEvent) => this.apply(dto));
```

---

## Check B — Untyped payloads (RTC-002)

The server sends a C# DTO; the Angular handler must receive a matching interface, not `any`.
Reuse the `angular-api-client-codegen` discipline: the real-time payload types belong in the
same generated/typed contract as the REST DTOs, so a field rename on the server surfaces as a
TypeScript compile error on the client.

```typescript
// BAD — payload is 'any'; server renaming dto.total → dto.amount is invisible here
connection.on(HubEvents.OrderUpdated, (dto) => this.total.set(dto.total));

// GOOD — typed; the rename breaks the build
connection.on(HubEvents.OrderUpdated, (dto: OrderUpdatedEvent) => this.total.set(dto.amount));
```

---

## Check C — Hub auth token divergence (RTC-003)

A SignalR WebSocket cannot send an `Authorization` header — the token goes through
`accessTokenFactory`. That token MUST be the same audience/issuer/scope the REST API validates
(`auth-token-contract` AUTH-*). Flag a hub connection with no `accessTokenFactory`, or one
sourcing a different token than the HTTP interceptor, so hub authorization and REST authorization
can silently diverge.

```typescript
// GOOD — hub uses the same access token the REST interceptor uses
new HubConnectionBuilder()
  .withUrl('/hubs/orders', { accessTokenFactory: () => this.auth.getAccessToken() })
  .build();
```

Server: the hub's `[Authorize]` and permission checks resolve claims from that token exactly as
the REST pipeline does — no separate hub token scheme. See `dotnet-realtime` RT-001 for the
permissions-only hub authorization itself.

---

## Check D — Contract versioning (RTC-004)

There is no HTTP status/`Accept` header to version a hub. Flag the absence of a deliberate
strategy: a `hub-contract` regenerated in CI when the C# hub changes (build fails on drift), or
an explicit hub-version negotiated on connect so an old client is rejected/upgraded rather than
receiving a payload shape it can't parse. Ties to `zero-downtime-deployment`: during a rolling
deploy, N-1 clients connect to N hubs — the payload must stay backward-compatible or be versioned.

---

## Check E — Reconnect reconciliation (RTC-005)

`angular-realtime`/`dotnet-realtime` cover *automatic reconnect*; the seam concern is what happens
to messages sent **during** the drop. After `onreconnected`, the client must reconcile — re-fetch
current state or replay from a last-seen cursor — not silently assume it missed nothing. Flag a
reconnect handler that restores the connection but never re-syncs state.

```typescript
connection.onreconnected(() => this.refetchCurrentState()); // reconcile the gap, don't assume continuity
```

---

## Read budget

≤ 8 files: the C# hub(s) and their `SendAsync` call sites, the Angular service building the
`HubConnection` with its `on`/`invoke` calls, and the shared/generated contract if one exists.
Reference `dotnet-realtime` (hub mechanics), `angular-realtime` (client mechanics), and
`auth-token-contract` (token audience/scope) rather than re-deriving them. Budgets bound
exploration, not quality — if the payload types live in a generated client, read it and say why.
