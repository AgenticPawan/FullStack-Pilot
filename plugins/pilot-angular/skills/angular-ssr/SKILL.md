---
name: angular-ssr
description: Reviews Angular SSR (@angular/ssr) and hydration. Flags SEO-sensitive routes without SSR, browser-only APIs (window, localStorage) unguarded by isPlatformBrowser, missing provideClientHydration(), data fetched twice with no TransferState, prerendering vs per-request SSR conflated, and browser-only libraries imported eagerly. Outputs pilot-angular ssr standard IDs.
when_to_use: SSR, server-side rendering, Angular Universal, angular ssr, hydration, provideClientHydration, isPlatformBrowser, TransferState, prerendering, SSG, static site generation, per-request rendering, window is not defined, document is not defined, ngExpressEngine, ng build ssr, angular.json prerender routes, hybrid rendering
applies_to: angular
---

<!-- Version index:
  @angular/ssr package (replaces @nguniversal)   Angular 17+
  provideClientHydration()                        Angular 16+ (stable 17+)
  Event replay (withEventReplay)                  Angular 17.2+
  Build-time prerendering (SSG) via `ng build`     Angular 17+ (angular.json prerender option)
  Incremental hydration (@defer hydrate triggers)  Angular 19+
-->

## Rule reference

| ID | Standard | Severity |
|----|----------|----------|
| SSR-001 | InternalPolicy | warn |
| SSR-002 | InternalPolicy | block |
| SSR-003 | InternalPolicy | warn |
| SSR-004 | InternalPolicy | warn |
| SSR-005 | InternalPolicy | warn |
| SSR-006 | InternalPolicy | block |

---

## SSR-001 — Public-facing/SEO-sensitive routes with no SSR

### Detection

Check whether marketing pages, product listings, or any route indexed by search engines are
served as a client-rendered-only SPA shell (empty `<app-root></app-root>` in the initial
HTML response). Flag when crawlers and first-paint metrics depend entirely on JavaScript
execution completing client-side.

### BAD — client-only rendering for an SEO-sensitive route

```typescript
// app.config.ts — no server entry point, no SSR build target at all
export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes), provideHttpClient()],
};
```

```html
<!-- Initial HTML delivered to crawlers and users — empty until JS runs -->
<app-root></app-root>
```

### GOOD — SSR configured via @angular/ssr

```bash
ng add @angular/ssr
```

```typescript
// app.config.server.ts
export const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering()],
};

// server.ts — Node server entry, renders full HTML per request for indexed routes
```

```html
<!-- Response body for a crawler or first-time visitor — full markup, no JS required -->
<app-root><header>...</header><main><h1>Acme Corp — Product Catalog</h1>...</main></app-root>
```

---

## SSR-002 — Browser-only API calls with no isPlatformBrowser guard

### Detection

Grep component/service code for direct references to `window`, `document`, `localStorage`,
`navigator`, or `sessionStorage` with no platform check. Flag SSR-002 as a build-breaking
issue — these globals do not exist in the server's Node.js rendering context and throw
`ReferenceError` during server render, taking down the whole SSR response.

### BAD — direct browser API access crashes server render

```typescript
@Component({ selector: 'app-theme-toggle', ... })
export class ThemeToggleComponent {
  ngOnInit() {
    const saved = localStorage.getItem('theme'); // ReferenceError on the server
    this.theme.set(saved ?? 'light');
  }
}
```

### GOOD — isPlatformBrowser guard around browser-only code

```typescript
@Component({ selector: 'app-theme-toggle', ... })
export class ThemeToggleComponent {
  private readonly platformId = inject(PLATFORM_ID);

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      const saved = localStorage.getItem('theme');
      this.theme.set(saved ?? 'light');
    } else {
      this.theme.set('light'); // deterministic default for server-rendered markup
    }
  }
}
```

---

## SSR-003 — No hydration configured (destroy-and-rebuild instead of hydrate)

### Detection

Check `app.config.ts` for `provideClientHydration()`. Flag SSR-003 when SSR is configured
but this provider is missing — without it, Angular discards the server-rendered DOM entirely
and the client re-renders from scratch, causing a visible flash and defeating SSR's
first-paint benefit (the browser still does full client-side work, just after an extra
round trip).

### BAD — SSR configured, hydration not enabled

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes), provideHttpClient()],
  // No provideClientHydration() — server HTML is thrown away and rebuilt client-side.
};
```

### GOOD — hydration enabled, with event replay for interactions during hydration

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    provideClientHydration(withEventReplay()), // reuses server DOM; queues clicks during hydration
  ],
};
```

---

## SSR-004 — Data fetched twice with no TransferState

### Detection

Check whether a data-fetching resolver/service call made during server render is repeated
by the client immediately after bootstrap. Flag SSR-004 when there is no `TransferState`
(or `HttpClient`'s built-in transfer-state cache) bridging the two — the app pays for the
same API call twice: once on the server, once again on the client.

### BAD — the same API call runs on both server and client

```typescript
// product-list.component.ts
ngOnInit() {
  this.http.get<Product[]>('/api/products').subscribe(p => this.products.set(p));
  // Runs during SSR to build the initial HTML, then runs again client-side after
  // hydration — the client repeats a network call whose result the server already had.
}
```

### GOOD — TransferState carries the server-fetched result to the client

```typescript
// Angular's HttpClient does this automatically when both providers are present:
export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(withFetch()),
    provideClientHydration(), // together, these cache SSR HTTP responses in TransferState
  ],
};
// The client-side HttpClient reads the cached response instead of re-issuing the request —
// no application code change needed beyond enabling both providers.
```

```typescript
// Manual TransferState for a non-HTTP computed value (e.g. a resolver's derived result)
const PRODUCTS_KEY = makeStateKey<Product[]>('products');

// product.resolver.ts (runs on both server and client)
export const productsResolver: ResolveFn<Product[]> = () => {
  const transferState = inject(TransferState);
  const http = inject(HttpClient);

  if (transferState.hasKey(PRODUCTS_KEY)) {
    const products = transferState.get(PRODUCTS_KEY, []);
    transferState.remove(PRODUCTS_KEY); // consume once, avoid a stale cache on navigation
    return of(products);
  }

  return http.get<Product[]>('/api/products').pipe(
    tap(products => transferState.set(PRODUCTS_KEY, products)),
  );
};
```

---

## SSR-005 — No distinction between build-time prerendering and per-request SSR

### Detection

Check `angular.json`/`app.routes.server.ts` for a `RenderMode` assigned per route. Flag
SSR-005 when every route uses full per-request `RenderMode.Server` regardless of whether its
content is static (marketing pages, docs) or genuinely dynamic (a per-user dashboard) — the
static routes pay server compute on every request for content that could be built once at
deploy time and served as a static file.

### BAD — every route rendered per-request, including fully static pages

```typescript
// app.routes.server.ts
export const serverRoutes: ServerRoute[] = [
  { path: '**', renderMode: RenderMode.Server }, // even /about and /pricing hit the Node server every request
];
```

### GOOD — static routes prerendered at build time, dynamic routes rendered per request

```typescript
// app.routes.server.ts
export const serverRoutes: ServerRoute[] = [
  { path: 'about', renderMode: RenderMode.Prerender },      // built once, served as a static file
  { path: 'pricing', renderMode: RenderMode.Prerender },
  { path: 'dashboard', renderMode: RenderMode.Server },     // per-user data, must render per request
  { path: 'products/:id', renderMode: RenderMode.Server },  // dynamic content, changes frequently
  { path: '**', renderMode: RenderMode.Client },            // fallback: client-only for the rest
];
```

---

## SSR-006 — Browser-only third-party libraries imported eagerly at the top level

### Detection

Grep top-level imports for libraries known to assume `window`/`document` at module-load
time (charting libraries, map widgets, rich-text editors). Flag SSR-006 when such an import
sits at the top of a component file rather than behind a dynamic `import()` gated to the
browser — an eager import breaks the server bundle even if the component itself never
renders during SSR.

### BAD — chart library imported eagerly, breaks the server bundle at module load

```typescript
import Chart from 'chart.js/auto'; // executes browser-assuming code at import time

@Component({ selector: 'app-sales-chart', ... })
export class SalesChartComponent implements AfterViewInit {
  ngAfterViewInit() {
    new Chart(this.canvasRef.nativeElement, { type: 'bar', data: this.data });
  }
}
```

### GOOD — dynamic import gated to the browser platform

```typescript
@Component({ selector: 'app-sales-chart', ... })
export class SalesChartComponent implements AfterViewInit {
  private readonly platformId = inject(PLATFORM_ID);

  async ngAfterViewInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    const { default: Chart } = await import('chart.js/auto'); // loaded only in the browser
    new Chart(this.canvasRef.nativeElement, { type: 'bar', data: this.data });
  }
}
```

```typescript
// Alternative: defer the whole component to the browser using @defer (Angular 17+)
// template:
// @defer (on viewport; hydrate on viewport) {
//   <app-sales-chart [data]="salesData()" />
// } @placeholder {
//   <div class="chart-skeleton"></div>
// }
```

---

## Angular SSR checklist

- [ ] Every public-facing/SEO-sensitive route is server-rendered or prerendered, not client-only
- [ ] No component/service references `window`, `document`, `localStorage`, or `navigator` without an `isPlatformBrowser` guard
- [ ] `provideClientHydration()` is present wherever SSR is configured
- [ ] `withEventReplay()` is enabled so user interactions during hydration are not dropped
- [ ] HTTP calls made during SSR are not re-issued by the client — `TransferState` (automatic via HttpClient, or manual) bridges them
- [ ] Static/rarely-changing routes use `RenderMode.Prerender`; only genuinely dynamic routes use `RenderMode.Server`
- [ ] Browser-only third-party libraries are dynamically imported behind a platform check or `@defer`, never imported eagerly at the top level
- [ ] The server bundle builds and runs without throwing on any configured route

---

## References

- Angular SSR guide: https://angular.dev/guide/ssr
- Hydration: https://angular.dev/guide/hydration
- `@defer` incremental hydration: https://angular.dev/guide/defer
- TransferState: https://angular.dev/api/core/TransferState
- Prerendering (SSG): https://angular.dev/guide/prerendering
