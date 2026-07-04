---
name: angular-testing
description: Reviews Angular test suite conventions. Flags component tests that query the DOM by CSS class/tag instead of accessible role/label, HTTP calls in component tests hitting a real HttpClient instead of HttpTestingController, Angular Material components tested via raw DOM queries instead of Component Test Harnesses, no documented e2e convention despite Playwright tooling being available, and signal-based components tested by triggering change detection ad-hoc instead of via proper flush/harness APIs.
when_to_use: component testing, TestBed, HttpTestingController, Angular Testing Library, Component Test Harness, ComponentFixture, e2e testing, Playwright Angular, signal testing, flushEffects, unit test Angular, spectator, jasmine, jest
applies_to: angular>=17
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ATS-001 | P1 | Component test queries the DOM by CSS class/tag instead of accessible role/label |
| ATS-002 | P1 | HTTP call in a test hits a real `HttpClient` instead of `HttpTestingController` |
| ATS-003 | P2 | Material component tested via raw DOM queries instead of a Component Test Harness |
| ATS-004 | P2 | No documented e2e convention despite Playwright tooling being available |
| ATS-005 | P3 | Signal-based component tested via ad-hoc change detection instead of flush/harness APIs (advisory) |

---

## Check A — Tests query by CSS class/tag instead of accessible role/label (ATS-001)

### Detection

Grep test files for `fixture.nativeElement.querySelector('.some-class')` or
`By.css('button')` where an accessible query (`getByRole`, `getByLabelText` — Angular
Testing Library) would work instead. CSS-class-based queries break on any refactor of
styling and, more importantly, don't verify the same accessibility contract `angular-a11y`
requires (a button findable only by class might not have an accessible name at all).

### BAD — brittle CSS-class query

```typescript
const button = fixture.nativeElement.querySelector('.approve-btn');
button.click();
```

### GOOD — query by accessible role, which also proves the a11y contract holds

```typescript
import { render, screen } from '@testing-library/angular';

await render(ApproveOrderComponent);
const button = screen.getByRole('button', { name: /approve/i });
await userEvent.click(button);
```

---

## Check B — Real HttpClient hit in a component test (ATS-002)

### Detection

Grep component/service tests for `HttpClientModule`/`provideHttpClient()` imported without
`provideHttpClientTesting()`, or tests that don't call `HttpTestingController.expectOne(...)`
— a test that lets a real request escape either hangs, hits a real network endpoint, or
silently no-ops depending on environment.

### BAD — real HttpClient wired into a component test

```typescript
TestBed.configureTestingModule({
  providers: [provideHttpClient()], // real network calls possible in tests
});
```

### GOOD — HttpTestingController intercepts every request

```typescript
TestBed.configureTestingModule({
  providers: [provideHttpClient(), provideHttpClientTesting()],
});

const httpMock = TestBed.inject(HttpTestingController);
service.getOrders().subscribe(orders => expect(orders.length).toBe(2));

const req = httpMock.expectOne('/api/orders');
req.flush([{ id: 1 }, { id: 2 }]);
httpMock.verify(); // fails the test if any request went unhandled
```

---

## Check C — Material component tested via raw DOM instead of a harness (ATS-003)

### Detection

Grep tests interacting with Angular Material components (`mat-select`, `mat-checkbox`,
`mat-button`) via `querySelector`/`triggerEventHandler` instead of the corresponding
`ComponentHarness` (`MatSelectHarness`, `MatButtonHarness`) — harnesses are versioned
alongside Material internals and don't break when Material changes its internal DOM
structure between releases.

### BAD — raw DOM manipulation of a Material component

```typescript
const select = fixture.nativeElement.querySelector('mat-select');
select.click(); // depends on Material's internal DOM structure
```

### GOOD — Component Test Harness

```typescript
const loader = TestbedHarnessEnvironment.loader(fixture);
const select = await loader.getHarness(MatSelectHarness);
await select.clickOptions({ text: 'Approved' });
```

---

## Check D — No documented e2e convention (ATS-004)

### Detection

Check whether the project has any stated e2e testing convention. `pilot-core` already
ships a Playwright MCP server in this very marketplace with no house standard for when a
flow needs e2e coverage (critical user journeys: login, checkout, approval flows) versus
component-level tests being sufficient. Flag a codebase with zero e2e tests and no
documented rationale for that choice.

### BAD — no e2e coverage, no documented reason

```
# No playwright.config.ts, no e2e/ directory, no note explaining why not.
```

### GOOD — critical-path e2e coverage with a documented scope

```typescript
// e2e/order-approval.spec.ts — Playwright
test('manager can approve a pending order', async ({ page }) => {
  await page.goto('/orders/123');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Order approved')).toBeVisible();
});
```

```markdown
<!-- docs/TESTING.md -->
e2e (Playwright) covers: login, order approval, checkout. Everything else is
component/unit tests only — e2e is reserved for flows spanning multiple pages/services.
```

---

## Check E — Signal-based components tested with ad-hoc change detection (ATS-005, advisory)

### Detection

For components built with `signal()`/`computed()`/`effect()` (per
`angular-signals-and-state`), check whether tests trigger updates via
`fixture.detectChanges()` calls scattered arbitrarily, or use `TestBed.flushEffects()` and
harness-driven interaction that matches how signals actually propagate.

### BAD — arbitrary detectChanges() calls hoping effects have run

```typescript
component.count.set(5);
fixture.detectChanges();
fixture.detectChanges(); // called twice "just in case" the effect hadn't run yet
```

### GOOD — explicit effect flush

```typescript
component.count.set(5);
TestBed.flushEffects();
fixture.detectChanges();
expect(fixture.nativeElement.textContent).toContain('5');
```
