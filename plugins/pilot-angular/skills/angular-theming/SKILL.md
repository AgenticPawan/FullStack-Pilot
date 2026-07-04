---
name: angular-theming
description: Multi-theme support in Angular apps — light/dark/brand and per-tenant theming via CSS custom property design tokens, runtime theme switching without reload, Angular Material M3 theming (v17+), persisted theme preference with flash-of-wrong-theme prevention, and WCAG contrast validation across theme variants.
when_to_use: theming, dark mode, light mode, brand theme, per-tenant branding, design tokens, CSS custom properties, mat.theme, M3 theming, theme switcher, localStorage theme, flash of unstyled theme, FOUC, contrast ratio, WCAG contrast, theme persistence
applies_to: angular>=15
---

<!-- Version index:
  CSS custom properties (design tokens)   all Angular versions (platform CSS feature)
  mat-core / mat.core-theme legacy mixins  Angular Material <17 (pre-M3)
  mat.theme() / system-level tokens        Angular Material 17+ (M3), stable from Material 18
  Signals for reactive theme state         Angular 17+
-->

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| ATH-001 | P1 | Hardcoded hex/rgb colors in component SCSS instead of theme tokens |
| ATH-002 | P1 | No centralized theme-token partial — colors/mixins duplicated per component |
| ATH-003 | P0 | Theme switch reloads/re-bootstraps the app instead of toggling a class/attribute |
| ATH-004 | P2 | Legacy pre-M3 `mat-core`/`mat-theme` mixins used on a Material 17+ project |
| ATH-005 | P1 | Theme preference not persisted, or no flash-of-wrong-theme prevention |
| ATH-006 | P0 | Theme token change not validated against WCAG contrast ratios |

---

## Check A — Hardcoded colors vs. design tokens (ATH-001)

### Detection
1. Grep component `.scss` files for raw hex (`#[0-9a-fA-F]{3,8}`) or `rgb(`/`rgba(` literals outside a single `_tokens.scss`/`_theme.scss` partial.
2. Flag any color literal that is not a reference to a CSS custom property (`var(--...)`) or an SCSS variable imported from the shared token file.
3. Confirm a `:root` or theme-class block defines the token set once; components should only *consume* tokens.

### BAD — hardcoded hex scattered in component styles
```scss
// feature-card.component.scss
.feature-card {
  background: #ffffff;
  border: 1px solid #e0e0e0;
  color: #1a1a1a;

  &.is-active {
    background: #eef4ff;
    border-color: #3366ff;
  }
}
```

### GOOD — component consumes centralized design tokens
```scss
// _tokens.scss (imported once into styles.scss)
:root {
  --color-surface: #ffffff;
  --color-border: #e0e0e0;
  --color-text: #1a1a1a;
  --color-surface-active: #eef4ff;
  --color-border-active: #3366ff;
}

:root[data-theme='dark'] {
  --color-surface: #1e1e1e;
  --color-border: #3a3a3a;
  --color-text: #f0f0f0;
  --color-surface-active: #1a2a4a;
  --color-border-active: #6699ff;
}
```

```scss
// feature-card.component.scss
.feature-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text);

  &.is-active {
    background: var(--color-surface-active);
    border-color: var(--color-border-active);
  }
}
```

---

## Check B — Centralized theme-token layer (ATH-002)

### Detection
1. Search for repeated Angular Material mixin invocations (`mat.define-palette`, `@include mat.button-theme`, etc.) inside more than one component-level `.scss` file.
2. Confirm a single `libs/shared-ui/theme` (or `src/styles/theme`) partial owns palette, typography, and spacing tokens, and every other file only imports from it.
3. Flag any per-component redefinition of a palette or typography scale that duplicates the central one.

### BAD — Material theme mixins duplicated per component
```scss
// order-list.component.scss
@use '@angular/material' as mat;

$order-primary: mat.define-palette(mat.$blue-palette);
@include mat.button-theme($order-primary);
```

```scss
// invoice-list.component.scss
@use '@angular/material' as mat;

$invoice-primary: mat.define-palette(mat.$blue-palette); // duplicated palette
@include mat.button-theme($invoice-primary);
```

### GOOD — one theme partial, components only consume tokens
```scss
// src/styles/_theme.scss — single source of truth
@use '@angular/material' as mat;

html {
  color-scheme: light dark;

  @include mat.theme((
    color: (
      theme-type: light,
      primary: mat.$azure-palette,
      tertiary: mat.$blue-palette,
    ),
    typography: Roboto,
    density: 0,
  ));
}
```

```scss
// order-list.component.scss — no palette re-declared, only layout
.order-list {
  padding: var(--spacing-md);
  color: var(--mat-sys-on-surface);
}
```

---

## Check C — Runtime theme switching without reload (ATH-003)

### Detection
1. Search for `window.location.reload()`, `location.href = ...`, or `bootstrapApplication` called again inside a theme-toggle handler.
2. Confirm theme switching instead toggles a `data-theme` attribute or class on `<html>`/`<body>` and lets CSS custom properties cascade.
3. Confirm the toggle is driven by a signal so consuming components re-render only where needed (not full page re-render).

### BAD — full reload to apply a new theme
```typescript
@Component({ selector: 'app-theme-toggle', template: `<button (click)="switchTheme()">Toggle theme</button>` })
export class ThemeToggleComponent {
  switchTheme() {
    localStorage.setItem('theme', 'dark');
    window.location.reload(); // discards app state just to repaint colors
  }
}
```

### GOOD — attribute toggle on <html>, no reload
```typescript
// theme.service.ts
import { Injectable, signal, effect } from '@angular/core';

export type ThemeName = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<ThemeName>(this.readInitialTheme());

  constructor() {
    effect(() => {
      document.documentElement.setAttribute('data-theme', this.theme());
      localStorage.setItem('theme', this.theme());
    });
  }

  toggle(): void {
    this.theme.update(t => (t === 'light' ? 'dark' : 'light'));
  }

  private readInitialTheme(): ThemeName {
    return (localStorage.getItem('theme') as ThemeName) ?? 'light';
  }
}
```

```typescript
@Component({
  selector: 'app-theme-toggle',
  template: `<button (click)="theme.toggle()">Toggle theme</button>`,
})
export class ThemeToggleComponent {
  protected readonly theme = inject(ThemeService);
}
```

---

## Check D — Legacy pre-M3 Material mixins on M3-capable projects (ATH-004)

**Applies only when `@angular/material` >= 17 is detected in `package.json`.**

### Detection
1. Check `package.json` for `@angular/material` major version.
2. If >= 17, grep global styles for `@include mat.core(` (legacy) or `mat.define-light-theme` / `mat.define-dark-theme` combined with `mat.all-component-themes` — these are the pre-M3 API.
3. Flag as advisory-to-required migration to `mat.theme()` / system tokens, since M3 is the default for new Material 17+ projects (`ng generate @angular/material:m3-theme`).

### BAD — legacy mat-core/mat-theme API on Material 18 project
```scss
@use '@angular/material' as mat;

@include mat.core(); // pre-M3 legacy setup

$my-primary: mat.define-palette(mat.$indigo-palette);
$my-theme: mat.define-light-theme((
  color: (primary: $my-primary, accent: mat.define-palette(mat.$pink-palette)),
));

@include mat.all-component-themes($my-theme);
```

### GOOD — M3 system-level token API
```scss
@use '@angular/material' as mat;

html {
  @include mat.theme((
    color: (
      theme-type: light,
      primary: mat.$violet-palette,
      tertiary: mat.$magenta-palette,
    ),
    typography: Roboto,
    density: 0,
  ));
}

html[data-theme='dark'] {
  @include mat.theme((
    color: (theme-type: dark, primary: mat.$violet-palette),
  ));
}
```

---

## Check E — Persisted preference and flash-of-wrong-theme prevention (ATH-005)

### Detection
1. Confirm the theme is read from `localStorage` (or a user profile call) before the first paint, not only after Angular bootstraps.
2. Grep `index.html` for an inline bootstrap `<script>` that sets `data-theme` synchronously; its absence on an app with dark mode is a flag.
3. Confirm `ThemeService` restores the saved value on init rather than always defaulting to `'light'`.

### BAD — theme decided only after Angular bootstraps (visible flash)
```html
<!-- index.html -->
<html>
  <head></head>
  <body>
    <app-root></app-root>
    <!-- theme class only applied once ThemeService runs inside Angular -->
  </body>
</html>
```

### GOOD — inline script sets theme before first paint, service restores state
```html
<!-- index.html -->
<html>
  <head>
    <script>
      (function () {
        var saved = localStorage.getItem('theme');
        var theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
      })();
    </script>
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
```

```typescript
// theme.service.ts — restores the same value the inline script already applied
private readInitialTheme(): ThemeName {
  return (document.documentElement.getAttribute('data-theme') as ThemeName)
    ?? (localStorage.getItem('theme') as ThemeName)
    ?? 'light';
}
```

---

## Check F — WCAG contrast validation across theme variants (ATH-006)

### Detection
1. For every theme variant (`light`, `dark`, per-tenant brand), compute contrast ratio of each text token against its paired surface token.
2. Flag any body-text pair below 4.5:1 (WCAG AA, normal text) or large-text/UI pair below 3:1.
3. Confirm contrast checks run in CI (e.g., via `axe-core` or a token-contrast lint script), not only eyeballed once at design time.

### BAD — dark theme background changed without re-checking text contrast
```scss
:root[data-theme='dark'] {
  --color-surface: #12141a;
  --color-text: #4a4f5a; /* looks fine on old bg, now ~2.1:1 on new bg — fails AA */
}
```

### GOOD — token change re-validated and adjusted to meet AA
```scss
:root[data-theme='dark'] {
  --color-surface: #12141a;
  --color-text: #e8eaf0; /* ~13.8:1 against --color-surface — passes AA and AAA */
}
```

```typescript
// tools/check-contrast.ts — run in CI against every theme's token pairs
import { getContrastRatio } from './contrast-utils';

const pairs: Array<[fg: string, bg: string, name: string]> = [
  ['#e8eaf0', '#12141a', 'dark: text on surface'],
];

for (const [fg, bg, name] of pairs) {
  const ratio = getContrastRatio(fg, bg);
  if (ratio < 4.5) {
    throw new Error(`Contrast failure (${name}): ${ratio.toFixed(2)}:1, need >= 4.5:1`);
  }
}
```

---

## Theming checklist

- [ ] No hardcoded hex/rgb values in component SCSS — all colors reference `var(--token-name)`
- [ ] One central theme-token partial owns palettes, typography, and spacing; components only consume
- [ ] Theme switching toggles `data-theme`/class on `<html>` — no `location.reload()` or re-bootstrap
- [ ] Material 17+ projects use `mat.theme()` system tokens, not legacy `mat.core()`/`define-light-theme`
- [ ] Theme preference persisted to `localStorage` (or user profile) and restored on load
- [ ] Inline bootstrap script sets `data-theme` before first paint to prevent flash-of-wrong-theme
- [ ] Every theme variant's text/surface token pairs pass WCAG AA contrast (4.5:1 normal, 3:1 large/UI)
- [ ] Contrast checks are automated in CI, not manual-only
