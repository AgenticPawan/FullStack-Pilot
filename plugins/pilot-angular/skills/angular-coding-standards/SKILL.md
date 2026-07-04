---
name: angular-coding-standards
description: General Angular coding-standards enforcement — naming conventions, standalone-first architecture (v17+), service extraction for business logic, strict TypeScript compiler options, barrel-file risk, and signal-based input()/output() adoption (v17.1+). Version-gated checks read .claude/pilot/stack-profile.json (angular.majorVersion) when present; otherwise ask or infer from angular.json/package.json.
when_to_use: coding standards, naming convention, file naming, kebab-case, NgModule, standalone component, feature module, service extraction, business logic in component, strict mode, strictTemplates, tsconfig, barrel file, index.ts re-export, circular import, input decorator, output decorator, signal input
applies_to: angular>=15
---

<!-- Version index:
  Standalone components/directives/pipes   Angular 15+ (opt-in), default schematic Angular 17+
  input() / output() signal functions      Angular 17.1+ (stable Angular 17.3+)
  strictTemplates                          Angular 15+ (Ivy default)
-->

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ACS-001 | P2 | File/class naming deviates from Angular style guide (suffix, casing) |
| ACS-002 | P1 | NgModule-based feature module used on a v17+ project instead of standalone |
| ACS-003 | P1 | Business logic embedded in component class instead of an injectable service |
| ACS-004 | P1 | Strict TypeScript compiler options missing or disabled |
| ACS-005 | P2 | Barrel file (`index.ts`) creates circular-import risk or import-cost bloat |
| ACS-006 | P2 | `@Input()`/`@Output()` used on new v17.1+ components instead of `input()`/`output()` |

**Version gating:** before applying ACS-002 or ACS-006, read `.claude/pilot/stack-profile.json` →
`angular.majorVersion` (and minor if recorded). If the file is absent, fall back to
`dependencies["@angular/core"]` in `package.json`. Do not flag ACS-002 on v15/v16 — NgModules are
still the expected default there. Do not flag ACS-006 below v17.1.

---

## Check A — File and class naming (ACS-001)

### Detection
1. Glob `src/**/*.ts` excluding `*.spec.ts`.
2. For each file, confirm the filename is kebab-case and ends in the type suffix matching its
   decorator: `*.component.ts` for `@Component`, `*.service.ts` for `@Injectable` business
   services, `*.directive.ts` for `@Directive`, `*.pipe.ts` for `@Pipe`, `*.guard.ts` for
   `CanActivate`/functional guards, `*.resolver.ts` for resolvers.
3. Confirm the exported class name is PascalCase and ends with the matching suffix
   (`UserProfileComponent`, `AuthService`), not abbreviated (`UsrPrflCmp`) or suffix-free
   (`UserProfile`).
4. Flag mismatches between filename and class suffix (e.g. `user-profile.ts` exporting
   `UserProfileComponent`).

### BAD — inconsistent naming
```typescript
// File: userProfile.ts  (camelCase filename, no suffix, no type suffix on class)
@Component({
  selector: 'app-user-profile',
  templateUrl: './userProfile.html'
})
export class UserProfile {}
```

### GOOD — Angular style guide naming
```typescript
// File: user-profile.component.ts
@Component({
  selector: 'app-user-profile',
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.scss'
})
export class UserProfileComponent {}
```

---

## Check B — Standalone-first architecture on Angular 17+ (ACS-002)

### Detection
1. Read `.claude/pilot/stack-profile.json` → `angular.majorVersion`. If `< 17`, skip this check
   entirely (NgModule feature modules are the expected pattern on v15/v16).
2. On v17+, glob `src/**/*.module.ts` excluding `app.module.ts` migration remnants already
   flagged elsewhere.
3. For each feature module found, check whether its declared components/directives/pipes set
   `standalone: true` (or omit `standalone` on v19+, where it defaults to `true`) — if not, and
   the module exists purely to declare/export a feature area, flag it as a new-project deviation.
4. New route entries added via `loadChildren: () => import('./feature/feature.module')` on a
   v17+ project are a strong signal of a newly-authored NgModule; prioritize those.

### BAD — new NgModule feature module on Angular 18 project
```typescript
// orders.module.ts — newly added, project is on Angular 18
@NgModule({
  declarations: [OrdersListComponent, OrderDetailComponent],
  imports: [CommonModule, RouterModule.forChild(ordersRoutes)],
  exports: [OrdersListComponent]
})
export class OrdersModule {}
```

### GOOD — standalone components with lazy routes
```typescript
// orders.routes.ts
export const ordersRoutes: Routes = [
  { path: '', loadComponent: () =>
      import('./orders-list.component').then(m => m.OrdersListComponent) },
  { path: ':id', loadComponent: () =>
      import('./order-detail.component').then(m => m.OrderDetailComponent) }
];
```
```typescript
// orders-list.component.ts
@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './orders-list.component.html'
})
export class OrdersListComponent {}
```

---

## Check C — Business logic extracted to services (ACS-003)

### Detection
1. Scan component class bodies (`*.component.ts`) for methods containing: `HttpClient` calls,
   multi-step data transformation (`.filter().map().reduce()` chains over domain data), direct
   `localStorage`/`sessionStorage` access, or validation/calculation logic longer than ~10 lines.
2. Flag components with no corresponding injected `*Service` where such logic appears directly
   in a component method rather than delegated.
3. A component may keep *presentation* logic (formatting a value already computed by a service,
   deriving a computed signal from `@Input`) — only flag domain/business logic and I/O.

### BAD — pricing logic and HTTP call inside the component
```typescript
@Component({ selector: 'app-cart-summary', standalone: true, templateUrl: './cart-summary.component.html' })
export class CartSummaryComponent {
  private http = inject(HttpClient);
  items = input.required<CartItem[]>();

  submitOrder() {
    const subtotal = this.items().reduce((sum, i) => sum + i.price * i.qty, 0);
    const discount = subtotal > 100 ? subtotal * 0.1 : 0;
    const tax = (subtotal - discount) * 0.08;
    const total = subtotal - discount + tax;

    this.http.post('/api/orders', { items: this.items(), total }).subscribe();
  }
}
```

### GOOD — logic delegated to an injectable service
```typescript
@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);

  calculateTotal(items: CartItem[]): OrderTotal {
    const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const discount = subtotal > 100 ? subtotal * 0.1 : 0;
    const tax = (subtotal - discount) * 0.08;
    return { subtotal, discount, tax, total: subtotal - discount + tax };
  }

  submitOrder(items: CartItem[], total: OrderTotal) {
    return this.http.post('/api/orders', { items, total });
  }
}
```
```typescript
@Component({ selector: 'app-cart-summary', standalone: true, templateUrl: './cart-summary.component.html' })
export class CartSummaryComponent {
  private orderService = inject(OrderService);
  items = input.required<CartItem[]>();
  total = computed(() => this.orderService.calculateTotal(this.items()));

  submitOrder() {
    this.orderService.submitOrder(this.items(), this.total()).subscribe();
  }
}
```

---

## Check D — Strict TypeScript compiler options (ACS-004)

### Detection
1. Read `tsconfig.json` (base) → `compilerOptions.strict` must be `true`.
2. Read `angular.json` → each project's `architect.build.options.tsConfig` target file →
   confirm `angularCompilerOptions.strictTemplates` is `true` (Ivy defaults it to `true`
   starting with `strict: true`, but explicit config drift can disable it).
3. Flag any `tsconfig*.json` that overrides `strict: false` or individually disables
   `strictNullChecks`/`noImplicitAny` in a way that weakens the base config.

### BAD — strict mode disabled
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": false,
    "noImplicitAny": false
  },
  "angularCompilerOptions": {
    "strictTemplates": false
  }
}
```

### GOOD — strict mode enforced end to end
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "angularCompilerOptions": {
    "strictTemplates": true,
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true
  }
}
```

---

## Check E — Barrel files and circular-import risk (ACS-005)

### Detection
1. Glob `src/**/index.ts`.
2. For each barrel, list its re-exports (`export * from './x'` / `export { X } from './x'`).
3. Flag a barrel as high-risk when: (a) it re-exports more than ~15 symbols from a single
   feature area (import-cost bloat — consumers pull in the whole feature graph for one symbol),
   or (b) a file inside the same feature directory imports from the barrel that re-exports
   itself (`./index`), which is the classic circular-import trigger during bundling/tree-shaking.
4. Prefer deep imports for cross-feature consumption; barrels are acceptable only at a stable,
   narrow public-API boundary (e.g. a shared UI-kit library entry point).

### BAD — feature-wide barrel imported from within the same feature
```typescript
// features/orders/index.ts
export * from './orders-list.component';
export * from './order-detail.component';
export * from './order.service';
export * from './order.model';
export * from './order-status.pipe';
// ...12 more re-exports
```
```typescript
// features/orders/order-detail.component.ts
import { OrderService } from './index';   // circular: index.ts re-exports this same directory
```

### GOOD — deep imports within the feature, narrow barrel only at the public boundary
```typescript
// features/orders/order-detail.component.ts
import { OrderService } from './order.service';
import { OrderStatusPipe } from './order-status.pipe';
```
```typescript
// libs/ui-kit/index.ts — narrow, stable public API, not consumed by its own internals
export { ButtonComponent } from './button/button.component';
export { CardComponent } from './card/card.component';
```

---

## Check F — Signal-based input()/output() on Angular 17.1+ (ACS-006)

### Detection
1. Read `.claude/pilot/stack-profile.json` → `angular.majorVersion` (and minor if available).
   Skip this check below v17.1 — `input()`/`output()` did not exist yet.
2. Scan newly added or modified `*.component.ts` files for `@Input()` / `@Output()` decorators.
3. Flag decorator usage in **new** components on v17.1+ projects; do not require migrating
   pre-existing decorator-based components wholesale (that is the `angular-upgrade-path` skill's
   concern) — this check targets newly authored code.

### BAD — decorator-based I/O in a new component on Angular 18
```typescript
@Component({ selector: 'app-badge', standalone: true, templateUrl: './badge.component.html' })
export class BadgeComponent {
  @Input() label = '';
  @Input({ required: true }) count!: number;
  @Output() dismissed = new EventEmitter<void>();

  dismiss() {
    this.dismissed.emit();
  }
}
```

### GOOD — signal-based input()/output()
```typescript
@Component({ selector: 'app-badge', standalone: true, templateUrl: './badge.component.html' })
export class BadgeComponent {
  label = input('');
  count = input.required<number>();
  dismissed = output<void>();

  dismiss() {
    this.dismissed.emit();
  }
}
```

---

## Coding standards checklist

- [ ] File names are kebab-case with the correct type suffix; class names are PascalCase with matching suffix
- [ ] No new NgModule feature modules on Angular 17+ projects (check `angular.majorVersion` first)
- [ ] Business/domain logic and HTTP calls live in injectable services, not component classes
- [ ] `tsconfig.json` has `"strict": true`; `angularCompilerOptions.strictTemplates` is `true`
- [ ] Barrel files are narrow (public API only) and not imported from within their own feature directory
- [ ] New components on Angular 17.1+ use `input()`/`output()` instead of `@Input()`/`@Output()`
