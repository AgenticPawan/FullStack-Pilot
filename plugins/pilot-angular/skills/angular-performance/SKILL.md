---
name: angular-performance
description: "Angular rendering performance: OnPush change detection, zoneless (v18+ experimental, v20 stable), @for with track (v17+), deferrable views with @defer triggers (v17+), lazy-loaded routes, bundle budget configuration in angular.json, and NgOptimizedImage for LCP (v15+)."
when_to_use: performance, change detection, OnPush, zoneless, @defer, lazy loading, code splitting, bundle size, budget, NgOptimizedImage, LCP, track expression, defer block, slow rendering, initial load, core web vitals
applies_to: angular>=17
---

<!-- Version index:
  ChangeDetectionStrategy.OnPush  all Angular versions
  NgOptimizedImage                Angular 15+  (@angular/common)
  @for ... track                  Angular 17+
  @defer                          Angular 17+
  provideExperimentalZonelessChangeDetection  Angular 18+
  provideZonelessChangeDetection  Angular 20+ (renamed, stable)
  Incremental hydration (@defer hydrate)  Angular 19+
-->

## Change detection strategy

**Default rule: every new component gets `ChangeDetectionStrategy.OnPush`.**

OnPush limits re-renders to signal/input changes and explicit `markForCheck()` calls.

### BAD — Default change detection spams re-renders

```typescript
@Component({
  // No changeDetection specified → Default → re-renders on every browser event
  template: `<p>{{ expensive() }}</p>`
})
export class ListComponent { }
```

### GOOD — OnPush limits rendering

```typescript
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>{{ expensive() }}</p>`
})
export class ListComponent { }
```

With signals, the component renders only when a consumed signal changes — even without
explicit `markForCheck()`.

---

## Zoneless change detection (Angular 18+ experimental; stable Angular 20)

**Use when:** migrating away from zone.js for fine-grained rendering and smaller bundles.

```typescript
// app.config.ts — Angular 18+ (experimental name):
import { provideExperimentalZonelessChangeDetection } from '@angular/core';

// Angular 20+ (stable, renamed):
import { provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection()   // remove zone.js from polyfills too
  ]
};
```

**Remove zone.js from `angular.json` polyfills** when enabling zoneless:
```json
{ "polyfills": [] }   // was: ["zone.js"]
```

**All change detection must then be signal-driven or via `markForCheck()`** — imperative
mutations to class properties no longer trigger re-renders.

---

## @for with track (Angular 17+)

`@for` requires a `track` expression. A poor track expression causes full list re-render.

### BAD — track by index (re-creates all DOM nodes on sort/filter)

```html
@for (item of items(); track $index) {
  <app-item [data]="item" />
}
```

### GOOD — track by stable identity

```html
@for (item of items(); track item.id) {
  <app-item [data]="item" />
}
```

**When there is no stable ID:** generate one server-side or use a `Map` to assign stable
keys before binding. Do not use `Math.random()` as a track expression.

---

## Deferrable views with @defer (Angular 17+)

`@defer` splits heavy components into separate lazy chunks loaded on demand.

### Basic syntax with triggers

```html
<!-- Load when browser is idle (default trigger) -->
@defer {
  <app-analytics-dashboard />
} @placeholder {
  <div class="skeleton" aria-busy="true" aria-label="Loading dashboard…"></div>
} @loading (minimum 200ms) {
  <app-spinner />
} @error {
  <p>Dashboard failed to load.</p>
}
```

### All trigger types

```html
@defer (on viewport)       { <app-comments /> }      <!-- enters viewport -->
@defer (on interaction)    { <app-ratings /> }       <!-- click or keydown -->
@defer (on hover)          { <app-preview /> }       <!-- mouseover / focusin -->
@defer (on idle)           { <app-ads /> }           <!-- requestIdleCallback -->
@defer (on immediate)      { <app-chat /> }          <!-- as soon as non-deferred renders -->
@defer (on timer(2s))      { <app-survey /> }        <!-- after 2 seconds -->

<!-- Prefetch early, render later -->
@defer (on interaction; prefetch on idle) {
  <app-editor />
}
```

### BAD — eager loading of heavy, below-fold component

```html
<!-- Loaded in the main bundle even if user never scrolls down -->
<app-data-table [rows]="allRows" />
```

### GOOD — defer below-fold content

```html
@defer (on viewport) {
  <app-data-table [rows]="allRows()" />
} @placeholder (minimum 50ms) {
  <div style="height: 400px" aria-hidden="true"></div>
}
```

---

## Lazy-loaded routes

```typescript
// app.routes.ts
export const routes: Routes = [
  { path: 'dashboard', loadComponent: () =>
      import('./dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'admin', loadChildren: () =>
      import('./admin/admin.routes').then(m => m.adminRoutes) }
];
```

**Do not import heavy components in the root `app.component.ts` imports array** if they
are only needed behind a route — that defeats lazy loading.

---

## NgOptimizedImage (Angular 15+)

Replace `<img>` with `NgOptimizedImage` for LCP images.

### BAD — plain img for hero image

```html
<img src="/hero.jpg" alt="Hero">
```

### GOOD — NgOptimizedImage with priority

```typescript
import { NgOptimizedImage } from '@angular/common';
// add NgOptimizedImage to component imports array
```

```html
<!-- priority marks this as an LCP candidate — adds fetchpriority="high" + preload -->
<img ngSrc="/hero.jpg" alt="Hero image" width="1200" height="600" priority>

<!-- Non-LCP images -->
<img ngSrc="/thumbnail.jpg" alt="Product thumbnail" width="200" height="200">
```

`width` and `height` are required — they prevent layout shift (CLS).

**Image loaders** (remove full domain from `ngSrc`):
```typescript
// app.config.ts
providers: [
  provideImgixLoader('https://myproject.imgix.net'),
  // or: provideCloudflareLoader, provideCloudinaryLoader, provideImageKitLoader
]
```

---

## Bundle budgets in angular.json

Set budgets to fail the build on regression:

```json
{
  "configurations": {
    "production": {
      "budgets": [
        {
          "type": "initial",
          "maximumWarning": "500kb",
          "maximumError": "1mb"
        },
        {
          "type": "anyComponentStyle",
          "maximumWarning": "4kb",
          "maximumError": "8kb"
        }
      ]
    }
  }
}
```

Run `ng build --stats-json` and use `npx webpack-bundle-analyzer dist/stats.json` to
identify oversized chunks.

---

## Performance checklist

- [ ] All new components use `ChangeDetectionStrategy.OnPush`
- [ ] Zoneless enabled for greenfield projects on Angular 20 (`provideZonelessChangeDetection`)
- [ ] Every `@for` block has a stable `track` expression (not `$index` for sorted/filtered lists)
- [ ] Hero/above-fold `<img>` tags use `NgOptimizedImage` with `priority` attribute
- [ ] All `<img>` tags have explicit `width` and `height` to prevent CLS
- [ ] Heavy below-fold components wrapped in `@defer (on viewport)`
- [ ] Route-level components loaded via `loadComponent` / `loadChildren`
- [ ] Bundle size budgets set in `angular.json` — build fails on overage
- [ ] `ng build --stats-json` analysed before shipping a new lazy route
- [ ] `@defer @loading` blocks include accessible loading state (`aria-busy`)
