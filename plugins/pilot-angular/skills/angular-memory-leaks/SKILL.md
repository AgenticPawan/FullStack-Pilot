---
name: angular-memory-leaks
description: Detects and prevents Angular memory leaks. Covers subscription leaks, takeUntilDestroyed() (v16+), async pipe preference, DestroyRef, detached change-detector trees, DOM event listeners left attached, and NgZone.runOutsideAngular misuse. Includes a leak-hunt checklist.
when_to_use: memory leak, subscription cleanup, unsubscribe, takeUntil, destroyRef, component not destroyed, event listener cleanup, change detector detached, ngzone leak, subscription management, async pipe, leak hunt
applies_to: angular>=16
---

<!-- Version index:
  takeUntilDestroyed()   Angular 16+  (@angular/core/rxjs-interop)
  DestroyRef             Angular 16+
  inject(DestroyRef)     Angular 14+  (inject() in constructor context)
  afterRender/afterNextRender  Angular 17+
-->

## The four leak categories

| Category | Symptom | Fix |
|----------|---------|-----|
| Subscription not cleaned up | Observable keeps emitting after component destroyed | `takeUntilDestroyed()` or `async` pipe |
| DOM event listener not removed | Callback holds component reference alive | `DestroyRef.onDestroy()` cleanup |
| Detached ChangeDetectorRef | CD tree orphaned, still running | Detach in `ngOnDestroy`, mark `destroyed` |
| NgZone runOutsideAngular callback | Timer/WebSocket callback re-enters zone | Wrap zone entry in `ngZone.run()`, cancel in destroy |

---

## Subscription leaks

### BAD — subscribe() with no cleanup

```typescript
@Component({ ... })
export class DashboardComponent implements OnInit {
  data: Item[] = [];

  constructor(private svc: DataService) {}

  ngOnInit() {
    // Leak: subscription lives forever — component teardown never cancels it
    this.svc.updates$.subscribe(d => this.data = d);
  }
}
```

### GOOD — takeUntilDestroyed() (Angular 16+)

```typescript
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({ ... })
export class DashboardComponent {
  data: Item[] = [];

  constructor(svc: DataService) {
    // takeUntilDestroyed() is called in injection context — no manual Subject needed
    svc.updates$.pipe(
      takeUntilDestroyed()
    ).subscribe(d => this.data = d);
  }
}
```

### ALSO GOOD — async pipe (zero-boilerplate, preferred for templates)

```typescript
@Component({
  template: `@for (item of data$ | async; track item.id) { ... }`
})
export class DashboardComponent {
  data$ = inject(DataService).updates$;
  // async pipe subscribes and unsubscribes automatically
}
```

### When to call takeUntilDestroyed() outside constructor

If the subscription must be created outside injection context (e.g., inside `ngOnInit`), inject `DestroyRef` and pass it explicitly:

```typescript
@Component({ ... })
export class ListComponent implements OnInit {
  private destroyRef = inject(DestroyRef);

  ngOnInit() {
    this.svc.items$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(items => this.items = items);
  }
}
```

---

## DOM event listener leaks

### BAD — addEventListener without removeEventListener

```typescript
@Component({ ... })
export class ResizeComponent implements OnInit {
  ngOnInit() {
    // Leak: handler holds `this` alive; never removed
    window.addEventListener('resize', () => this.onResize());
  }
}
```

### GOOD — register cleanup with DestroyRef

```typescript
@Component({ ... })
export class ResizeComponent {
  constructor() {
    const handler = () => this.onResize();
    window.addEventListener('resize', handler);
    inject(DestroyRef).onDestroy(() =>
      window.removeEventListener('resize', handler)
    );
  }
}
```

---

## NgZone leaks

### BAD — interval created outside zone, change detection spammed

```typescript
@Component({ ... })
export class PollComponent implements OnInit, OnDestroy {
  private intervalId: any;

  ngOnInit() {
    // Runs inside Angular zone — triggers CD on every tick
    this.intervalId = setInterval(() => this.poll(), 5000);
  }
  ngOnDestroy() { clearInterval(this.intervalId); }
}
```

### GOOD — run timer outside zone, re-enter only on data arrival

```typescript
@Component({ ... })
export class PollComponent {
  private ngZone  = inject(NgZone);
  private destroyRef = inject(DestroyRef);

  constructor(private svc: PollService) {
    let id: ReturnType<typeof setInterval>;

    this.ngZone.runOutsideAngular(() => {
      id = setInterval(() => {
        this.svc.fetch().then(data =>
          this.ngZone.run(() => this.data.set(data))  // re-enter zone for CD
        );
      }, 5000);
    });

    this.destroyRef.onDestroy(() => clearInterval(id));
  }
}
```

---

## Detached ChangeDetectorRef leak

```typescript
// BAD: detach without tracking or re-attaching
constructor(private cdr: ChangeDetectorRef) {
  this.cdr.detach();
  // Component never re-attaches or cleans up — CD tree orphaned
}

// GOOD: detach explicitly, mark for check on meaningful updates, clean up
constructor(private cdr: ChangeDetectorRef) {
  this.cdr.detach();
  inject(DestroyRef).onDestroy(() => this.cdr.detectChanges()); // flush final state
}
```

---

## Leak-hunt checklist

Run through this list when diagnosing a suspected leak in a component:

- [ ] **Subscriptions** — every `subscribe()` call is paired with `takeUntilDestroyed()` or `async` pipe
- [ ] **Subjects** — `Subject` and `BehaviorSubject` exposed as Observables are completed in `ngOnDestroy` or via `takeUntilDestroyed()`
- [ ] **DOM listeners** — every `addEventListener` has a matching `removeEventListener` registered via `DestroyRef.onDestroy()`
- [ ] **Timers** — `setInterval`/`setTimeout` IDs are cancelled in destroy; run outside Angular zone if they do not need CD
- [ ] **ViewRef** — `ApplicationRef.attachView()` calls are paired with `detachView()` on destroy
- [ ] **ChangeDetectorRef.detach()** — component re-attaches or calls `detectChanges()` before destroy
- [ ] **effect()** — returns a cleanup function if it attaches external listeners or timers
- [ ] **Router events** — subscriptions to `Router.events` use `takeUntilDestroyed()`
- [ ] **WebSocket** — `ws.close()` is called in `DestroyRef.onDestroy()`
- [ ] **afterRender/afterNextRender (v17+)** — cleanup returned if they register external effects

---

## Heap profiling quick-start (Chrome DevTools)

1. Open **Memory** tab → take baseline heap snapshot.
2. Navigate to the suspect component; interact; navigate away.
3. Take second snapshot; run GC.
4. Filter by `Component` class name — retained instances indicate a leak.
5. Expand the retaining tree to identify which reference keeps the component alive.
