---
name: angular-motion-accessibility
description: Reviews Angular animation/motion accessibility per WCAG 2.2 (2.3.3 Animation from Interactions, 2.2.2 Pause/Stop/Hide) — the motion dimension angular-a11y doesn't cover. Flags animations with no prefers-reduced-motion fallback, auto-playing carousels/parallax without pause controls, route transitions moving focus early, hardcoded timing/easing with no shared token, and layout-affecting animation properties instead of compositor-friendly ones. Outputs pilot-angular motion-accessibility standard IDs.
when_to_use: prefers-reduced-motion, animation accessibility, WCAG 2.3.3, WCAG 2.2.2, auto-play carousel, parallax, pause control, route transition animation, angular animations, motion design token, transform vs top left, layout thrash, jank, easing timing
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| MOT-001 | P1 | Animations with no `prefers-reduced-motion: reduce` fallback (WCAG 2.3.3) |
| MOT-002 | P1 | Auto-playing carousel/parallax/loop with no pause/stop control (WCAG 2.2.2) |
| MOT-003 | P1 | Router page-transition moves focus before the transition visually completes |
| MOT-004 | P2 | Animation timing/easing hardcoded per-component with no shared design token |
| MOT-005 | P2 | Animations drive layout-affecting CSS properties instead of transform/opacity |

---

## Check A — No reduced-motion fallback (MOT-001)

### Detection

Grep `@angular/animations` `trigger()`/`transition()` definitions and CSS `@keyframes`/
`transition` rules for any that ignore the OS-level `prefers-reduced-motion` setting. Some
users enable "reduce motion" specifically because animation triggers vestibular disorders,
migraines, or nausea (WCAG 2.3.3 Animation from Interactions). Shipping every animation
unconditionally means the app actively works against an accessibility setting the user
explicitly turned on at the OS level.

### BAD — animation always plays regardless of OS setting

```typescript
export const slideIn = trigger('slideIn', [
  transition(':enter', [
    style({ transform: 'translateX(100%)', opacity: 0 }),
    animate('400ms ease-out', style({ transform: 'translateX(0)', opacity: 1 })),
  ]),
]);
```

### GOOD — reduced-motion query gates the animated variant

```typescript
const prefersReducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const slideIn = trigger('slideIn', [
  transition(':enter', [
    style({ transform: 'translateX(100%)', opacity: 0 }),
    animate(
      prefersReducedMotion ? '0ms' : '400ms ease-out',
      style({ transform: 'translateX(0)', opacity: 1 })
    ),
  ]),
]);
```

```css
/* CSS-driven animations: prefer a media query over JS branching where possible */
.card {
  transition: transform 400ms ease-out, opacity 400ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .card {
    transition: none;
  }
}
```

---

## Check B — Auto-playing motion with no pause control (MOT-002)

### Detection

Look for carousels, parallax scroll effects, or looping background animations that start
automatically on page load and have no visible, keyboard-reachable control to pause or stop
them. WCAG 2.2.2 (Pause, Stop, Hide) requires that any moving, blinking, or auto-updating
content lasting more than 5 seconds give the user a mechanism to pause it — continuously
moving content is a documented distraction and focus barrier for users with attention-related
and cognitive disabilities.

### BAD — carousel auto-plays forever with no pause affordance

```typescript
@Component({
  template: `<div class="slide">{{ slides()[activeIndex()] }}</div>`,
})
export class HeroCarouselComponent implements OnInit {
  slides = signal(['Slide 1', 'Slide 2', 'Slide 3']);
  activeIndex = signal(0);

  ngOnInit() {
    setInterval(() => {
      this.activeIndex.update(i => (i + 1) % this.slides().length); // runs forever, no way to stop it
    }, 3000);
  }
}
```

### GOOD — a visible, keyboard-operable pause/play toggle

```typescript
@Component({
  template: `
    <div class="slide">{{ slides()[activeIndex()] }}</div>
    <button type="button" (click)="togglePlay()">
      {{ playing() ? 'Pause' : 'Play' }} slideshow
    </button>
  `,
})
export class HeroCarouselComponent implements OnDestroy {
  slides = signal(['Slide 1', 'Slide 2', 'Slide 3']);
  activeIndex = signal(0);
  playing = signal(true);
  private intervalId?: ReturnType<typeof setInterval>;

  constructor() {
    this.start();
  }

  togglePlay() {
    this.playing.update(p => !p);
    this.playing() ? this.start() : this.stop();
  }

  private start() {
    this.intervalId = setInterval(() => {
      this.activeIndex.update(i => (i + 1) % this.slides().length);
    }, 3000);
  }
  private stop() { clearInterval(this.intervalId); }
  ngOnDestroy() { this.stop(); }
}
```

---

## Check C — Route transition moves focus before it visually completes (MOT-003)

### Detection

When a router page-transition animation is combined with the focus-management pattern from
`angular-a11y` (moving focus to the main heading on `NavigationEnd`), check the timing: is
focus moved the instant the route resolves, while the outgoing view is still animating out
and the incoming view is still animating in? A screen reader announces the newly-focused
content immediately, but sighted keyboard users watching the still-mid-transition screen get
a jarring mismatch between what's announced and what's visible — and focus can even land on
an element that hasn't finished animating into its final position.

### BAD — focus jumps immediately, mid-animation

```typescript
this.router.events.pipe(
  filter(e => e instanceof NavigationEnd),
  takeUntilDestroyed()
).subscribe(() => {
  this.mainRef()?.nativeElement.focus(); // page transition animation is still running
});
```

### GOOD — focus moves after the transition animation finishes

```typescript
@Component({
  template: `
    <main #mainContent tabindex="-1" [@routeFade]="outlet.isActivated ? outlet.activatedRoute : ''"
          (@routeFade.done)="onTransitionDone()">
      <router-outlet #outlet="outlet" />
    </main>
  `,
  animations: [routeFadeAnimation],
})
export class AppComponent {
  private mainRef = viewChild<ElementRef>('mainContent');

  onTransitionDone() {
    this.mainRef()?.nativeElement.focus(); // fires only once the animation callback confirms completion
  }
}
```

For `prefers-reduced-motion` users (Check A), the transition duration collapses to `0ms`, so
`(@routeFade.done)` still fires immediately — focus management stays correct in both cases.

---

## Check D — Hardcoded per-component timing/easing (MOT-004)

### Detection

Grep for `animate('400ms ease-out', ...)`-style literals repeated with slightly different
values (`350ms ease-in`, `500ms ease`, `300ms cubic-bezier(...)`) scattered across many
components. Inconsistent durations and easing curves make transitions feel like they belong
to different apps stitched together, and any future motion-language change (e.g., adopting
Material's standard easing) requires hunting down every literal individually instead of
updating one shared source.

### BAD — every component invents its own timing values

```typescript
// modal.component.ts
animate('350ms ease-in', style({ opacity: 1 }))
// toast.component.ts
animate('500ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 1 }))
// drawer.component.ts
animate('300ms ease', style({ transform: 'translateX(0)' }))
```

### GOOD — shared motion tokens consumed everywhere

```typescript
// shared/motion-tokens.ts
export const MotionTokens = {
  duration: { fast: '150ms', standard: '300ms', slow: '450ms' },
  easing: { standard: 'cubic-bezier(0.4, 0, 0.2, 1)', decelerate: 'cubic-bezier(0, 0, 0.2, 1)' },
} as const;
```

```typescript
animate(`${MotionTokens.duration.standard} ${MotionTokens.easing.standard}`, style({ opacity: 1 }))
```

---

## Check E — Animating layout-affecting properties instead of transform/opacity (MOT-005)

### Detection

Grep animation `style()`/CSS `transition` declarations for `width`, `height`, `top`, `left`,
`margin`, or other properties that trigger browser layout recalculation on every frame.
Animating these forces the browser to re-run layout and paint for the whole affected subtree
at 60fps, causing visible jank and dropped frames — especially on lower-end or mobile devices.
`transform` and `opacity` are compositor-only properties that animate on the GPU without
touching layout at all.

### BAD — animating `top`/`left`/`width` causes layout thrash

```typescript
export const expandPanel = trigger('expandPanel', [
  transition(':enter', [
    style({ width: '0px', top: '-20px' }),
    animate('300ms ease-out', style({ width: '320px', top: '0px' })), // triggers layout every frame
  ]),
]);
```

### GOOD — compositor-friendly transform/opacity achieve the same visual effect

```typescript
export const expandPanel = trigger('expandPanel', [
  transition(':enter', [
    style({ transform: 'scaleX(0) translateY(-20px)', transformOrigin: 'left', opacity: 0 }),
    animate(
      '300ms ease-out',
      style({ transform: 'scaleX(1) translateY(0)', opacity: 1 }) // GPU-composited, no layout recalculation
    ),
  ]),
]);
```

Reserve `width`/`height`/`top`/`left` animation only for cases with no transform-based
equivalent, and profile with DevTools' Performance panel to confirm no layout thrash remains.
