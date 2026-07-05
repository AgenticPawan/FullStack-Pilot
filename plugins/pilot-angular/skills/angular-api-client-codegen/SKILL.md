---
name: angular-api-client-codegen
description: Reviews how an Angular app consumes its .NET backend's API contract. Flags hand-typed TypeScript interfaces re-declared per feature instead of generating a typed client from the backend's OpenAPI/Swagger spec (NSwag/openapi-typescript), a generated client checked in but never regenerated against the current API version, hand-written HttpClient calls duplicating what the generated client already provides, and no CI step failing the build when the frontend model drifts from the backend contract. Outputs findings with pilot-angular api-client-codegen standard IDs.
when_to_use: NSwag, OpenAPI client, openapi-typescript, swagger codegen, generated API client, hand-typed interface drift, DTO drift frontend backend, nswag.json, OpenAPI spec generation, typed HTTP client generation
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ACG-001 | P1 | Hand-typed TS interfaces re-declared per feature instead of a generated client from the OpenAPI spec |
| ACG-002 | P1 | Generated client checked in but not regenerated in CI — drifts silently from the live API |
| ACG-003 | P2 | Hand-written `HttpClient` calls duplicate endpoints the generated client already exposes |
| ACG-004 | P2 | No CI step fails the build when the OpenAPI spec changes without the client being regenerated |

---

## Check A — Hand-typed interfaces instead of a generated client (ACG-001)

### Detection

Grep feature directories for TypeScript interfaces that mirror a C# DTO field-for-field
(`interface OrderDto { id: string; customerName: string; total: number }`) declared by hand
in more than one place. Every backend DTO is a generation target from the OpenAPI spec that
`dotnet-dto-mapping` already produces — hand-typing it a second time on the frontend means
the two copies drift the moment either side adds a field, and nothing catches it until a
runtime `undefined`.

### BAD — TS interface hand-typed to match the backend DTO, redeclared per feature

```typescript
// features/orders/models/order.model.ts
export interface Order {
  id: string;
  customerName: string;
  total: number;
}
// features/order-history/models/order-summary.model.ts — a second, slightly different hand-typed copy
export interface OrderSummary {
  id: string;
  customer: string;   // renamed by hand, now inconsistent with the actual DTO field name
  total: number;
}
```

### GOOD — generated client is the single source of truth for request/response types

```typescript
// nswag.json generates this file — never hand-edited
import { OrderDto, OrdersClient } from '@myorg/api-client';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly client = inject(OrdersClient);

  getOrder(id: string): Observable<OrderDto> {
    return this.client.getOrder(id); // OrderDto's shape always matches the live C# contract
  }
}
```

---

## Check B — Generated client checked in but never regenerated (ACG-002)

### Detection

Check whether the generated client directory (`libs/api-client` or similar) has a `git log`
history that lags behind backend DTO changes, and whether there's an `npm run generate-api`
(or equivalent NSwag CLI invocation) wired into a pre-build/CI step versus only ever run
manually by whoever happened to remember. A generated file that's manually regenerated
"when someone remembers" is worse than no generation at all — it creates false confidence
that the types are current.

### BAD — generation script exists but nothing calls it automatically

```json
// package.json
{ "scripts": { "generate-api": "nswag run nswag.json" } }
// no pre-build hook, no CI step — relies on a developer remembering to run this after every backend change
```

### GOOD — regeneration wired into CI, fails the build on drift

```yaml
# .github/workflows/ci.yml
- name: Regenerate API client
  run: npm run generate-api
- name: Fail if generated client is stale
  run: git diff --exit-code libs/api-client || (echo "API client is out of date — run npm run generate-api" && exit 1)
```

---

## Check C — Hand-written HttpClient calls duplicate the generated client (ACG-003)

### Detection

Grep for `HttpClient.get<T>(...)`/`.post<T>(...)` calls hitting an endpoint the generated
client (Check A) already exposes a typed method for. Bypassing the generated client for
"just this one call" reintroduces exactly the drift risk the codegen exists to prevent, and
skips whatever cross-cutting interceptor behavior (`angular-http-resilience` retry/timeout,
correlation-ID header) is wired onto the generated client's `HttpClient` instance.

### BAD — raw HttpClient call sidesteps the generated client

```typescript
loadOrder(id: string): Observable<any> {
  return this.http.get<any>(`/api/v1/orders/${id}`); // untyped, bypasses OrdersClient entirely
}
```

### GOOD — always go through the generated client

```typescript
loadOrder(id: string): Observable<OrderDto> {
  return this.ordersClient.getOrder(id); // typed, shares the same HttpClient pipeline/interceptors
}
```

---

## Check D — No CI drift check on spec change (ACG-004)

### Detection

Confirm the backend publishes its OpenAPI spec as a build artifact (or serves it at a known
route in CI against a running instance) and the frontend's codegen step consumes that exact
artifact — not a stale spec file committed to the frontend repo by hand. Without this, a
backend PR that renames a DTO field ships with no signal to the frontend team until a bug
report comes in.

### BAD — frontend generates against a manually-copied, possibly stale spec file

```json
// nswag.json
{ "documentGenerator": { "fromDocument": { "url": "./openapi-spec-copy.json" } } }
// this file was copied in by hand six months ago and never updated
```

### GOOD — codegen pulls the live spec from the backend's CI artifact/running instance

```json
// nswag.json
{ "documentGenerator": { "fromDocument": { "url": "https://api-ci.internal.example.com/swagger/v1/swagger.json" } } }
```

---

## API client codegen checklist

- [ ] All request/response TypeScript types come from a generated client (NSwag/openapi-typescript), not hand-typed interfaces
- [ ] Client regeneration is wired into CI/pre-build, not a manually-remembered script
- [ ] CI fails the build if the generated client is out of date relative to the backend spec
- [ ] No hand-written `HttpClient` calls duplicate an endpoint the generated client already exposes
- [ ] Codegen points at the backend's live/CI-published OpenAPI spec, not a stale committed copy
