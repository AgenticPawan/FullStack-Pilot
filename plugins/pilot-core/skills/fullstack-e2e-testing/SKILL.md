---
name: fullstack-e2e-testing
description: Reviews end-to-end user-journey test coverage across the deployed SPA + API + SQL stack — the tier the per-layer testing skills each only half-cover. Flags no E2E suite driving a full critical journey through a real browser, E2E tests mocking the API instead of a real backend, shared mutable test data with no per-run isolation, no pre-deploy CI gate, and flaky tests masked with retries/skips instead of fixed. Outputs pilot-core fullstack-e2e-testing standard IDs.
when_to_use: end to end testing, E2E, Playwright, Cypress, user journey test, full stack test, browser automation, smoke test deployed environment, test data isolation, seeded test data, flaky test quarantine, e2e ci gate, integration across layers, contract drift caught by e2e, deployed environment verification
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| E2E-001 | P1 | No E2E suite exercising any full critical user journey through a real browser against a deployed stack |
| E2E-002 | P1 | E2E tests mock the API/DB instead of driving the real backend — they prove nothing about the seam |
| E2E-003 | P2 | Shared mutable test data with no per-run seeding/isolation → order-dependent, flaky runs |
| E2E-004 | P1 | E2E suite not wired as a pre-deploy/CI gate — runs manually, or never |
| E2E-005 | P2 | Flaky E2E tests masked with blanket retries / `.skip` instead of root-cause fixes |

The per-layer testing skills (`angular-testing`, `dotnet-testing`, `sql-tsql-testing`) each
verify one side in isolation with the others mocked. This skill governs the one tier that
drives a real browser through the whole stack — the only place the SPA↔API↔DB seam
(`api-design-standards`, `auth-token-contract`, `realtime-contract`) is exercised against
reality rather than a static contract lint. Seed data ties to `test-data-management`; the
CI gate ties to `load-performance-testing`'s deploy-gate pattern.

---

## Check A — No E2E coverage of a critical journey (E2E-001)

### Detection

Check for at least one E2E test (Playwright/Cypress) that drives a real browser through a
full critical journey — log in, perform the core action, see the persisted result — end to
end against a running SPA + API + DB. Its absence means no test anywhere proves the
assembled system works; unit and integration suites can all pass while the wired-together
app is broken at the seam.

### BAD — every layer unit-tested, nothing exercises the whole journey

```
tests/
  angular/  → component specs, HttpClient mocked
  api/      → controller tests, DbContext in-memory
  sql/      → tSQLt unit tests
# No test ever logs in through the browser and places a real order against the real API.
```

### GOOD — a Playwright journey through the real stack

```ts
// e2e/checkout.spec.ts
test('user places an order and sees it in their history', async ({ page }) => {
  await login(page, seededUser);          // real OIDC redirect against the running API
  await page.goto('/catalog');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('Order confirmed')).toBeVisible();
  await page.goto('/orders');
  await expect(page.getByRole('row', { name: /just now/ })).toBeVisible();
});
```

---

## Check B — E2E tests mock the backend (E2E-002)

### Detection

Check whether the "E2E" suite intercepts/stubs API responses (e.g. `page.route(...)`
returning canned JSON, `cy.intercept` with fixtures for the core flow). Mocking the backend
turns an E2E test into a slow component test that can pass while the real API contract has
drifted — defeating the one thing E2E is for.

### BAD — the checkout API stubbed, so the real contract is never touched

```ts
await page.route('**/api/orders', route =>
  route.fulfill({ json: { id: 1, status: 'Confirmed' } }));   // real API never called
```

### GOOD — hit the real API; stub only genuinely external third parties

```ts
// No route stub for /api/**. The only interception is the external payment sandbox,
// which is out of scope for our own contract and unsafe to hit for real in CI.
await page.route('**/payment-provider.example/**', mockPaymentSandbox);
```

---

## Check C — No test-data isolation (E2E-003)

### Detection

Check how each run gets its data. Tests that mutate shared rows (a fixed "test user" whose
state accumulates across runs) become order-dependent and flaky. Each run should seed its
own isolated data and clean up, drawing on `test-data-management` for anonymized/synthetic
seeds.

### GOOD — per-run seeded, isolated fixtures

```ts
test.beforeEach(async () => {
  seededUser = await seedApi.createUser();      // unique per run, torn down after
  await seedApi.seedCatalog(seededUser.tenantId);
});
test.afterEach(async () => { await seedApi.purge(seededUser.tenantId); });
```

---

## Check D — E2E not wired as a CI gate (E2E-004)

### Detection

Check the pipeline: does the E2E suite run automatically and block promotion to the next
environment, or is it a manual step someone runs "before big releases"? An E2E suite that
doesn't gate deploys catches regressions only after they ship.

### GOOD — E2E gates the deploy job

```yaml
# .github/workflows/deploy.yml
jobs:
  e2e:
    steps:
      - run: npx playwright test --project=chromium
  deploy:
    needs: e2e          # deploy only runs if the E2E job passed
```

---

## Check E — Flakiness masked instead of fixed (E2E-005)

### Detection

Check for blanket `retries` cranked up globally, or `.skip`/`.fixme` accumulating on tests
that "sometimes fail". Retries and skips hide real races (missing awaits, timing
assumptions, shared state from Check C) and let genuine regressions slip through as "just
flaky again".

### BAD — global retries hiding a real race

```ts
export default defineConfig({ retries: 5 });   // a test that needs 5 tries is telling you something
```

### GOOD — deterministic waits; quarantine is tracked and time-boxed

```ts
export default defineConfig({ retries: process.env.CI ? 1 : 0 });
// Web-first assertions (auto-retrying expect) instead of arbitrary sleeps; any test moved
// to a quarantine tag has a linked bug and a deadline, not an open-ended .skip.
```
