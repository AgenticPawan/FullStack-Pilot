---
name: angular-upgrade-path
description: Step-by-step Angular upgrade path from v15 to v17+. Covers standalone migration schematics (v15+), NgModule removal, control-flow migration (v17+), signal input/output adoption, ESLint migration from TSLint, and ng update safety checks. Only skill with deep v15/v16 EOL content.
when_to_use: upgrade Angular, migration, standalone migration, ng update, removing NgModules, control-flow migration, v15, v16, v17, EOL stack, schematics, angular upgrade, TSLint to ESLint, signal migration, update guide
applies_to: angular>=15
---

<!-- EOL NOTICE:
  Angular 15 — EOL May 2024
  Angular 16 — EOL Nov 2024
  Angular 17+ — currently supported
  Always check https://angular.dev/reference/releases for the current support matrix.
-->

## Migration overview

```
Angular 15 (EOL)          Angular 16 (EOL)           Angular 17+
    │                          │                           │
    ├─ Run standalone           ├─ Migrate templates         ├─ Adopt signal
    │  migration schematic      │  to @if / @for             │  inputs/outputs
    │                          │                           │
    ├─ ESLint migration         ├─ Add takeUntilDestroyed    ├─ Enable OnPush
    │  (if still on TSLint)     │  to all subscriptions      │  everywhere
    │                          │                           │
    └─ ng update 15 → 16       ├─ Optional: signals          └─ Zoneless prep
                               │  developer preview          (Angular 18+ after
                               └─ ng update 16 → 17          migration completes)
```

---

## Step 1 — Verify current state

```bash
ng version                    # confirm active Angular version
npx @angular/core@latest      # preview what ng update would require
```

Check: does `angular.json` still reference `"standalone": false` in schematics defaults?

---

## Step 2 — Angular 15 → 16: standalone migration

Standalone components (`standalone: true`) remove the need for `NgModule` declarations.
The `ng generate @angular/core:standalone` schematic automates 90% of this.

```bash
# Step A: convert all components/directives/pipes to standalone
ng generate @angular/core:standalone --mode=convert-to-standalone

# Step B: remove now-unnecessary NgModules (keeps modules that declare routes/providers)
ng generate @angular/core:standalone --mode=remove-modules

# Step C: bootstrap with bootstrapApplication() instead of platformBrowserDynamic()
ng generate @angular/core:standalone --mode=prune-ng-modules
```

**Validate after each step:**
```bash
ng build --configuration production   # zero errors required
npm test                              # all unit tests pass
```

**Manual fixes often required:**
- `forRoot()` and `forChild()` module patterns → `provideRouter()` and `provideX()` functions
- `TestBed.configureTestingModule({ imports: [AppModule] })` → import standalone component directly

---

## Step 3 — ESLint migration (Angular 15→16, if still on TSLint)

TSLint is abandoned. Migrate to `@angular-eslint`:

```bash
ng add @angular-eslint/schematics
ng g @angular-eslint/schematics:convert-tslint-to-eslint --remove-tslint-if-no-more-tslint-targets
```

Verify: `.eslintrc.json` (or `eslint.config.mjs` for flat config, Angular 17+) created;
`tslint.json` deleted.

---

## Step 4 — Bump 15 → 16 with ng update

```bash
ng update @angular/core@16 @angular/cli@16
# Follow migration guide prompts — answer each migration question
ng build && npm test          # validate before committing
```

**Angular 16 additions to enable now (all optional, all backwards-compatible):**

```typescript
// Signal primitives — developer preview in v16, stable in v17
import { signal, computed, effect } from '@angular/core';

// takeUntilDestroyed — replaces Subject-based takeUntil pattern
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// toSignal / toObservable — RxJS ↔ signal bridge
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
```

---

## Step 5 — Bump 16 → 17 with ng update

```bash
ng update @angular/core@17 @angular/cli@17
```

**Angular 17 brings: stable signals, built-in control flow, @defer, ESLint flat config support.**

---

## Step 6 — Control-flow migration (Angular 17+)

Replace `*ngIf`, `*ngFor`, `*ngSwitch` with built-in `@if`, `@for`, `@switch`.

```bash
# Automatic migration schematic (Angular 17+)
ng generate @angular/core:control-flow

# Dry-run first to preview changes
ng generate @angular/core:control-flow --dry-run
```

**Manual review required for:**
- `*ngFor` without `trackBy` → `@for` **requires** `track` — add a stable track expression
- `*ngIf="x; else tmpl"` → `@if (x) { } @else { }`  (check template ref variable names)
- `ng-template` with `*ngSwitchCase` → `@switch / @case / @default`

### BAD — Angular 16 template patterns (after migration these must not remain)

```html
<div *ngIf="user; else loading">{{ user.name }}</div>
<ng-template #loading><p>Loading…</p></ng-template>

<li *ngFor="let item of items; trackBy: trackById">{{ item.label }}</li>
```

### GOOD — Angular 17+ control flow

```html
@if (user()) {
  <div>{{ user().name }}</div>
} @else {
  <p>Loading…</p>
}

@for (item of items(); track item.id) {
  <li>{{ item.label }}</li>
}
```

---

## Step 7 — Signal input/output adoption (Angular 17.1+; stable v19)

Convert `@Input()` / `@Output()` incrementally — they are interoperable with the old decorators.

```bash
# Automatic migration (Angular 19+)
ng generate @angular/core:signal-input-migration
ng generate @angular/core:signal-queries-migration
```

**Manual conversion for Angular 17.1–18:**

```typescript
// BEFORE
@Input({ required: true }) userId!: string;
@Input() role = 'viewer';
@Output() roleChange = new EventEmitter<string>();

// AFTER (Angular 17.1+)
userId = input.required<string>();
role   = input('viewer');
roleChange = output<string>();
```

---

## Step 8 — CommonModule cleanup

After standalone migration, remove `CommonModule` from component `imports` and replace
with specific imports:

```typescript
// BEFORE standalone migration
@NgModule({ imports: [CommonModule] })

// AFTER: import only what you need
@Component({
  imports: [
    AsyncPipe,        // from @angular/common
    NgOptimizedImage, // from @angular/common
    // DatePipe, DecimalPipe, etc. — only what the template uses
  ]
})
```

---

## ng update safety checklist

Run before and after every version bump:

```bash
ng update                         # list available updates and blocking peers
ng update @angular/core @angular/cli --dry-run   # preview changes
ng build --configuration production              # zero build errors
npm test -- --watchAll=false                     # all tests pass
ng lint                                          # zero lint errors
```

Commit between each major version bump — do not compress multiple version jumps into one commit.

---

## Version-by-version summary

| Version | Key feature to adopt | Schematic available |
|---------|----------------------|---------------------|
| 15 | Standalone components | ✓ `convert-to-standalone` |
| 16 | signals (preview), `takeUntilDestroyed` | — |
| 17 | Stable signals, `@if/@for/@defer`, ESLint flat config | ✓ `control-flow` |
| 17.1 | `input()` / `output()` (preview) | ✓ v19 `signal-input-migration` |
| 18 | Zoneless (experimental) | — |
| 19 | `resource()`, `linkedSignal()` (preview), `httpResource()` (experimental) | ✓ `signal-input-migration` |
| 20 | Zoneless stable, signals fully stable, incremental hydration default | — |
