---
name: angular-a11y
description: WCAG 2.2 AA enforcement for Angular apps. Semantic HTML first, ARIA only when needed, focus management on route change and dialog open/close using CDK FocusTrap and LiveAnnouncer, keyboard navigation, colour contrast, skip links, and screen reader announcements. AAA items are marked advisory.
when_to_use: accessibility, a11y, WCAG, ARIA, screen reader, focus management, keyboard navigation, contrast, skip link, dialog focus, route focus, semantic HTML, tab order, role attribute, aria-label, cdkTrapFocus, LiveAnnouncer
applies_to: angular>=17
---

<!-- WCAG level key:  [A] required  [AA] required  [AAA] advisory only -->
<!-- CDK: @angular/cdk/a11y  -->

## Principle 1 — Semantic HTML first, ARIA second

Use native elements before ARIA. A `<button>` is always better than `<div role="button">`.

### BAD — div masquerading as a button

```html
<!-- Missing: keyboard access, focus, role, state — must add all manually -->
<div class="btn" (click)="save()">Save</div>
```

### GOOD — native element

```html
<button type="button" (click)="save()">Save</button>
```

### BAD — redundant ARIA on semantic elements

```html
<nav role="navigation">…</nav>   <!-- <nav> already has the role -->
<main role="main">…</main>       <!-- <main> already has the role -->
```

### GOOD — let semantics do the work

```html
<nav aria-label="Main navigation">…</nav>
<main>…</main>
```

---

## Principle 2 — ARIA only when no semantic element exists

### BAD — custom tab panel without ARIA

```html
<div class="tab" (click)="select(0)">Tab 1</div>
<div class="panel">Content 1</div>
```

### GOOD — ARIA roles with keyboard bindings [AA]

```html
<div role="tablist" aria-label="Settings sections">
  <button role="tab"
          [attr.aria-selected]="selectedTab() === 0"
          [attr.aria-controls]="'panel-0'"
          (keydown)="onTabKey($event)">
    Tab 1
  </button>
</div>
<div role="tabpanel"
     id="panel-0"
     [attr.aria-labelledby]="'tab-0'"
     [hidden]="selectedTab() !== 0">
  Content 1
</div>
```

---

## Focus management on route change [AA]

Without management, focus resets to `<body>` after navigation — disorienting for keyboard and screen reader users.

### GOOD — focus main heading on NavigationEnd (Angular 17+)

```typescript
@Component({ selector: 'app-root', ... })
export class AppComponent {
  private router  = inject(Router);
  private mainRef = viewChild<ElementRef>('mainContent');

  constructor() {
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      takeUntilDestroyed()
    ).subscribe(() => {
      // Move focus to the main content heading, not the page top
      this.mainRef()?.nativeElement.focus();
    });
  }
}
```

```html
<main #mainContent tabindex="-1" id="main-content">
  <router-outlet />
</main>
```

**`tabindex="-1"`** makes the element programmatically focusable without adding it to tab order.

---

## Focus management — modal dialogs [AA]

### BAD — dialog opens without trapping focus

```html
<div class="modal" *ngIf="open">
  <button (click)="close()">Close</button>
  <!-- Keyboard users can tab out of the dialog into hidden content -->
</div>
```

### GOOD — CDK FocusTrap (from @angular/cdk/a11y)

```typescript
import { A11yModule } from '@angular/cdk/a11y';

@Component({
  imports: [A11yModule],
  template: `
    @if (open()) {
      <div cdkTrapFocus cdkTrapFocusAutoCapture
           role="dialog"
           aria-modal="true"
           [attr.aria-labelledby]="'dialog-title'">
        <h2 id="dialog-title">Confirm Delete</h2>
        <p>This action cannot be undone.</p>
        <button (click)="confirm()">Delete</button>
        <button (click)="cancel()">Cancel</button>
      </div>
    }
  `
})
export class ConfirmDialogComponent {
  open = input(false);
  // Focus returns to the trigger element when dialog closes — implement via
  // storing document.activeElement before opening and restoring on close.
}
```

---

## Skip link [AA]

Provide a skip-to-content link as the first focusable element on every page.

```html
<!-- index.html or root component template -->
<a href="#main-content" class="skip-link">Skip to main content</a>
<nav>…</nav>
<main id="main-content" tabindex="-1">
  <router-outlet />
</main>
```

```css
/* Visually hidden until focused */
.skip-link {
  position: absolute;
  left: -9999px;
  &:focus { left: 0; }
}
```

---

## Screen reader announcements with LiveAnnouncer

For dynamic updates that do not receive focus (e.g., form errors, async load complete):

```typescript
import { LiveAnnouncer } from '@angular/cdk/a11y';

@Component({ ... })
export class SearchComponent {
  private announce = inject(LiveAnnouncer);

  onResultsLoaded(count: number) {
    this.announce.announce(`${count} results loaded`, 'polite');
  }
}
```

Use `'assertive'` only for critical errors — it interrupts the current screen reader utterance.

---

## Active navigation link [A]

```html
<!-- BAD: sighted-only current page indicator -->
<a routerLink="/home" routerLinkActive="active">Home</a>

<!-- GOOD: programmatic current page for screen readers [AA] -->
<a routerLink="/home"
   routerLinkActive="active"
   ariaCurrentWhenActive="page">Home</a>
```

---

## Colour contrast [AA / AAA]

| Requirement | Ratio | Level |
|-------------|-------|-------|
| Normal text (< 18pt / < 14pt bold) | 4.5:1 | AA |
| Large text (≥ 18pt / ≥ 14pt bold) | 3:1 | AA |
| UI components and graphical objects | 3:1 | AA |
| Normal text enhanced | 7:1 | AAA — advisory |

Angular Material automatically meets AA contrast for its colour system when using
`mat-theme` with accessible palettes. Custom colours MUST be verified with a contrast checker.

---

## Images — alt text [A]

```html
<!-- BAD -->
<img src="chart.png">
<img src="logo.png" alt="logo">      <!-- non-descriptive -->

<!-- GOOD: decorative -->
<img src="divider.svg" alt="">        <!-- empty alt = decorative, ignored by SR -->

<!-- GOOD: informative -->
<img src="error-icon.svg" alt="Error: form submission failed">

<!-- GOOD: complex (chart/diagram) — reference long description -->
<img src="chart.png"
     alt="Bar chart showing Q1–Q4 sales"
     aria-describedby="chart-desc">
<p id="chart-desc">Q1: $120k, Q2: $145k, Q3: $98k, Q4: $167k</p>
```

---

## Forms — labels and error association [A]

```html
<!-- BAD: no label, no error association -->
<input type="email" placeholder="Email">
<span class="error">Invalid email</span>

<!-- GOOD -->
<label for="email">Email address</label>
<input id="email"
       type="email"
       [attr.aria-describedby]="emailError() ? 'email-error' : null"
       [attr.aria-invalid]="emailError() ? 'true' : null">
@if (emailError()) {
  <span id="email-error" role="alert">{{ emailError() }}</span>
}
```

---

## WCAG 2.2 AA checklist

- [ ] Every interactive element is a native focusable or has `role` + `tabindex="0"` + keyboard handler
- [ ] `<button>` used for actions; `<a href>` used for navigation [A]
- [ ] Skip link is the first focusable element on every page [AA]
- [ ] Focus moves to main content heading on route change [AA]
- [ ] Modal dialogs use `cdkTrapFocus` and return focus on close [AA]
- [ ] Dynamic page updates announced via `LiveAnnouncer` or `aria-live` [A]
- [ ] All images have descriptive `alt` text; decorative images have `alt=""` [A]
- [ ] Every form input has an associated `<label>` [A]
- [ ] Errors are associated with inputs via `aria-describedby` and `role="alert"` [A]
- [ ] Colour contrast ≥ 4.5:1 for normal text, ≥ 3:1 for large text and UI [AA]
- [ ] Active nav links have `ariaCurrentWhenActive="page"` [AA]
- [ ] Keyboard navigation works without a mouse for all interactive patterns [AA]

**AAA — advisory only (not required for compliance):**
- [ ] Contrast ratio ≥ 7:1 for body text
- [ ] All functionality available via single-switch access (AAA 2.1.3)

---

## References

- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Angular a11y guide: https://angular.dev/best-practices/a11y
- CDK a11y: https://material.angular.io/cdk/a11y/overview
- axe-core rules: https://dequeuniversity.com/rules/axe/
