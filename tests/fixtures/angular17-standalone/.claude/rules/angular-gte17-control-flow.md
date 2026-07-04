---
id: angular-gte17-control-flow
title: Angular 17+ Control Flow, OnPush/Signals, takeUntilDestroyed
appliesTo: angular>=17
severity: warn
standard: InternalPolicy
---
Use built-in control flow (`@if`, `@for` with `track`, `@switch`) instead of structural directives. Default new components to `ChangeDetectionStrategy.OnPush` or signals. Pair every manual `subscribe()` with `takeUntilDestroyed()` to prevent memory leaks.

**BAD**
```html
<!-- Old structural directives — avoid in new code -->
<div *ngIf="user">{{ user.name }}</div>
<div *ngFor="let item of items">{{ item.label }}</div>
```
```typescript
// Subscription without cleanup — memory leak
this.service.data$.subscribe(d => this.data = d);
```

**GOOD**
```html
@if (user()) { <div>{{ user().name }}</div> }
@for (item of items(); track item.id) { <div>{{ item.label }}</div> }
```
```typescript
// Angular 17+: inject destroyRef, no manual unsubscribe needed
this.service.data$.pipe(takeUntilDestroyed()).subscribe(d => this.data = d);
```
