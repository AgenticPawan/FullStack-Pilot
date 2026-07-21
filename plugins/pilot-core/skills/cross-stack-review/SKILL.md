---
name: cross-stack-review
description: Reviews a diff that spans multiple layers simultaneously and flags cross-cutting issues no per-stack reviewer can see alone — an Angular component calling an endpoint that doesn't exist yet, a .NET auth change not reflected in the Angular route guard, a SQL column rename with no EF Core model update. Runs after individual stack skills, not instead of them. Outputs CSR-* standard IDs.
when_to_use: cross-stack review, multi-layer diff, seam check, contract drift, before PR, pre-commit check, Angular .NET mismatch, endpoint missing, route guard out of sync, schema drift, DTO drift, vertical slice review, check seams, cross-layer issues
---

## Purpose

This skill is the between-stack companion to the per-stack reviewer agents. Each stack reviewer
(`@angular-reviewer`, `@dotnet-reviewer`, `@sql-reviewer`, `@infra-reviewer`) verifies correctness
within its own layer. This skill verifies correctness *across* the seams. It runs last — after
the within-stack checks confirm each layer is individually sound.

Invoke via `@fsp-feature-builder` (automatically at scaffold end) or standalone before a PR.

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| CSR-001 | P0 | Angular component calls an endpoint route/method that has no matching .NET controller action |
| CSR-002 | P1 | .NET authorization policy or attribute changed but Angular route guard / permission check not updated |
| CSR-003 | P1 | SQL column renamed or dropped with no corresponding EF Core entity and migration update |
| CSR-004 | P1 | .NET DTO shape changed but Angular generated client not regenerated (NSwag/Kiota) |
| CSR-005 | P2 | New critical user journey touches both SPA and API but no E2E test covers the seam |

## Read budget (STRICT): max 12 files

Read only what spans two or more layers. Never re-read a file a specialist has already reviewed.
If a scout brief exists under `.claude/pilot/context/`, read it first.

---

## Check A — Endpoint contract: Angular calls non-existent .NET route (CSR-001)

### Detection
1. Find Angular HTTP calls in changed `.ts` files (look for `this.http.get|post|put|patch|delete`
   and generated client method calls like `this.ordersClient.getById(...)`).
2. Extract the URL path or generated-client method name.
3. Verify a matching `[HttpGet]`/`[HttpPost]`/`[Route]`/`[HttpPut]`/`[HttpDelete]` attribute exists
   on a .NET controller action in the diff or current codebase.
4. Flag when the route path in the Angular call has no matching .NET route.

### BAD — Angular calls a route that was never added
```typescript
// orders.service.ts — calls /api/orders/{id}/approve
this.http.post<void>(`/api/orders/${id}/approve`, {}).subscribe();
```
```csharp
// OrdersController.cs — only has GET/POST, no approve endpoint
[HttpGet("{id}")] public Task<OrderDto> GetById(Guid id) ...
[HttpPost]        public Task<OrderDto> Create(CreateOrderDto dto) ...
// /approve endpoint missing → Angular call will always return 404
```

### GOOD
```csharp
[HttpPost("{id}/approve")]
public Task<IActionResult> Approve(Guid id, ApproveOrderDto dto) ...
```

**Finding format:**
```
CSR-001 [P0] Angular: orders.service.ts:42 calls POST /api/orders/{id}/approve
         .NET: no matching [HttpPost("{id}/approve")] found in OrdersController.cs
         Fix: add the endpoint or update the Angular call to the correct route.
```

---

## Check B — Auth drift: .NET policy changed, Angular guard not updated (CSR-002)

### Detection
1. Find `.NET` files in the diff that add, change, or remove `[Authorize(Policy = "...")]`
   or `[Authorize(Roles = "...")]` attributes — or changes to `AddPolicy(...)` in DI.
2. Find Angular route guard files or `hasPermission(...)` calls.
3. Flag when the .NET policy name or required permission changed but the Angular guard still
   references the old permission string, or the guard is missing entirely for the now-protected route.

### BAD — .NET requires new policy, Angular guard not updated
```csharp
// Before: [Authorize]  After: [Authorize(Policy = "orders.approve")]
[HttpPost("{id}/approve")]
[Authorize(Policy = "orders.approve")]
public Task<IActionResult> Approve(...) ...
```
```typescript
// orders.routes.ts still uses old generic auth guard — no permission check for approve
{ path: 'orders/:id/approve', canActivate: [AuthGuard], loadComponent: ... }
```

### GOOD
```typescript
{ path: 'orders/:id/approve',
  canActivate: [() => inject(PermissionService).hasPermission('orders.approve')],
  loadComponent: ... }
```

---

## Check C — Schema drift: SQL column renamed/dropped, EF Core model not updated (CSR-003)

### Detection
1. Find SQL migration files in the diff that rename or drop columns (look for `RenameColumn`,
   `DropColumn`, `AlterColumn`).
2. Find the corresponding EF Core entity class and `IEntityTypeConfiguration`.
3. Flag when the entity property name or column mapping does not match the migration.

### BAD
```csharp
// Migration: renames ShippingAddress to DeliveryAddress
migrationBuilder.RenameColumn("ShippingAddress", "Orders", "DeliveryAddress");
```
```csharp
// Order.cs entity still has the old property name
public string ShippingAddress { get; set; }  // not updated — EF query will fail at runtime
```

### GOOD
```csharp
// Order.cs updated to match migration
public string DeliveryAddress { get; set; }
```

---

## Check D — DTO drift: .NET response shape changed, Angular client not regenerated (CSR-004)

### Detection
1. Find changed .NET DTO or record files in the diff (files under `Contracts/`, `Dtos/`, `Models/`
   matching `*Dto.cs`, `*Response.cs`, `*Request.cs`).
2. Check whether an Angular generated client file (typically `*-client.ts`, `nswag.json`,
   `openapi.json`) is also present in the diff.
3. Flag when .NET DTO changed but no regenerated Angular client is in the diff.
4. Cite `api-design-standards` API-004 and `angular-api-client-codegen` alongside CSR-004.

### Finding format:
```
CSR-004 [P1] .NET DTO changed: OrderDto.cs removed field "LegacyCode"
         Angular client not regenerated: src/app/api/orders-client.ts still references .legacyCode
         Fix: run NSwag/Kiota regeneration command and commit the updated client.
```

---

## Check E — E2E gap: new journey spans SPA + API with no E2E coverage (CSR-005)

### Detection
1. Identify new routes added in Angular routing and new endpoints added in .NET controllers.
2. Check whether a Playwright/Cypress spec file exists that exercises the new journey end to end.
3. Flag the gap when: (a) a new user-facing route connects to a new API endpoint AND
   (b) no E2E spec file references either the route path or the endpoint path.
4. Cite `fullstack-e2e-testing` E2E-001 alongside CSR-005.

---

## Output format

```
## Cross-Stack Seam Review

Layers in diff: <Angular | .NET | SQL | Azure> (list only layers present)

### CSR findings
<findings in order CSR-001 … CSR-005, or "None">

### Verdict
<N critical, N warnings, N advisory — one sentence>
```

If no cross-layer issues found: output `Cross-stack seam check: clean.`

---

## Behaviour rules

- Never re-derive findings a specialist reviewer already owns (within-stack correctness).
- Never open a file only to confirm a negative — state "not found in diff" if the file is absent.
- Maximum 10 lines of source quoted per finding.
- Budgets bound exploration, not quality: if 12 files are insufficient to confirm a seam check,
  state what else is needed rather than returning a speculative result.
