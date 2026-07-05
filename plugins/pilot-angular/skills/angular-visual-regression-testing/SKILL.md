---
name: angular-visual-regression-testing
description: Reviews Storybook and visual regression testing coverage for shared Angular component/UI-kit libraries. Flags a shared component library with no isolated component playground documenting variants/states, no visual regression tooling catching unintended pixel-level style changes, stories that only cover the happy-path state, snapshot diffs auto-accepted in CI with no human review, theme variants left uncovered by visual snapshots, and no hard CI gate blocking merge on an unreviewed visual diff for shared-library components.
when_to_use: Storybook, visual regression, Chromatic, Percy, Playwright screenshot comparison, component story, snapshot baseline, snapshot diff review, dark mode regression, theme snapshot, shared component library, UI kit testing, pixel diff, CI visual gate
applies_to: angular
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| VRT-001 | P1 | Shared component library has no Storybook (or equivalent) documenting variants/states |
| VRT-002 | P1 | No visual regression tooling catching unintended pixel-level style changes |
| VRT-003 | P2 | Stories only cover the default/happy-path state, missing loading/error/empty/disabled |
| VRT-004 | P1 | Visual regression baselines auto-accepted in CI with no human review/approval |
| VRT-005 | P2 | Theme variants (light/dark/brand) not covered by visual regression snapshots |
| VRT-006 | P0 | No CI gate blocking merge on an unreviewed visual diff for shared-library components |

`angular-shared-libraries` and `angular-shared-ui-kit` establish what a shared component
must support (form-factory building blocks, a generic data table, dialogs, toasts,
confirmation prompts). This skill is about proving that contract holds visually, release
after release — a shared `ButtonComponent` used on 40 screens can regress silently in a
one-line SCSS change, and nothing in a unit test suite would ever notice.

---

## Check A — No Storybook (or equivalent) for the shared component library (VRT-001)

### Detection

Check whether the shared component library (the same library `angular-shared-libraries`
extracts form factories/data tables into, and `angular-shared-ui-kit` extracts
dialogs/toasts/confirmations into) has a `.storybook/` config and a `*.stories.ts` file per
exported component. Without an isolated playground, the only way to see a component's full
variant surface (size, state, theme) is to hunt down every screen that happens to use it —
and some variants (error state on a rarely-hit form) may not be reachable in the running
app at all.

### BAD — shared library ships components with no isolated playground

```
libs/ui-kit/
├── src/lib/button/button.component.ts
├── src/lib/dialog/dialog.component.ts
└── src/lib/data-table/data-table.component.ts
<!-- No .storybook/, no *.stories.ts anywhere. The only way to see every button variant
     is to grep the app for <ui-button> usages and hope you found them all. -->
```

### GOOD — every exported component has a story documenting its variant surface

```typescript
// libs/ui-kit/src/lib/button/button.stories.ts
import type { Meta, StoryObj } from '@storybook/angular';
import { ButtonComponent } from './button.component';

const meta: Meta<ButtonComponent> = {
  title: 'UI Kit/Button',
  component: ButtonComponent,
};
export default meta;

export const Primary: StoryObj<ButtonComponent> = { args: { variant: 'primary' } };
export const Secondary: StoryObj<ButtonComponent> = { args: { variant: 'secondary' } };
export const Disabled: StoryObj<ButtonComponent> = { args: { variant: 'primary', disabled: true } };
export const Loading: StoryObj<ButtonComponent> = { args: { variant: 'primary', loading: true } };
```

---

## Check B — No visual regression tooling (VRT-002)

### Detection

Check whether a visual regression tool (Chromatic, Percy, or a Playwright
screenshot-comparison step) runs against the Storybook build in CI. Without one, a
one-line CSS change — a padding tweak, a color-token rename, a z-index collision — ships
straight to every screen the shared component appears on, and the first anyone hears
about it is a bug report from a real user.

### BAD — Storybook exists but nothing screenshots it

```yaml
# .github/workflows/ci.yml
- run: npm run build-storybook
# Build succeeds and the artifact is thrown away. No pixel comparison ever runs;
# a shared component's visual output is never actually checked against anything.
```

### GOOD — Chromatic runs against every PR's Storybook build

```yaml
# .github/workflows/ci.yml
- name: Publish to Chromatic
  uses: chromaui/action@v1
  with:
    projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
    buildScriptName: build-storybook
    exitZeroOnChanges: false
# Every story is rendered and diffed pixel-for-pixel against the accepted baseline;
# an unintended style regression fails the check before merge.
```

---

## Check C — Stories only cover the happy-path state (VRT-003)

### Detection

For components that `angular-shared-ui-kit` and `angular-shared-libraries` already
require to support loading/error/empty/disabled states (a data table, a form field, a
dialog), check whether stories exist for each of those states, not just the default.
A visual regression suite that never renders the error state can't catch a regression in
a state nobody's snapshotting.

### BAD — data table story only shows the populated, loaded state

```typescript
// data-table.stories.ts
export const Default: StoryObj<DataTableComponent> = {
  args: { rows: mockRows, loading: false },
};
// No Empty, Loading, or Error story. If the empty-state illustration breaks, or the
// error banner's contrast regresses, no snapshot will ever catch it.
```

### GOOD — every documented state gets its own story

```typescript
export const Default: StoryObj<DataTableComponent> = { args: { rows: mockRows } };
export const Loading: StoryObj<DataTableComponent> = { args: { rows: [], loading: true } };
export const Empty: StoryObj<DataTableComponent> = { args: { rows: [], loading: false } };
export const ErrorState: StoryObj<DataTableComponent> = {
  args: { rows: [], error: 'Failed to load orders' },
};
```

---

## Check D — Snapshot diffs auto-accepted with no human review (VRT-004)

### Detection

Check the CI configuration and Chromatic/Percy project settings for auto-accept behavior
(`autoAcceptChanges: true`, or a CI step that runs `chromatic --auto-accept-changes`). A
visual regression tool that silently approves every diff is equivalent to not having one —
it only has value if a human confirms each visual change was intended before it becomes
the new baseline.

### BAD — CI auto-accepts every visual diff, defeating the point of snapshotting

```yaml
- name: Publish to Chromatic
  uses: chromaui/action@v1
  with:
    projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
    autoAcceptChanges: true
# Every PR's visual diffs become the new baseline automatically. An accidental
# regression and an intentional redesign look identical: both just pass.
```

### GOOD — diffs require explicit human approval before becoming baseline

```yaml
- name: Publish to Chromatic
  uses: chromaui/action@v1
  with:
    projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
    exitOnceUploaded: true
    # autoAcceptChanges omitted — a reviewer must approve each changed snapshot
    # in the Chromatic UI before the PR check turns green.
```

```markdown
<!-- docs/UI-KIT.md -->
Visual diffs on shared UI-kit components require sign-off from a UI-kit maintainer,
not just the PR author, before the snapshot is accepted as the new baseline.
```

---

## Check E — Theme variants not covered by visual regression (VRT-005)

### Detection

Cross-reference `angular-theming`'s light/dark/brand theme support: check whether stories
render (or a Chromatic modes config runs) each theme variant, not just the default light
theme. A dark-mode-only contrast regression — text that was readable in light mode but
drops below WCAG contrast in dark mode — is invisible to a suite that never snapshots dark
mode at all.

### BAD — stories and snapshots only ever render the default light theme

```typescript
// .storybook/preview.ts
export const parameters = {
  backgrounds: { default: 'light' },
};
// No dark or brand-theme story variant exists anywhere. A contrast regression
// introduced only under `[data-theme="dark"]` ships with zero visual coverage.
```

### GOOD — each theme is an explicit Chromatic mode, snapshotted independently

```typescript
// .storybook/preview.ts
export const parameters = {
  chromatic: {
    modes: {
      light: { theme: 'light' },
      dark: { theme: 'dark' },
      brand: { theme: 'brand' },
    },
  },
};
// Every story renders — and gets snapshotted — under all three themes. A dark-mode
// contrast regression now produces a visible diff in the Chromatic build.
```

---

## Check F — No hard CI gate for shared-library visual diffs (VRT-006)

### Detection

Distinguish app-level visual regression (advisory — a redesign-in-progress screen changing
constantly makes a hard gate noisy) from shared-library visual regression (used across
every consuming app — a hard gate is warranted). Check whether the shared-library repo's
branch protection requires the visual regression check to pass, versus it existing only as
an informational status that can be merged past.

### BAD — visual regression check exists but is not required, so PRs merge past unreviewed diffs

```
# Branch protection rules for libs/ui-kit:
Required checks: build, unit-tests
(chromatic/ui-review is not in the required list — merging is possible
 even with pending/unreviewed visual changes)
```

### GOOD — the shared-library repo hard-gates merges on visual review

```
# Branch protection rules for libs/ui-kit:
Required checks: build, unit-tests, chromatic/ui-review
# A PR touching libs/ui-kit cannot merge until every visual diff it introduces
# has been explicitly approved — shared components used everywhere don't get
# the same "we'll catch it later" treatment as an app-level screen.
```
