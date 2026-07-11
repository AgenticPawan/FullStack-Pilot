---
id: angular-permission-based-authz
title: Permission-Based Client Access Control Only (No Role Checks)
appliesTo: angular
severity: block
standard: OWASP-A01
---
Route guards (`canActivate`/`canMatch`) and structural directives that hide/show UI must check a discrete **permission**, never a **role** name, and never a route `data: { roles: [...] }` array. Client-side gating is UX only — the real authorization boundary is the .NET API (`dotnet-authorization` AZ-001) — but the client-side check itself must follow the same permissions-only rule so a new capability never has to overload or add a role just to gate one screen.

**BAD**
```typescript
// orders.routes.ts
{
  path: 'orders/:id/approve',
  canActivate: [() => inject(AuthService).hasRole('Manager')], // role, not permission
}
```
```html
<button *appHasRole="'Manager'" (click)="approve(order)">Approve</button>
```

**GOOD**
```typescript
// orders.routes.ts
{
  path: 'orders/:id/approve',
  canActivate: [() => inject(PermissionService).hasPermission('orders.approve')],
}
```
```html
<button *appHasPermission="'orders.approve'" (click)="approve(order)">Approve</button>
```
