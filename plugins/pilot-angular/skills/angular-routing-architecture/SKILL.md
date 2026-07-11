---
name: angular-routing-architecture
description: Reviews Angular Router architecture beyond permission guards (owned by angular-security) — resolvers, typed route data, nested composition. Flags detail data fetched in ngOnInit instead of a Resolver, magic-string route data, deep routes with no lazy boundary, missing wildcard/redirect strategy, guards duplicated across siblings instead of applied at a parent, and components ignoring paramMap changes. Outputs pilot-angular routing-architecture standard IDs.
when_to_use: Resolver, route resolver, route data, breadcrumb, route title, lazy loading route, loadChildren, loadComponent, wildcard route, 404 route, 403 route, canActivateChild, paramMap, snapshot params, sibling route navigation, nested routes, route architecture
applies_to: angular
---

<!-- Version index:
  Functional guards/resolvers (ResolveFn)   Angular 14.2+
  loadComponent (standalone lazy routes)    Angular 15+
  withComponentInputBinding()               Angular 16+ (route data/params bound to component inputs)
-->

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| RTA-001 | P1 | Detail data fetched in `ngOnInit` with a loading spinner instead of a Resolver |
| RTA-002 | P2 | Route data (title, breadcrumb, icon, permission key) as scattered magic strings |
| RTA-003 | P1 | Deeply nested feature routes with no lazy-loading boundary per feature |
| RTA-004 | P1 | No consistent wildcard/redirect strategy for unmatched or unauthorized routes |
| RTA-005 | P2 | `CanActivate` guard duplicated across sibling routes instead of applied once at a parent |
| RTA-006 | P1 | Route params read via snapshot only — component doesn't react to sibling-route param changes |

**Cross-reference:** permission/role-based `CanActivate`/`CanMatch` guard *content* (permission
vs. role checks) is owned by `angular-security` (rule `angular-permission-based-authz`). This
skill governs *where* guards are applied (parent vs. duplicated per sibling) and the surrounding
router architecture — resolvers, route data, lazy-loading boundaries, and param reactivity.

---

## Check A — Resolvers instead of component-driven data fetching (RTA-001)

### Detection
1. Scan components rendered by a route (i.e. referenced by `loadComponent`/`component` in a
   `Routes` array) for an `ngOnInit` that issues an HTTP call and toggles a `loading` flag while
   the template renders a spinner.
2. Flag this pattern when the component immediately needs the data to render anything meaningful
   — the route activates into a half-rendered shell before the fetch resolves.
3. A documented, deliberate choice to defer to component-level fetching for skeleton-loading UX
   (e.g. a list view that renders a skeleton grid while paginated data streams in) is acceptable —
   only flag when there is no such documented rationale and a Resolver would be the natural fit
   (single-entity detail views, edit forms).

### BAD — component fetches its own detail data with a manual loading flag
```typescript
// order-detail.component.ts
export class OrderDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private orderService = inject(OrderService);
  order?: Order;
  loading = true;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.orderService.getById(id).subscribe(order => {
      this.order = order;
      this.loading = false;
    });
  }
}
```
```html
@if (loading) { <app-spinner /> } @else { <app-order-summary [order]="order!" /> }
```

### GOOD — Resolver guarantees data before the route activates
```typescript
// order.resolver.ts
export const orderResolver: ResolveFn<Order> = (route) => {
  const orderService = inject(OrderService);
  return orderService.getById(route.paramMap.get('id')!);
};
```
```typescript
// orders.routes.ts
export const ordersRoutes: Routes = [
  {
    path: ':id',
    loadComponent: () => import('./order-detail.component').then(m => m.OrderDetailComponent),
    resolve: { order: orderResolver }
  }
];
```
```typescript
// order-detail.component.ts — Angular 16+ withComponentInputBinding binds resolved data directly
export class OrderDetailComponent {
  order = input.required<Order>();
}
```

---

## Check B — Typed route data convention (RTA-002)

### Detection
1. Search route configs for `data: { ... }` usage across the app.
2. Flag inconsistency: some routes set `data: { title: '...' }`, others set a differently-named
   key (`pageTitle`, `label`), and some routes set no `data` at all — with title/breadcrumb/icon
   values instead hardcoded per component template.
3. Confirm a shared `RouteData` interface exists and a single service (title service, breadcrumb
   service) reads from it consistently via `router.routerState.root` traversal, rather than each
   component re-deriving its own title/breadcrumb string.

### BAD — magic strings, inconsistent keys, some components hardcode their own title
```typescript
// orders.routes.ts
{ path: 'orders', data: { title: 'Orders' }, loadComponent: () => import('./orders-list.component') }
{ path: 'invoices', data: { pageTitle: 'Invoices', crumb: 'Invoices' }, loadComponent: () => import('./invoices.component') }
```
```typescript
// invoices.component.ts — sets document.title itself, bypassing route data entirely
ngOnInit() { document.title = 'Invoices — Contoso'; }
```

### GOOD — a shared typed RouteData convention read by one TitleService/BreadcrumbService
```typescript
// route-data.model.ts
export interface RouteData {
  title: string;
  breadcrumb: string;
  icon?: string;
  permissionKey?: string;
}
```
```typescript
// orders.routes.ts
{
  path: 'orders',
  data: { title: 'Orders', breadcrumb: 'Orders', icon: 'list', permissionKey: 'orders.view' } satisfies RouteData,
  loadComponent: () => import('./orders-list.component').then(m => m.OrdersListComponent)
}
```
```typescript
// breadcrumb.service.ts — single place that walks routerState and reads RouteData
@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private router = inject(Router);
  breadcrumbs = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => this.buildTrail(this.router.routerState.snapshot.root))
    ),
    { initialValue: [] as RouteData[] }
  );
}
```

---

## Check C — Lazy-loading boundaries in nested feature routes (RTA-003)

### Detection
1. Map the route tree depth for each feature area. Identify any nested child route set
   (2+ levels deep) that is imported eagerly via a top-level array literal rather than
   `loadChildren`/`loadComponent`.
2. Flag a feature whose entire sub-tree (list, detail, edit, nested tabs) is statically imported
   into the root route config — this forces the whole feature into the initial/eagerly-loaded
   bundle regardless of whether the user ever navigates there.
3. Confirm each top-level feature boundary uses `loadChildren: () => import('./feature.routes')`
   (or per-route `loadComponent`) so bundle splitting occurs at a natural feature seam.

### BAD — entire nested feature tree statically imported at the root
```typescript
// app.routes.ts
import { OrdersListComponent } from './features/orders/orders-list.component';
import { OrderDetailComponent } from './features/orders/order-detail.component';
import { OrderLineItemsComponent } from './features/orders/order-line-items.component';
import { OrderShipmentsComponent } from './features/orders/order-shipments.component';

export const routes: Routes = [
  {
    path: 'orders',
    children: [
      { path: '', component: OrdersListComponent },
      {
        path: ':id',
        component: OrderDetailComponent,
        children: [
          { path: 'items', component: OrderLineItemsComponent },
          { path: 'shipments', component: OrderShipmentsComponent }
        ]
      }
    ]
  }
];
```

### GOOD — lazy boundary at the feature seam, nested routes defined in their own file
```typescript
// app.routes.ts
export const routes: Routes = [
  { path: 'orders', loadChildren: () => import('./features/orders/orders.routes').then(m => m.ordersRoutes) }
];
```
```typescript
// features/orders/orders.routes.ts
export const ordersRoutes: Routes = [
  { path: '', loadComponent: () => import('./orders-list.component').then(m => m.OrdersListComponent) },
  {
    path: ':id',
    loadComponent: () => import('./order-detail.component').then(m => m.OrderDetailComponent),
    children: [
      { path: 'items', loadComponent: () => import('./order-line-items.component').then(m => m.OrderLineItemsComponent) },
      { path: 'shipments', loadComponent: () => import('./order-shipments.component').then(m => m.OrderShipmentsComponent) }
    ]
  }
];
```

---

## Check D — Wildcard/redirect strategy for unmatched and unauthorized paths (RTA-004)

### Detection
1. Confirm a top-level `{ path: '**', ... }` route exists rendering a dedicated 404 component,
   not an empty/blank fallback.
2. Confirm routes protected by a permission guard have a defined redirect (e.g. to a 403 page or
   login) when the guard denies access — a guard that returns `false` with no `UrlTree` redirect
   leaves the router on a blank screen with no explanation.
3. Flag any app with no `**` route at all, or a `**` route that just redirects to `/` silently
   (masking genuinely broken links instead of surfacing a 404).

### BAD — no wildcard route; denied guard returns bare false
```typescript
// app.routes.ts — no ** route: unmatched URLs render nothing inside <router-outlet>
export const routes: Routes = [
  { path: 'orders', loadChildren: () => import('./features/orders/orders.routes') }
];
```
```typescript
// permission.guard.ts
export const permissionGuard: CanActivateFn = (route) => {
  return inject(PermissionService).hasPermission(route.data['permissionKey']); // false = blank page
};
```

### GOOD — explicit 404/403 handling
```typescript
// app.routes.ts
export const routes: Routes = [
  { path: 'orders', loadChildren: () => import('./features/orders/orders.routes') },
  { path: '403', loadComponent: () => import('./shared/forbidden.component').then(m => m.ForbiddenComponent) },
  { path: '**', loadComponent: () => import('./shared/not-found.component').then(m => m.NotFoundComponent) }
];
```
```typescript
// permission.guard.ts
export const permissionGuard: CanActivateFn = (route) => {
  const hasPermission = inject(PermissionService).hasPermission(route.data['permissionKey']);
  return hasPermission ? true : inject(Router).createUrlTree(['/403']);
};
```

---

## Check E — Guards applied once at the parent, not per sibling (RTA-005)

### Detection
1. Look for the same `CanActivate` function repeated across multiple sibling route entries that
   share a common parent (e.g. every child under `orders/:id/...` re-declaring the same
   permission guard).
2. Flag this duplication and recommend hoisting the guard to the parent route via `canActivate`
   on the parent, or `canActivateChild` when the parent itself has no component to guard.

### BAD — same guard repeated on every sibling
```typescript
export const ordersRoutes: Routes = [
  { path: 'summary', canActivate: [authGuard], loadComponent: () => import('./summary.component') },
  { path: 'items', canActivate: [authGuard], loadComponent: () => import('./items.component') },
  { path: 'shipments', canActivate: [authGuard], loadComponent: () => import('./shipments.component') }
];
```

### GOOD — guard hoisted once via canActivateChild
```typescript
export const ordersRoutes: Routes = [
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      { path: 'summary', loadComponent: () => import('./summary.component') },
      { path: 'items', loadComponent: () => import('./items.component') },
      { path: 'shipments', loadComponent: () => import('./shipments.component') }
    ]
  }
];
```

---

## Check F — Reacting to param changes between sibling routes (RTA-006)

### Detection
1. Find components read by routes with a dynamic segment (`:id`) that are also reachable via a
   sibling-to-sibling navigation of the *same* route (e.g. a "next order" link that navigates
   from `/orders/1` to `/orders/2` without the component being destroyed/recreated, since Angular
   reuses the component instance by default).
2. Flag any such component that reads `route.snapshot.paramMap.get('id')` only in `ngOnInit` —
   it will show stale data for the new id because `ngOnInit` does not re-run on a same-component
   sibling navigation.
3. Confirm the component instead subscribes to `route.paramMap` (an `Observable`) or uses
   `toSignal(route.paramMap)`/Angular 16+ `withComponentInputBinding()` bound inputs, which do
   update on every navigation.

### BAD — snapshot read once in ngOnInit; stale on sibling navigation
```typescript
export class OrderDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  order?: Order;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!; // captured once, never updates
    this.orderService.getById(id).subscribe(o => this.order = o);
  }
}
```

### GOOD — reactive paramMap subscription (or bound input) reloads on every navigation
```typescript
export class OrderDetailComponent {
  private route = inject(ActivatedRoute);
  private orderService = inject(OrderService);

  id = toSignal(this.route.paramMap.pipe(map(params => params.get('id')!)));
  order = toSignal(
    toObservable(this.id).pipe(switchMap(id => this.orderService.getById(id)))
  );
}
```
```typescript
// Angular 16+: withComponentInputBinding() binds :id directly as a component input,
// which updates automatically on sibling-route navigation
export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes, withComponentInputBinding())]
};
```

---

## Routing architecture checklist

- [ ] Single-entity detail/edit routes use a Resolver rather than a component `ngOnInit` fetch-and-spin
- [ ] Deliberate component-driven fetching (skeleton UX) is documented, not accidental
- [ ] All route `data:` blocks follow one typed `RouteData` shape (title, breadcrumb, icon, permissionKey)
- [ ] A shared title/breadcrumb service reads `data` — no per-component `document.title` hacks
- [ ] Every top-level feature area has a `loadChildren`/`loadComponent` lazy-loading boundary
- [ ] A `**` wildcard route renders a dedicated 404 page
- [ ] Denied permission guards redirect to a 403 page/login, never return bare `false`
- [ ] Guards shared by sibling routes are hoisted to the parent via `canActivate`/`canActivateChild`
- [ ] Components reachable via sibling-route navigation react to `paramMap` changes, not just `ngOnInit` snapshot reads

---

## References

- Angular Router — resolvers: https://angular.dev/guide/routing/common-router-tasks#resolve-dynamic-data-with-the-router
- Angular Router — route data & component input binding: https://angular.dev/api/router/withComponentInputBinding
- Angular Router — lazy loading: https://angular.dev/guide/ngmodules/lazy-loading
- Angular Router — redirect strategies: https://angular.dev/guide/routing/common-router-tasks#displaying-a-404-page
