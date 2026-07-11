---
name: dotnet-api-contract-testing
description: Reviews consumer-driven contract testing between Angular and the .NET API — dotnet-api-versioning prevents in-place breaks, but nothing verifies the frontend's actual response-shape assumptions before deploy. Flags no contract tests in CI, happy-path-only verification, no shared schema source of truth, and provider changes deployed without consumer verification. Outputs pilot-dotnet api-contract-testing standard IDs.
when_to_use: Pact, consumer-driven contract testing, contract test, OpenAPI schema diff, provider verification, pact broker, breaking change detection, API schema mismatch, frontend backend contract
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ACT-001 | P1 | No contract tests run in CI between frontend and backend |
| ACT-002 | P2 | Contract verification only checks the happy path, not error/edge responses |
| ACT-003 | P1 | No shared schema source of truth between frontend and backend |
| ACT-004 | P0 | Provider-side change deployed with no consumer-side contract verification gate |

`dotnet-api-versioning` prevents an *existing* version's contract from changing in place.
This skill catches a narrower but common gap: the Angular app's actual runtime
assumptions about a response (which fields it reads, what it expects to be non-null)
silently drifting from what the backend truly guarantees — a mismatch neither
`dotnet-validation` nor `angular-testing`'s mocked `HttpTestingController` responses would
ever catch, because both sides are tested in isolation against their own assumptions.

---

## Check A — No contract tests in CI (ACT-001)

### Detection

Check whether CI runs any consumer-driven contract test (Pact) or schema-diff check
(comparing the OpenAPI spec the API actually serves against a golden/expected spec)
between the frontend and backend. Without one, `angular-testing`'s
`HttpTestingController` mocks and `dotnet-testing`'s `WebApplicationFactory` integration
tests each pass independently while testing against their own assumptions of what the
other side does — neither one catches the other side changing.

### BAD — frontend and backend tested in isolation, nothing verifies they agree

```typescript
// Angular test mocks the exact response shape the frontend expects
httpMock.expectOne('/api/orders/123').flush({ id: '123', total: 99.99, status: 'Approved' });
```

```csharp
// Backend test verifies its own serialization independently
var response = await client.GetAsync("/api/orders/123");
// Both tests pass even if the backend actually renamed `status` to `orderStatus` last sprint.
```

### GOOD — a Pact contract test verifying both sides against the same agreement

```typescript
// Angular (consumer) — Pact test generates a contract file describing what it expects
await provider.addInteraction({
  state: 'order 123 exists',
  uponReceiving: 'a request for order 123',
  withRequest: { method: 'GET', path: '/api/orders/123' },
  willRespondWith: { status: 200, body: { id: '123', total: 99.99, status: 'Approved' } },
});
```

```csharp
// .NET (provider) — CI runs provider verification against the contract the frontend published
[Fact]
public async Task VerifyPactContracts()
{
    var verifier = new PactVerifier("OrdersApi", config);
    verifier.ServiceProvider("OrdersApi", "http://localhost:5000")
        .HonoursPactWith("AngularApp")
        .PactUri(pactBrokerUri)
        .Verify(); // fails CI if the actual API response no longer matches the published contract
}
```

---

## Check B — Contract verification only checks the happy path (ACT-002)

### Detection

Check whether contract tests cover error responses (`ProblemDetails` shape per
`dotnet-error-handling` ERR-002, validation failures per `dotnet-validation` VAL-003) in
addition to the 200-OK happy path. A frontend that only tests against a successful
response shape will silently mishandle a 404/409/422 differently than the backend
actually returns it — exactly the failure mode `angular-error-handling` AEH-003 exists
to prevent, but only if the contract test actually exercises that path.

### BAD — contract only covers the successful response

```typescript
await provider.addInteraction({
  uponReceiving: 'a request for an order',
  withRequest: { method: 'GET', path: '/api/orders/123' },
  willRespondWith: { status: 200, body: { id: '123' } }, // only the happy path is contracted
});
```

### GOOD — contract covers the ProblemDetails error shape too

```typescript
await provider.addInteraction({
  state: 'order 999 does not exist',
  uponReceiving: 'a request for a nonexistent order',
  withRequest: { method: 'GET', path: '/api/orders/999' },
  willRespondWith: {
    status: 404,
    body: { title: 'Order not found', status: 404 }, // matches dotnet-error-handling's ProblemDetails shape
  },
});
```

---

## Check C — No shared schema source of truth (ACT-003)

### Detection

Check whether the Angular DTO interfaces are hand-written independently of the .NET
DTOs, versus generated from a single source (the OpenAPI spec the API already exposes,
via `openapi-typescript`/NSwag) — two independently-maintained type definitions for the
same wire contract inevitably drift, and TypeScript's structural typing won't catch a
backend field rename the way a shared-schema-generated type would.

### BAD — Angular interface hand-written, drifts from the actual DTO over time

```typescript
// Hand-maintained, nobody remembers to update this when the backend DTO changes
export interface OrderDto {
  id: string;
  total: number;
  status: string; // backend renamed this to orderStatus 3 sprints ago — nobody updated this file
}
```

### GOOD — TypeScript types generated from the API's own OpenAPI spec

```json
// package.json
{ "scripts": { "generate-api-types": "openapi-typescript http://localhost:5000/swagger/v1/swagger.json -o src/app/api-types.ts" } }
```

```typescript
// Regenerated whenever the backend contract changes — a build step fails loudly
// if generation output differs from what's committed, catching drift immediately.
import type { components } from './api-types';
type OrderDto = components['schemas']['OrderDto'];
```

---

## Check D — Provider change deployed with no consumer verification gate (ACT-004)

### Detection

Check whether the CI/CD pipeline (`azure-cicd-security`) blocks a backend deployment
that would break the published contract — provider verification (Check A) must run
*before* deploy, as a gate, not as an informational check reviewed after the fact.

### BAD — provider verification runs, but doesn't block deployment on failure

```yaml
- run: dotnet test --filter Category=PactVerification
  continue-on-error: true # failure is logged but doesn't stop the deploy
- run: az webapp deploy ...
```

### GOOD — contract verification is a hard gate before deploy

```yaml
- run: dotnet test --filter Category=PactVerification # fails the workflow on contract violation
- run: az webapp deploy ... # only reached if the contract verification step passed
```
