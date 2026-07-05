---
name: angular-feature-flags
description: Reviews Angular frontend feature-flag usage and its coordination with the backend's `dotnet-feature-flags` (Microsoft.FeatureManagement) evaluation — the same flag key must resolve consistently on both sides of the wire. Flags build-time boolean constants requiring a rebuild to toggle, flag keys that drift from the backend's contracted names, ad-hoc conditionals duplicated across components instead of a centralized service, no fallback when flag evaluation is unreachable, stale 100%-rolled-out flags never removed, and client-side-only gating with no server-side enforcement. Outputs findings with pilot-angular feature-flags standard IDs.
when_to_use: feature flag, feature toggle, environment.ts flag, FeatureFlagService, flag key drift, IFeatureManager frontend, runtime flag evaluation, flag fallback, stale flag cleanup, client-side gating, structural directive flag, canary rollout Angular
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| AFF-001 | P1 | Feature flag hardcoded as a build-time `environment.ts` boolean instead of a runtime-evaluated flag |
| AFF-002 | P0 | Flag key names not contracted with the backend, causing silent desync |
| AFF-003 | P2 | Flag checks scattered as ad-hoc conditionals instead of a centralized service/directive |
| AFF-004 | P1 | No fallback behavior when the flag-evaluation endpoint is unreachable at startup |
| AFF-005 | P2 | Fully-rolled-out flag never removed, leaving permanent dead conditional branches |
| AFF-006 | P0 | Flag-gated UI with no matching server-side enforcement of the same restriction |

---

## Check A — Flag baked into `environment.ts` at build time (AFF-001)

### Detection

Grep `environment.ts`/`environment.prod.ts` for boolean properties like `enableNewCheckout:
true`. Because these values are compiled into the bundle, toggling the flag requires a full
rebuild and redeploy of the SPA — defeating the entire point of feature flagging, which is
to decouple deployment from release. It also means every environment tier (dev/staging/prod)
needs its own bundle just to differ on flag state.

### BAD — compiled-in flag constant

```typescript
// environment.prod.ts
export const environment = {
  production: true,
  enableNewCheckout: false, // toggling this means a full rebuild + redeploy
};

// checkout.component.ts
export class CheckoutComponent {
  showNewFlow = environment.enableNewCheckout;
}
```

### GOOD — runtime-evaluated flag via a shared service

```typescript
@Injectable({ providedIn: 'root' })
export class FeatureFlagService {
  private http = inject(HttpClient);
  private flags = signal<Record<string, boolean>>({});

  async loadFlags(): Promise<void> {
    const flags = await firstValueFrom(this.http.get<Record<string, boolean>>('/api/features'));
    this.flags.set(flags);
  }

  isEnabled(key: string): boolean {
    return this.flags()[key] ?? false;
  }
}
```

```typescript
export class CheckoutComponent {
  private flags = inject(FeatureFlagService);
  showNewFlow = computed(() => this.flags.isEnabled('NewCheckoutFlow'));
}
```

---

## Check B — Flag key drift between frontend and backend (AFF-002)

### Detection

Compare the flag key strings used in Angular (`isEnabled('newCheckout')`) against the keys
configured in the backend's `Microsoft.FeatureManagement` section (reviewed by
`dotnet-feature-flags`, e.g. `"NewCheckoutFlow"`). If the frontend and backend never agree on
a single contracted key name — different casing, abbreviation, or wording — the two systems
silently evaluate two different, unrelated flags. The frontend can show the new UI while the
backend still executes the old code path, or vice versa, with no error raised anywhere.

### BAD — frontend and backend keys don't match

```typescript
// Angular checks "newCheckout"
this.flags.isEnabled('newCheckout');
```

```json
// appsettings.json — backend checks "NewCheckoutFlow"
{ "FeatureManagement": { "NewCheckoutFlow": true } }
```

### GOOD — a single shared key constant, contracted across the stack

```typescript
// shared/feature-flag-keys.ts — mirrors the exact key names in the backend's
// FeatureManagement config reviewed by dotnet-feature-flags
export const FeatureFlagKeys = {
  NewCheckoutFlow: 'NewCheckoutFlow',
} as const;
```

```typescript
this.flags.isEnabled(FeatureFlagKeys.NewCheckoutFlow);
```

Document the shared key list (a `feature-flags.md` or generated contract file) as the single
source of truth both teams update together — never let either side invent its own name.

---

## Check C — Flag checks duplicated ad-hoc across components (AFF-003)

### Detection

Grep templates for repeated `@if (flags.isEnabled('X'))` blocks scattered across many
unrelated components. Each duplicate is a place that can drift out of sync (wrong key typo,
inverted logic) and makes it hard to find every place a flag is referenced when it's time to
clean it up. Centralize into a structural directive or a computed signal exposed once.

### BAD — repeated inline checks

```html
<!-- header.component.html -->
@if (flags.isEnabled('NewCheckoutFlow')) { <a routerLink="/checkout-v2">Checkout</a> }

<!-- cart.component.html -->
@if (flags.isEnabled('NewCheckoutFlow')) { <app-new-checkout-summary /> }

<!-- order-confirmation.component.html -->
@if (flags.isEnabled('NewCheckoutFlow')) { <app-new-confirmation-banner /> }
```

### GOOD — a shared structural directive

```typescript
@Directive({ selector: '[appFeatureFlag]' })
export class FeatureFlagDirective {
  private flags = inject(FeatureFlagService);
  private templateRef = inject(TemplateRef);
  private viewContainer = inject(ViewContainerRef);

  appFeatureFlag = input.required<string>({ alias: 'appFeatureFlag' });

  constructor() {
    effect(() => {
      this.viewContainer.clear();
      if (this.flags.isEnabled(this.appFeatureFlag())) {
        this.viewContainer.createEmbeddedView(this.templateRef);
      }
    });
  }
}
```

```html
<a *appFeatureFlag="'NewCheckoutFlow'" routerLink="/checkout-v2">Checkout</a>
```

---

## Check D — No fallback when flag evaluation is unreachable (AFF-004)

### Detection

Check the app bootstrap path (`APP_INITIALIZER`/`provideAppInitializer`) that loads flags
from `/api/features`. If that call fails (network blip, backend deploy in progress), verify
what happens: does the whole app fail to start, or does every flag silently default to
`true` (exposing unfinished features to all users)? Neither is acceptable — a documented,
conservative default (usually "all flags off" for anything not yet fully rolled out) must be
applied and the app must still boot.

### BAD — unreachable flag endpoint crashes bootstrap, or silently enables everything

```typescript
export function initFlags(flagService: FeatureFlagService) {
  return () => flagService.loadFlags(); // rejected promise blocks app start entirely
}
```

### GOOD — resilient load with a safe default and app still boots

```typescript
@Injectable({ providedIn: 'root' })
export class FeatureFlagService {
  private http = inject(HttpClient);
  private flags = signal<Record<string, boolean>>({});

  async loadFlags(): Promise<void> {
    try {
      const flags = await firstValueFrom(
        this.http.get<Record<string, boolean>>('/api/features').pipe(timeout(3000))
      );
      this.flags.set(flags);
    } catch {
      this.flags.set({}); // isEnabled() defaults to false — conservative, app still boots
    }
  }

  isEnabled(key: string): boolean {
    return this.flags()[key] ?? false;
  }
}
```

```typescript
providers: [
  provideAppInitializer(() => inject(FeatureFlagService).loadFlags()),
]
```

---

## Check E — Fully-rolled-out flag never removed (AFF-005)

### Detection

Check flag ages against the backend rollout state tracked by `dotnet-feature-flags` FF-003.
If a flag has been at 100% for months, both the enabled and legacy branches still sit in
Angular components, and the "old" branch stops being exercised by real users but keeps
getting reviewed and maintained — pure complexity tax with no benefit.

### BAD — legacy branch dead but still compiled and reviewed

```typescript
// NewCheckoutFlow has been 100% enabled for 6 months
showLegacy = computed(() => !this.flags.isEnabled('NewCheckoutFlow'));
```

```html
@if (showLegacy()) {
  <app-legacy-checkout /> <!-- untested dead code path -->
} @else {
  <app-new-checkout />
}
```

### GOOD — flag and dead branch removed once rollout is confirmed stable

```html
<!-- NewCheckoutFlow removed 2026-01-15 after 100% rollout confirmed stable for 30 days -->
<app-new-checkout />
```

---

## Check F — Client-side gating with no server-side enforcement (AFF-006)

### Detection

For any flag that hides a route or UI element, verify the corresponding API endpoint still
enforces the same restriction server-side (via the backend's `IFeatureManager`, per
`dotnet-feature-flags`). Client-side gating is a UX convenience only — the same principle
`angular-security` applies to permission guards. Hiding a button does not stop a user from
calling the API directly with devtools or a saved request.

### BAD — UI hidden but API fully reachable regardless

```html
@if (flags.isEnabled('AdminBulkDelete')) {
  <button (click)="bulkDelete()">Bulk Delete</button>
}
```

```csharp
// No IFeatureManager check here — reachable by anyone who knows the URL
[HttpPost("api/admin/bulk-delete")]
public async Task<IActionResult> BulkDelete() => await _service.BulkDeleteAsync();
```

### GOOD — UI hint backed by a real server-side check

```csharp
[HttpPost("api/admin/bulk-delete")]
public async Task<IActionResult> BulkDelete(IFeatureManager featureManager)
{
    if (!await featureManager.IsEnabledAsync("AdminBulkDelete"))
        return NotFound(); // same flag, enforced where it actually matters
    return Ok(await _service.BulkDeleteAsync());
}
```

The Angular check stays only as a UX affordance — the real gate lives server-side.
