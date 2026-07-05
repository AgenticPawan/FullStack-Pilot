---
name: angular-ngrx-state
description: Governs classic NgRx Store/Effects usage in large or legacy Angular codebases and when NgRx is still the right call versus Signals covered by `angular-signals-and-state`. Flags full NgRx boilerplate for simple local state, unmemoized selectors recomputing on every emission, Effects with no catchError killing the whole effects stream, direct store.subscribe() reintroducing manual subscription management, eagerly-registered root state instead of lazy feature state, and no documented policy for NgRx/Signals coexistence. Outputs findings with pilot-angular ngrx-state standard IDs.
when_to_use: NgRx, Store, Effects, createSelector, memoized selector, store.subscribe, provideState, forFeature, StoreModule.forRoot, reducer, action, NgRx vs signals, signal store, legacy state management, effects catchError
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| NGRX-001 | P2 | Full NgRx boilerplate used for simple local component state that a signal would handle |
| NGRX-002 | P1 | Selectors not memoized via `createSelector`, recomputing on every store emission |
| NGRX-003 | P0 | Effect with no `catchError`, silently killing the entire effects stream on error |
| NGRX-004 | P1 | Component subscribes to the store directly instead of `async` pipe or `toSignal()` |
| NGRX-005 | P2 | Feature state registered eagerly at root instead of lazy-loaded via `provideState` |
| NGRX-006 | P2 | No documented policy for teams running NgRx and Signals side by side |

---

## Check A — Full NgRx boilerplate for simple local state (NGRX-001)

### Detection

Check whether a new feature adds an action, reducer, effect, and selector purely to hold
state that only one component (or a small subtree) cares about — a dropdown's open/closed
state, a form's dirty flag, a modal's visibility. This ceremony (four+ files, action-type
strings, dispatch boilerplate) buys nothing over a local `signal()` when nothing outside the
component tree needs to read or react to that state. Reserve NgRx for state that is genuinely
cross-cutting, shared across distant parts of the tree, or needs time-travel debugging. See
`angular-signals-and-state` for the local-state-first guidance this complements.

### BAD — NgRx boilerplate for a component-local toggle

```typescript
// actions
export const togglePanel = createAction('[Settings] Toggle Panel');

// reducer
export const settingsReducer = createReducer(
  initialState,
  on(togglePanel, state => ({ ...state, panelOpen: !state.panelOpen }))
);

// selector
export const selectPanelOpen = createSelector(selectSettingsState, s => s.panelOpen);

// component — dispatches/selects the store for a value nothing else uses
export class SettingsComponent {
  private store = inject(Store);
  panelOpen = this.store.selectSignal(selectPanelOpen);
  toggle() { this.store.dispatch(togglePanel()); }
}
```

### GOOD — a local signal, no store involvement

```typescript
export class SettingsComponent {
  panelOpen = signal(false);
  toggle() { this.panelOpen.update(open => !open); }
}
```

Keep NgRx for state genuinely shared across unrelated feature areas (e.g., the current user,
cart contents, cross-page notifications) — not every piece of UI state needs a store.

---

## Check B — Selectors not memoized (NGRX-002)

### Detection

Grep for selector functions defined as plain arrow functions passed straight into
`store.select()` instead of built with `createSelector`. Unmemoized selectors recompute their
projection on *every* store emission, even when the slice of state they actually read hasn't
changed — wasteful for cheap selectors, and a real performance problem for selectors that map
over large arrays or do heavier derivation, since Angular's change detection re-renders
whenever the (new, unequal-by-reference) result comes through.

### BAD — inline selector recomputes on every state change

```typescript
this.total$ = this.store.select(state =>
  state.cart.items.reduce((sum, item) => sum + item.price, 0) // recalculated on every emission
);
```

### GOOD — createSelector memoizes on its input selectors

```typescript
export const selectCartItems = (state: AppState) => state.cart.items;

export const selectCartTotal = createSelector(
  selectCartItems,
  items => items.reduce((sum, item) => sum + item.price, 0) // only recomputes when items changes
);
```

```typescript
this.total = this.store.selectSignal(selectCartTotal);
```

---

## Check C — Effect with no catchError (NGRX-003)

### Detection

Grep `createEffect` bodies for a `switchMap`/`mergeMap` chain with no `catchError` guarding
the inner observable. In NgRx, an unhandled error thrown inside an Effect's stream completes
that Effect's entire subscription — not just the one action that failed. Every subsequent
action of that type silently stops being handled for the lifetime of the app, with no crash
and no obvious symptom beyond "this feature stopped working after some API call failed once."

### BAD — one API failure permanently kills the effect

```typescript
loadOrders$ = createEffect(() =>
  this.actions$.pipe(
    ofType(loadOrders),
    switchMap(() =>
      this.ordersApi.getAll().pipe(
        map(orders => loadOrdersSuccess({ orders }))
        // no catchError — one HTTP error here and this effect stops firing forever
      )
    )
  )
);
```

### GOOD — catchError keeps the effect stream alive

```typescript
loadOrders$ = createEffect(() =>
  this.actions$.pipe(
    ofType(loadOrders),
    switchMap(() =>
      this.ordersApi.getAll().pipe(
        map(orders => loadOrdersSuccess({ orders })),
        catchError(error => of(loadOrdersFailure({ error }))) // stream survives, error becomes an action
      )
    )
  )
);
```

---

## Check D — Component subscribes to the store directly (NGRX-004)

### Detection

Grep components for `store.subscribe(...)` or `store.select(...).subscribe(...)` inside
`ngOnInit`/constructor instead of using the `async` pipe in the template or `toSignal()`.
Manual subscriptions to the store reintroduce exactly the leak risk `angular-memory-leaks`
warns about — a forgotten `unsubscribe()` on component destroy keeps the subscription (and
the component reference it closes over) alive indefinitely.

### BAD — manual store subscription, manual cleanup burden

```typescript
export class OrderListComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private sub?: Subscription;
  orders: Order[] = [];

  ngOnInit() {
    this.sub = this.store.select(selectOrders).subscribe(orders => this.orders = orders);
  }
  ngOnDestroy() { this.sub?.unsubscribe(); } // easy to forget; leak if omitted
}
```

### GOOD — toSignal() or the async pipe manage the subscription lifecycle

```typescript
export class OrderListComponent {
  private store = inject(Store);
  orders = toSignal(this.store.select(selectOrders), { initialValue: [] });
}
```

```html
<!-- or, with the async pipe directly in the template -->
@for (order of orders$ | async; track order.id) { <app-order-row [order]="order" /> }
```

---

## Check E — Feature state registered eagerly at root (NGRX-005)

### Detection

Check `app.config.ts`/root module setup for feature reducers registered alongside the root
store instead of lazily via `provideState` scoped to the lazy-loaded route that actually needs
them. Eager root registration means every feature's reducers, effects, and initial state ship
in the initial bundle and populate the root state tree on startup — even for features the
user may never navigate to in that session.

### BAD — every feature registered at root, regardless of whether it's ever visited

```typescript
// app.config.ts
provideStore({
  cart: cartReducer,
  orders: ordersReducer,
  admin: adminReducer,       // most users never touch the admin area
  reporting: reportingReducer,
}),
provideEffects([CartEffects, OrdersEffects, AdminEffects, ReportingEffects]),
```

### GOOD — lazy-registered alongside the corresponding lazy route

```typescript
// app.config.ts — only truly app-wide state at root
provideStore({ cart: cartReducer }),
provideEffects([CartEffects]),
```

```typescript
// admin.routes.ts
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    providers: [
      provideState('admin', adminReducer),
      provideEffects([AdminEffects]),
    ],
    loadComponent: () => import('./admin-dashboard.component').then(m => m.AdminDashboardComponent),
  },
];
```

---

## Check F — No documented policy for NgRx/Signals coexistence (NGRX-006)

### Detection

In codebases mid-migration — legacy features on NgRx, new features on Signals per
`angular-signals-and-state` — check whether there's a written rule for which one owns a given
piece of state. Without one, teams end up with two independent, unsynchronized sources of
truth for conceptually the same data (e.g., "current user" held in both an NgRx selector and a
separate signal service), and whichever one a given component happens to read from silently
diverges from the other after either is updated.

### BAD — the same concept duplicated in both systems with no ownership rule

```typescript
// legacy module
export const selectCurrentUser = createSelector(selectAuthState, s => s.user);

// new feature, unaware of the NgRx state, keeps its own copy
@Injectable({ providedIn: 'root' })
export class CurrentUserSignalService {
  user = signal<User | null>(null); // updated independently — can disagree with the store
}
```

### GOOD — one documented owner per concept, the other side bridges to it

```typescript
// ADR: "Cross-cutting session/auth state stays in NgRx until the auth module migration
// (tracked in JIRA-1234). New feature-local state uses signals. Bridge via toSignal()."
@Injectable({ providedIn: 'root' })
export class CurrentUserFacade {
  private store = inject(Store);
  user = toSignal(this.store.select(selectCurrentUser), { initialValue: null }); // single source of truth, one bridge
}
```

Record the policy as an ADR (see `pilot-core:architecture-decision-records`) so the boundary
survives team turnover instead of living only in one engineer's head.
