---
name: angular-monorepo-governance
description: Reviews Nx/monorepo workspace boundaries once an Angular codebase splits across multiple apps or teams — the architecture layer above angular-shared-libraries' single-library extraction guidance. Flags no enforced module/library-tag boundaries (any app can import any library), shared libraries with no clear ownership or versioning story across teams, no module-federation/micro-frontend boundary for independently deployable apps, and duplicated cross-cutting concerns (auth, theming) reimplemented per app instead of consumed from a shared library. Outputs findings with pilot-angular monorepo-governance standard IDs.
when_to_use: Nx workspace, module boundaries, project tags, module federation, micro-frontend, dependency-cruiser, cross-team library ownership, monorepo governance, shell application, remote application
applies_to: angular>=17
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| MFE-001 | P1 | No enforced module/library-tag boundaries — any app can import any library |
| MFE-002 | P1 | Shared library has no clear ownership or cross-team versioning story |
| MFE-003 | P2 | No module-federation boundary for apps meant to deploy independently |
| MFE-004 | P2 | Cross-cutting concern (auth, theming) reimplemented per app instead of shared |

This skill applies once a codebase has split into multiple Angular apps/teams within one
workspace (or multiple workspaces). A single-app codebase is fully covered by
`angular-shared-libraries`; this skill governs the *boundaries between* apps and libraries.

---

## Check A — No enforced module/library-tag boundaries (MFE-001)

### Detection

Check for Nx's `@nx/enforce-module-boundaries` ESLint rule (or `dependency-cruiser`
equivalent) configured with tags restricting which libraries a given app/library can
import — e.g., a `feature` library should not import another feature's internals, and a
`ui` library should never import a `feature` library. Without enforcement, any app can
reach into any library's internals, and the intended layered architecture erodes silently
over time as deadlines pressure developers to take the shortest import path.

### BAD — no boundary enforcement, any import is allowed

```json
// .eslintrc.json — no @nx/enforce-module-boundaries rule configured
{
  "rules": {}
}
```

```typescript
// libs/orders/feature/src/lib/order-list.component.ts
import { InvoicePdfRenderer } from '@acme/invoicing/feature/internal'; // reaches into another feature's internals
```

### GOOD — tagged libraries, boundaries enforced by lint rule

```json
{
  "rules": {
    "@nx/enforce-module-boundaries": ["error", {
      "depConstraints": [
        { "sourceTag": "scope:orders", "onlyDependOnLibsWithTags": ["scope:orders", "scope:shared"] },
        { "sourceTag": "type:feature", "onlyDependOnLibsWithTags": ["type:ui", "type:data-access", "type:util"] }
      ]
    }]
  }
}
```

---

## Check B — Shared library has no clear ownership (MFE-002)

### Detection

For a library consumed by more than one team's app, check whether it has a documented
owner (a `CODEOWNERS` entry, or an explicit team name in its `project.json`/README) and a
semver/versioning convention for breaking changes. An unowned shared library either stops
receiving maintenance (nobody feels responsible for fixing its bugs) or gets breaking
changes pushed by whichever team touches it last, without warning the other consumers.

### BAD — shared library, no listed owner, breaking changes land with no notice

```
libs/shared/data-table/  <!-- consumed by 4 different team's apps, no CODEOWNERS entry,
                               no changelog — team A changed its public API last sprint
                               and teams B/C/D found out when their builds broke. -->
```

### GOOD — explicit ownership and a changelog for breaking changes

```
# CODEOWNERS
libs/shared/data-table/ @platform-team

# libs/shared/data-table/CHANGELOG.md
## 3.0.0 (breaking)
`DataTableComponent`'s `columns` input now requires an explicit `width` per column.
Migration: add `width: 'auto'` to preserve current behavior. Consumers notified in
#platform-announcements 2 weeks before this landed.
```

---

## Check C — No module-federation boundary for independently deployable apps (MFE-003)

### Detection

If multiple Angular apps are meant to deploy independently (different release cadences,
different teams shipping without blocking each other), check whether Module Federation
(`@angular-architects/module-federation` or Native Federation) is configured, versus every
app being bundled and deployed as part of one monolithic build — the latter means any
team's change requires a full rebuild/redeploy of every other team's app too.

### BAD — logically-separate apps bundled into one monolithic deployable

```
# Every "micro-frontend" is actually just a lazy-loaded route inside one giant app.build,
# so team A's Tuesday release train blocks on team B's unrelated feature also being ready.
```

### GOOD — shell + remotes via Module Federation, independent deploy pipelines

```json
// module-federation.config.ts (shell)
{
  "name": "shell",
  "remotes": ["orders@https://orders.acme.internal/remoteEntry.js"]
}
```

```json
// module-federation.config.ts (orders remote — its own CI/CD pipeline, deployed independently)
{
  "name": "orders",
  "exposes": { "./Routes": "./src/app/orders.routes.ts" }
}
```

---

## Check D — Cross-cutting concern reimplemented per app (MFE-004)

### Detection

Grep each app for its own copy of concerns that should be one shared library: an
`AuthInterceptor`, a theming setup (`angular-theming`), or a `PermissionService`
(`angular-security`) reimplemented independently per app instead of imported from one
shared library — each copy can drift from the others (e.g., one app's permission check
implementation lags behind a security fix applied to another).

### BAD — every app has its own copy of the auth interceptor

```typescript
// apps/orders/src/app/auth.interceptor.ts
// apps/invoicing/src/app/auth.interceptor.ts  — nearly identical, but not the same file,
// so a security fix to one doesn't propagate to the other.
```

### GOOD — one shared library, imported by every app

```typescript
// libs/shared/auth/src/lib/auth.interceptor.ts — the single implementation
import { authInterceptor } from '@acme/shared/auth';

// apps/orders/src/app/app.config.ts
providers: [provideHttpClient(withInterceptors([authInterceptor]))];
// apps/invoicing/src/app/app.config.ts — same import, same fix applies everywhere at once
```
