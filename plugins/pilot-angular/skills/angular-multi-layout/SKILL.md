---
name: angular-multi-layout
description: Reviews multi-layout Angular shells (header nav vs sidebar nav, switchable per user/tenant/preference) for a centralized layout component, a layout-selection service, persisted layout preference, responsive sidebar collapse, and a single shared navigation-model consumed by every layout variant.
when_to_use: multi layout, layout switcher, shell component, header layout, sidebar layout, top nav vs sidebar, layout preference, LayoutService, navigation model, responsive sidebar, mobile drawer, collapse sidebar, duplicated nav menu, per-tenant layout, switchable UI shell
applies_to: angular>=17
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| AML-001 | P1 | Layout markup duplicated per page/route instead of one configurable shell component |
| AML-002 | P1 | No layout-selection abstraction (`LayoutService`) — layout branching scattered in templates |
| AML-003 | P2 | Layout preference not persisted — resets on reload |
| AML-004 | P1 | Sidebar layout has no responsive/mobile collapse to an overlay/drawer |
| AML-005 | P2 | Navigation menu data duplicated separately for header and sidebar variants |

---

## Check A — Centralized shell component (AML-001)

### Detection
1. Glob `src/**/*.component.html` for repeated structural blocks containing both a `<nav>`/
   header-style menu markup and a `<router-outlet>` or page-content wrapper appearing in more
   than one top-level page component.
2. Confirm a single shell exists: look for one component (commonly `app-shell`, `layout-shell`,
   or `app.component.html` itself) that contains the `<router-outlet>` all routed pages render
   into, with header/sidebar markup defined exactly once.
3. Flag any top-level routed component that re-implements its own `<header>`/`<nav>` markup
   instead of relying on the shell wrapping it.

### BAD — every page re-implements its own header/nav
```html
<!-- dashboard.component.html -->
<header class="topbar">
  <nav><a routerLink="/dashboard">Dashboard</a><a routerLink="/orders">Orders</a></nav>
</header>
<main><h1>Dashboard</h1></main>
```
```html
<!-- orders.component.html — duplicated header/nav -->
<header class="topbar">
  <nav><a routerLink="/dashboard">Dashboard</a><a routerLink="/orders">Orders</a></nav>
</header>
<main><h1>Orders</h1></main>
```

### GOOD — one shell component, pages render inside its router-outlet
```typescript
// app.routes.ts
export const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: 'dashboard', loadComponent: () => import('./dashboard.component').then(m => m.DashboardComponent) },
      { path: 'orders', loadComponent: () => import('./orders.component').then(m => m.OrdersComponent) }
    ]
  }
];
```
```html
<!-- shell.component.html -->
@if (layout.mode() === 'header') {
  <app-header-layout><router-outlet /></app-header-layout>
} @else {
  <app-sidebar-layout><router-outlet /></app-sidebar-layout>
}
```
```html
<!-- dashboard.component.html — content only, no header/nav markup -->
<h1>Dashboard</h1>
```

---

## Check B — Layout-selection service (AML-002)

### Detection
1. Search for `@if`/`*ngIf` branches on a layout-mode condition (`layoutMode === 'sidebar'`)
   appearing in more than one component template — that is the scattering signal.
2. Confirm a single injectable, signal-based `LayoutService` (or equivalent store) exists as the
   source of truth for the current layout mode, consumed by the shell component only.
3. Flag any component other than the shell that branches on layout mode directly instead of
   simply rendering inside whichever layout the shell picked.

### BAD — layout mode checked ad hoc across components
```typescript
// header.component.ts
export class HeaderComponent {
  layoutMode = localStorage.getItem('layout') ?? 'header';
}
```
```html
<!-- header.component.html -->
@if (layoutMode === 'header') { <app-top-nav /> }
```
```typescript
// settings.component.ts — duplicated logic, easy to drift out of sync
export class SettingsComponent {
  currentLayout = localStorage.getItem('layout') ?? 'header';
  setLayout(mode: string) { localStorage.setItem('layout', mode); location.reload(); }
}
```

### GOOD — single LayoutService as source of truth
```typescript
// layout.service.ts
export type LayoutMode = 'header' | 'sidebar';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly storageKey = 'app.layoutMode';
  private readonly modeSignal = signal<LayoutMode>(this.readInitial());

  readonly mode = this.modeSignal.asReadonly();

  setMode(mode: LayoutMode): void {
    this.modeSignal.set(mode);
    localStorage.setItem(this.storageKey, mode);
  }

  private readInitial(): LayoutMode {
    const stored = localStorage.getItem(this.storageKey);
    return stored === 'sidebar' ? 'sidebar' : 'header';
  }
}
```
```typescript
// settings.component.ts — no duplicated branching, delegates entirely
export class SettingsComponent {
  private layout = inject(LayoutService);
  mode = this.layout.mode;
  choose(mode: LayoutMode) { this.layout.setMode(mode); }
}
```

---

## Check C — Persisted layout preference (AML-003)

### Detection
1. Confirm `LayoutService` (or equivalent) reads its initial value from a persistence source
   (`localStorage`, a user-preferences API, or a resolved route/tenant setting) during
   construction or an app-init hook — not just an in-memory default that resets on reload.
2. If persistence is server-backed (per-user preference stored via API), confirm the value is
   fetched during app initialization (`provideAppInitializer` / `APP_INITIALIZER`) before the
   shell renders, to avoid a layout flash.
3. Flag a `LayoutService` whose signal is seeded with a hardcoded literal and never reads from
   any storage/API on construction.

### BAD — preference lost on every reload
```typescript
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private modeSignal = signal<LayoutMode>('header'); // always resets to 'header'
  readonly mode = this.modeSignal.asReadonly();
  setMode(mode: LayoutMode) { this.modeSignal.set(mode); } // never persisted
}
```

### GOOD — restored from storage on app init, persisted on change
```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => {
      const layout = inject(LayoutService);
      return layout.restore(); // returns a Promise/Observable resolved before first render
    })
  ]
};
```
```typescript
// layout.service.ts
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private http = inject(HttpClient);
  private modeSignal = signal<LayoutMode>('header');
  readonly mode = this.modeSignal.asReadonly();

  async restore(): Promise<void> {
    const pref = await firstValueFrom(this.http.get<UserPreference>('/api/me/preferences'));
    this.modeSignal.set(pref.layoutMode);
  }

  setMode(mode: LayoutMode): void {
    this.modeSignal.set(mode);
    this.http.patch('/api/me/preferences', { layoutMode: mode }).subscribe();
  }
}
```

---

## Check D — Responsive sidebar collapse (AML-004)

### Detection
1. For the sidebar layout variant, confirm a breakpoint observer (CDK `BreakpointObserver`, a
   `matchMedia` signal wrapper, or CSS container queries) drives a collapsed/overlay state below
   a defined viewport width (commonly `<768px`).
2. Confirm the collapsed state renders the sidebar as a dismissible overlay/drawer (with a
   backdrop, `Esc` to close, and focus trapped inside while open) rather than a permanently
   squeezed fixed-width column that pushes content off-screen.
3. Flag any sidebar layout with a fixed `width` and no media query / breakpoint listener at all.

### BAD — fixed-width sidebar with no responsive behavior
```html
<!-- sidebar-layout.component.html -->
<div class="shell">
  <aside class="sidebar">
    <app-nav-menu [items]="navItems()" />
  </aside>
  <main><ng-content /></main>
</div>
```
```scss
.sidebar { width: 260px; flex: none; } // never collapses on mobile viewports
```

### GOOD — breakpoint-driven collapse to an overlay drawer
```typescript
// sidebar-layout.component.ts
@Component({
  selector: 'app-sidebar-layout',
  standalone: true,
  imports: [OverlayModule, NavMenuComponent],
  templateUrl: './sidebar-layout.component.html'
})
export class SidebarLayoutComponent {
  private breakpointObserver = inject(BreakpointObserver);
  isMobile = toSignal(
    this.breakpointObserver.observe('(max-width: 767px)').pipe(map(r => r.matches)),
    { initialValue: false }
  );
  drawerOpen = signal(false);
}
```
```html
<!-- sidebar-layout.component.html -->
@if (isMobile()) {
  <button (click)="drawerOpen.set(true)" aria-label="Open navigation">☰</button>
  @if (drawerOpen()) {
    <div class="backdrop" (click)="drawerOpen.set(false)"></div>
    <aside class="sidebar drawer" cdkTrapFocus cdkTrapFocusAutoCapture>
      <app-nav-menu [items]="navItems()" />
    </aside>
  }
} @else {
  <aside class="sidebar"><app-nav-menu [items]="navItems()" /></aside>
}
<main><ng-content /></main>
```

---

## Check E — Single shared navigation model (AML-005)

### Detection
1. Search for two separate hardcoded menu-item lists — one consumed by the header-layout
   component and one by the sidebar-layout component (or duplicated `@if`/`*ngFor` link lists in
   both templates).
2. Confirm a single navigation-model/config file (route, icon, label, required permission) exists
   and is imported by both layout variants, with each variant only differing in how it *renders*
   the shared list (horizontal vs vertical), not in what data it holds.
3. Flag drift: e.g. a route present in the header's list but missing from the sidebar's list, or
   a permission check present in one but not the other.

### BAD — separate, drifting menu lists per layout
```typescript
// header-layout.component.ts
readonly headerLinks = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/orders', label: 'Orders' }
];
```
```typescript
// sidebar-layout.component.ts — missing permission check present nowhere, list has drifted
readonly sidebarLinks = [
  { path: '/dashboard', label: 'Dashboard', icon: 'home' },
  { path: '/orders', label: 'Orders', icon: 'list' },
  { path: '/admin', label: 'Admin', icon: 'shield' } // added here only, header never updated
];
```

### GOOD — one shared navigation model, consumed by both variants
```typescript
// nav-menu.model.ts
export interface NavItem {
  path: string;
  label: string;
  icon: string;
  requiredPermission?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'home' },
  { path: '/orders', label: 'Orders', icon: 'list' },
  { path: '/admin', label: 'Admin', icon: 'shield', requiredPermission: 'admin:read' }
];
```
```typescript
// nav-menu.component.ts — one presentational component, two render modes
@Component({
  selector: 'app-nav-menu',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './nav-menu.component.html'
})
export class NavMenuComponent {
  items = input.required<NavItem[]>();
  orientation = input<'horizontal' | 'vertical'>('vertical');
  private auth = inject(AuthService);

  visibleItems = computed(() =>
    this.items().filter(i => !i.requiredPermission || this.auth.hasPermission(i.requiredPermission))
  );
}
```
```html
<!-- header-layout.component.html -->
<app-nav-menu [items]="NAV_ITEMS" orientation="horizontal" />

<!-- sidebar-layout.component.html -->
<app-nav-menu [items]="NAV_ITEMS" orientation="vertical" />
```

---

## Multi-layout checklist

- [ ] Exactly one shell component owns header/sidebar markup; pages render only their content inside its `<router-outlet>`
- [ ] A single `LayoutService` (signal-based) is the only source of truth for current layout mode
- [ ] Layout preference is restored from storage/API on app init and persisted on every change
- [ ] Sidebar layout collapses to an overlay/drawer below a defined breakpoint, with focus trap and `Esc` to close
- [ ] Exactly one navigation-model config (route + icon + label + permission) is imported by both header and sidebar variants
- [ ] No component outside the shell branches on layout mode directly
