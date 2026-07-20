---
name: angular-zoneless-migration
description: "Guides migration from Zone.js to Angular's zoneless change detection: bootstrapping swap (provideZonelessChangeDetection / provideExperimentalZonelessChangeDetection), component audit for manual tick calls or NgZone.runOutsideAngular usage, CD strategy alignment (OnPush or signal-based), async-pipe alignment, and NgZone import elimination. Targets Angular 17.1+ (experimental) and 18+ (stable)."
when_to_use: zoneless, zone.js removal, provideZonelessChangeDetection, provideExperimentalZonelessChangeDetection, change detection migration, signal-based, OnPush, remove zone.js, NgZone, CD strategy, experimental zoneless, bootstrap zoneless
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| ZNL-001 | P1 | `zone.js` still imported in `polyfills` after zoneless provider is added |
| ZNL-002 | P1 | Component uses `ChangeDetectorRef.detectChanges()` or `markForCheck()` without signal/OnPush strategy |
| ZNL-003 | P1 | Component injects `NgZone` and calls `run()` or `runOutsideAngular()` — incompatible with zoneless |
| ZNL-004 | P2 | Component uses `setInterval`/`setTimeout` directly (should use RxJS timer or signal-based equivalent) |
| ZNL-005 | P2 | `async` pipe used with an Observable that never completes — acceptable, but flag for review |

---

## Migration steps

### Step 1 — Add the zoneless provider

**Angular 17.1–17.x (experimental)**

```typescript
// main.ts
import { provideExperimentalZonelessChangeDetection } from '@angular/core';

bootstrapApplication(AppComponent, {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    // ... other providers
  ]
});
```

**Angular 18+ (stable)**

```typescript
import { provideZonelessChangeDetection } from '@angular/core';

bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection()]
});
```

### Step 2 — Remove zone.js import

In `angular.json`, remove `zone.js` from `polyfills`:

```json
// BEFORE
"polyfills": ["zone.js"]

// AFTER
"polyfills": []
```

Also remove from `package.json` `dependencies` if no other consumer requires it.

### Step 3 — Audit NgZone usages (ZNL-003)

Search: `grep -r "NgZone\|runOutsideAngular\|run(" src/`

For each hit, refactor to use signals or RxJS operators that do not require zone patching:

```typescript
// BAD — NgZone.run to re-enter Angular
constructor(private ngZone: NgZone) {}
someCallback() { this.ngZone.run(() => this.data.set(value)); }

// GOOD — signal mutation is always zone-aware
data = signal<string>('');
someCallback() { this.data.set(value); }
```

### Step 4 — Audit manual CD calls (ZNL-002)

Prefer signals over `markForCheck()`. With zoneless + signals, Angular schedules CD
automatically on signal writes.

```typescript
// BAD — manual trigger
constructor(private cdr: ChangeDetectorRef) {}
update() { this.value = 'new'; this.cdr.markForCheck(); }

// GOOD — signal write schedules CD automatically
value = signal('');
update() { this.value.set('new'); }
```

### Step 5 — Replace bare timers (ZNL-004)

```typescript
// BAD — raw setTimeout (not zone-patched in zoneless)
setTimeout(() => this.refresh(), 5000);

// GOOD — RxJS timer (works with async pipe, signal-based, or takeUntilDestroyed)
import { timer } from 'rxjs';
timer(5000).pipe(takeUntilDestroyed()).subscribe(() => this.refresh());
```

---

## Verification

After each step, run `ng test` with `--include="**/*.spec.ts"` to catch any components
that relied on zone-triggered CD. Tests that call `fixture.detectChanges()` explicitly
are zoneless-safe; tests that relied on automatic async tick may need `await fixture.whenStable()`.
