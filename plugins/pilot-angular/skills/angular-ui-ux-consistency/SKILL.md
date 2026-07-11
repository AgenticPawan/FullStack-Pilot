---
name: angular-ui-ux-consistency
description: Reviews visual/UI-UX implementation consistency in Angular apps — spacing/typography scale discipline, mobile-first responsive layout, visual hierarchy between primary/secondary actions, cross-feature component consistency, and a design-to-code fidelity check. Distinct from angular-a11y (ARIA/keyboard), angular-theming (color tokens only), and angular-shared-ui-kit (dialog/toast architecture only).
when_to_use: UI/UX review, visual design, spacing scale, design tokens, typography scale, font scale, responsive design, mobile-first, breakpoints, visual hierarchy, button hierarchy, primary secondary action, component visual consistency, design system, Figma, design-to-code, pixel-perfect, layout review, inconsistent spacing, inconsistent styling
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| UXC-001 | P2 | Hardcoded arbitrary spacing values instead of a shared spacing scale |
| UXC-002 | P2 | Ad-hoc font-size/line-height/weight per component instead of a shared type scale |
| UXC-003 | P1 | Fixed-width/desktop-only layout with no mobile-first responsive breakpoints |
| UXC-004 | P2 | No visual distinction between primary and secondary/tertiary actions on the same screen |
| UXC-005 | P2 | The same UI concept (card, list row, empty state) styled differently across features |
| UXC-006 | P3 | No design-to-code fidelity check before a UI PR merges |

This skill covers visual design **implementation** consistency — spacing, type, layout,
hierarchy, and cross-feature consistency. It does not cover accessibility mechanics
(`angular-a11y`: ARIA, focus management, keyboard nav), color-token/theme architecture
(`angular-theming`: dark mode, runtime switching), dialog/toast service architecture
(`angular-shared-ui-kit`), or animation timing (`angular-motion-accessibility`) — cite those
skills for findings in their territory rather than duplicating them here.

---

## Check A — Spacing scale discipline (UXC-001)

### Detection

Search component styles for arbitrary pixel/rem values (`padding: 13px`, `margin: 22px`)
instead of a shared spacing scale (a small fixed set of tokens — e.g. 4/8/12/16/24/32/48px —
exposed as CSS custom properties or a SCSS map). Arbitrary one-off values accumulate into a
UI where nothing quite lines up, and each new component invents its own spacing instead of
reusing the scale.

### BAD — arbitrary, non-repeating spacing values

```scss
.order-card { padding: 13px 17px; margin-bottom: 22px; }
.order-summary { padding: 15px 20px; margin-bottom: 18px; }
```

### GOOD — shared spacing scale

```scss
// design-tokens.scss
:root {
  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;
}
```
```scss
.order-card { padding: var(--space-3) var(--space-4); margin-bottom: var(--space-6); }
.order-summary { padding: var(--space-3) var(--space-4); margin-bottom: var(--space-6); }
```

---

## Check B — Typography scale (UXC-002)

### Detection

Search for one-off `font-size`/`line-height`/`font-weight` declarations scattered per
component instead of a shared, named type scale (e.g. `--font-heading-lg`,
`--font-body-md`, `--font-caption`). Without a scale, headings across features drift to
subtly different sizes and the app reads as visually inconsistent even when each screen
individually looks fine.

### BAD — one-off type declarations per component

```scss
.page-title { font-size: 23px; font-weight: 650; line-height: 1.3; }
.section-title { font-size: 19px; font-weight: 600; }
```

### GOOD — shared type-scale tokens

```scss
:root {
  --font-heading-lg: 600 24px/1.3 var(--font-family);
  --font-heading-md: 600 20px/1.3 var(--font-family);
  --font-body-md: 400 16px/1.5 var(--font-family);
}
```
```scss
.page-title { font: var(--font-heading-lg); }
.section-title { font: var(--font-heading-md); }
```

---

## Check C — Mobile-first responsive layout (UXC-003)

### Detection

Check whether a feature's layout is built with a fixed desktop width and only degrades
gracefully (or not at all) below it, versus starting from a single-column mobile layout and
progressively enhancing at wider breakpoints (`min-width` media queries). Fixed-width
layouts with no breakpoints, or `max-width`-only "shrink from desktop" queries, both produce
broken layouts on the narrow end where most real-world traffic often lands.

### BAD — fixed desktop width, no responsive breakpoints

```scss
.dashboard-grid {
  width: 1200px; // breaks/overflows below 1200px viewport width
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}
```

### GOOD — mobile-first, progressively enhanced

```scss
.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr; // single column by default (mobile)
  gap: var(--space-4);
}
@media (min-width: 768px) {
  .dashboard-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1200px) {
  .dashboard-grid { grid-template-columns: repeat(4, 1fr); }
}
```

---

## Check D — Visual hierarchy between actions (UXC-004)

### Detection

Check screens with multiple actions (e.g. "Save" + "Cancel", or a list row with several
buttons) for whether the primary action is visually distinct (filled/high-contrast) from
secondary/tertiary actions (outlined/text-only). When every button uses the same style, the
user has no visual cue for which action is the intended default, increasing the chance of
an accidental destructive click.

### BAD — every action styled identically

```html
<button class="btn">Save</button>
<button class="btn">Cancel</button>
<button class="btn">Delete</button>
```

### GOOD — hierarchy communicates intent

```html
<button class="btn btn-primary">Save</button>
<button class="btn btn-secondary">Cancel</button>
<button class="btn btn-danger-text">Delete</button>
```

---

## Check E — Cross-feature component visual consistency (UXC-005)

### Detection

Compare the same UI concept implemented in different features (a "card," a list empty
state, a status badge) — do they share padding, border-radius, shadow, and color treatment,
or did each feature team reinvent it slightly differently? This is the visual counterpart to
`angular-shared-libraries`' data-table/form-building guidance: if a shared presentational
component exists (or should), a per-feature reimplementation is the finding, not a
stylistic nitpick.

### BAD — the same concept, styled three different ways

```scss
// orders/order-card.component.scss
.order-card { border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
// invoices/invoice-tile.component.scss
.invoice-tile { border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,.15); }
```

### GOOD — one shared card component/token set, reused

```typescript
// shared-ui/card/card.component.ts — one implementation, imported everywhere a "card" appears
@Component({ selector: 'app-card', standalone: true, /* ... */ })
export class CardComponent {}
```

---

## Check F — Design-to-code fidelity check (UXC-006)

### Detection

Check whether the team has any documented step for comparing a shipped UI against its
design source (Figma or equivalent) before merge — even a lightweight one (screenshot
side-by-side in the PR description). Without it, spacing/color/type drift between design
and implementation accumulates silently and is only caught, if ever, much later by a
designer noticing in production.

### BAD — no fidelity check step anywhere in the PR process

```markdown
<!-- PR template has no mention of design review or a Figma link -->
## Changes
- Implemented the new checkout summary panel
```

### GOOD — a lightweight fidelity check baked into the PR template

```markdown
## Changes
- Implemented the new checkout summary panel
- Design: <Figma link> — screenshot comparison attached below
- Deviations from design (if any) and why: <none | reason>
```
