---
name: angular-signals-and-state
description: Guides signal-based state design in Angular 17–20. Covers signal()/computed()/effect() patterns, when RxJS still wins, toSignal()/toObservable() interop (v16+), linkedSignal() (stable v20), and resource()/httpResource() async data (stable v20 / experimental v19.2).
when_to_use: signals, computed signal, effect, state management, RxJS vs signals, toSignal, linkedSignal, resource API, reactive state, signal store, ngrx signals, writable computed, async signal, signal input
applies_to: angular>=17
---

<!-- Version index:
  signal/computed/effect    stable Angular 17 (developer preview 16)
  toSignal / toObservable   Angular 16+  (@angular/rxjs-interop)
  input() / output()        stable Angular 19 (developer preview 17.1)
  linkedSignal()            stable Angular 20 (developer preview 19)
  resource() / rxResource() stable Angular 20 (developer preview 19)
  httpResource()            experimental Angular 19.2+
-->

## Core signal primitives

**Prefer signals for local and shared synchronous state.** Use `signal()` for mutable values, `computed()` for derived values that auto-update, and `effect()` only for side-effects that cannot be expressed reactively (e.g., writing to third-party DOM APIs).

### BAD — class properties with manual change notifications

```typescript
@Component({ changeDetection: ChangeDetectionStrategy.OnPush })
export class CartComponent {
  items: Product[] = [];          // plain array — no reactive tracking
  total = 0;

  addItem(p: Product) {
    this.items = [...this.items, p];
    this.total = this.items.reduce((s, x) => s + x.price, 0);  // manual sync
    this.cdr.markForCheck();       // manual notification
  }
}
```

### GOOD — signals with derived computed value (Angular 17+)

```typescript
@Component({ changeDetection: ChangeDetectionStrategy.OnPush })
export class CartComponent {
  items = signal<Product[]>([]);
  total = computed(() => this.items().reduce((s, x) => s + x.price, 0));

  addItem(p: Product) {
    this.items.update(list => [...list, p]);  // computed() updates automatically
  }
}
```

---

## Signal inputs and outputs (stable Angular 19; developer preview 17.1)

### BAD — decorator-based @Input with ngOnChanges

```typescript
@Component({})
export class PriceComponent {
  @Input() price = 0;             // triggers ngOnChanges, not reactive
  @Input() currency = 'USD';
  formatted = '';

  ngOnChanges() {
    this.formatted = `${this.currency} ${this.price.toFixed(2)}`;
  }
}
```

### GOOD — signal input with computed (Angular 17.1+, stable 19)

```typescript
@Component({})
export class PriceComponent {
  price    = input.required<number>();
  currency = input('USD');
  formatted = computed(() =>
    `${this.currency()} ${this.price().toFixed(2)}`
  );
}
```

---

## When RxJS still wins

Use RxJS (and bridge to signals with `toSignal`) for:

| Scenario | Why RxJS |
|----------|----------|
| WebSocket / SSE streams | Multicast, backpressure, `share()` |
| Debounced search input | `debounceTime` + `distinctUntilChanged` |
| Complex operator chains | `switchMap`, `mergeMap`, `combineLatest` |
| `HttpClient` calls (non-resource) | Returns `Observable` — wrap at the boundary |
| Global event buses | Subjects as pub/sub |

### BAD — effect() used to bridge Observable into signal

```typescript
// Anti-pattern: creates a tight coupling and timing issues
private result = signal<Data | null>(null);

constructor() {
  effect(() => {
    this.http.get<Data>('/api/data').subscribe(d => this.result.set(d));
    // new subscription every time the effect re-runs!
  });
}
```

### GOOD — toSignal() bridges at the boundary (Angular 16+)

```typescript
import { toSignal } from '@angular/core/rxjs-interop';

@Component({})
export class SearchComponent {
  private query$ = new Subject<string>();

  results = toSignal(
    this.query$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => this.http.get<Result[]>(`/api/search?q=${q}`))
    ),
    { initialValue: [] }
  );

  search(q: string) { this.query$.next(q); }
}
```

---

## Async data with resource() (stable Angular 20; developer preview 19)

Use `resource()` for signal-driven async operations that reload when dependencies change.

```typescript
import { resource } from '@angular/core';

@Component({})
export class ProductComponent {
  productId = input.required<number>();

  product = resource({
    request: () => ({ id: this.productId() }),
    loader: ({ request }) =>
      fetch(`/api/products/${request.id}`).then(r => r.json())
  });
  // product.value()   — current data signal
  // product.isLoading() — loading state signal
  // product.error()   — error state signal
}
```

Use `httpResource()` (experimental Angular 19.2+) when you want the same pattern but backed by `HttpClient` interceptors:

```typescript
import { httpResource } from '@angular/core';

product = httpResource<Product>(() => `/api/products/${this.productId()}`);
```

**Note:** `httpResource()` remains experimental as of Angular 20. Verify stability before production use.

---

## linkedSignal() — writable computed (stable Angular 20; developer preview 19)

Use when derived state needs both automatic reset AND manual overrides.

```typescript
import { linkedSignal } from '@angular/core';

@Component({})
export class PaginationComponent {
  pageSize  = signal(10);
  // resets to 0 whenever pageSize changes; can also be set manually
  pageIndex = linkedSignal(() => 0);

  goToPage(n: number) { this.pageIndex.set(n); }
}
```

---

## effect() rules

1. **Do not write to signals inside `effect()`** — use `computed()` instead.
2. **Do not trigger HTTP calls inside `effect()`** — use `resource()` or `toSignal()`.
3. Effects run after rendering; do not rely on them for synchronous data flow.
4. Cleanup: return a cleanup function or use `DestroyRef` if the effect manages external resources.

```typescript
// Acceptable effect: sync to a third-party chart library
effect(() => {
  const data = this.chartData();     // reactive dependency
  this.chart.update(data);           // non-Angular side effect
});
```

---

## Checklist

- [ ] Local mutable state → `signal()`; derived state → `computed()`
- [ ] `@Input()` on new components → `input()` / `input.required()` (v17.1+, stable v19)
- [ ] `@Output()` on new components → `output()` (v17.1+, stable v19)
- [ ] RxJS Observable passed to template → bridge with `toSignal()` or `async` pipe
- [ ] Async data driven by signal → `resource()` (v20) or `httpResource()` (experimental v19.2)
- [ ] Derived state that can also be overridden → `linkedSignal()` (v20)
- [ ] `effect()` does not write signals and does not make HTTP calls
