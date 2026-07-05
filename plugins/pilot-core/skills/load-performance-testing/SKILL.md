---
name: load-performance-testing
description: Reviews load/performance testing strategy and release-gating, tying thresholds to the SLO/error-budget targets defined via azure-slo-error-budget and using Azure Load Testing. Flags no load testing before shipping a hot-path change, thresholds chosen arbitrarily instead of derived from SLOs, tests run against a non-representative environment, no CI/CD-wired regression gate, and scenarios that only model the happy path and never simulate retry storms under partial downstream failure. Outputs findings with pilot-core load-performance-testing standard IDs.
when_to_use: load testing, performance testing, Azure Load Testing, JMeter, k6, capacity planning, SLO threshold, error budget, staging environment representativeness, performance regression gate, thundering herd, retry storm, hot path endpoint
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| LPT-001 | P1 | No load testing performed before shipping a change to a hot-path endpoint |
| LPT-002 | P1 | Load test thresholds chosen arbitrarily instead of derived from SLO/error-budget targets |
| LPT-003 | P2 | Load tests run against a non-representative environment |
| LPT-004 | P1 | No load test wired into CI/CD as an automated regression gate |
| LPT-005 | P2 | Load test scenarios model only the happy path, never retry storms/thundering herd |

This skill governs *when and how* load tests get run and what they're allowed to gate.
The actual performance targets they test against come from `azure-slo-error-budget`'s
defined SLOs — this skill doesn't invent new thresholds, it enforces that load tests are
honest about the ones that already exist. Retry-storm scenarios (Check E) tie into
`dotnet-resilience` and `dotnet-chaos-engineering` for how the system should behave under
partial downstream failure.

---

## Check A — No load testing before a hot-path change ships (LPT-001)

### Detection

For a change touching a known hot-path endpoint (checkout, search, an endpoint already
identified as high-traffic in `azure-slo-error-budget`'s SLOs), check whether any load test
ran before the change shipped. Without one, the first signal that a change regressed
capacity is production itself — either a slow degradation customers notice before an
alert fires, or an outright outage during a traffic spike the change couldn't handle,
discovered under the worst possible conditions.

### BAD — a checkout-path change ships with only unit/integration tests

```yaml
# .github/workflows/deploy.yml
- run: dotnet test
- run: npm test
- run: az webapp deploy ...
# No load test anywhere. The new checkout query path's capacity under real traffic
# is unknown until Black Friday traffic hits it for the first time.
```

### GOOD — a load test gate runs before deploying a hot-path change

```yaml
# .github/workflows/deploy.yml
- run: dotnet test
- run: npm test
- name: Load test checkout path
  uses: azure/load-testing@v1
  with:
    loadTestConfigFile: loadtests/checkout.yaml
    resourceGroup: rg-loadtesting
    loadTestResource: lt-checkout
- run: az webapp deploy ...   # only runs if the load test step above passed
```

---

## Check B — Thresholds chosen arbitrarily instead of derived from SLOs (LPT-002)

### Detection

Check the load test's pass/fail thresholds (p95 latency, error rate) against the SLO
targets actually committed to in `azure-slo-error-budget`. A load test that "passes" at a
threshold the team picked because it felt achievable — rather than the number the business
actually promised — gives false confidence: production can meet the load test's bar while
still burning through the real error budget, because the two numbers were never the same
number.

### BAD — the load test's threshold has no connection to the documented SLO

```yaml
# loadtests/checkout.yaml
# SLO (azure-slo-error-budget): p95 latency < 300ms, error rate < 0.1%
success-criteria:
  - avg(response_time_ms) > 800    # "avg" and "800ms" — neither matches the p95/300ms SLO
```

### GOOD — the load test asserts against the actual SLO metric and target

```yaml
# loadtests/checkout.yaml
# Directly sourced from azure-slo-error-budget's checkout-service SLO definition.
success-criteria:
  - percentage(response_time_ms > 300) < 5   # p95 < 300ms per the committed SLO
  - error_percentage < 0.1                    # matches the committed error budget
```

```markdown
<!-- loadtests/README.md -->
Every load test's success criteria must cite the SLO document (azure-slo-error-budget)
it's derived from. A threshold with no SLO citation is treated as unreviewed and
must not gate a release on its own.
```

---

## Check C — Load tests run against a non-representative environment (LPT-003)

### Detection

Check what environment the load test actually targets: an under-provisioned staging tier,
a cold cache with no warm-up phase, or seed data orders of magnitude smaller than
production (a "products" table with 500 rows tested when production holds 50 million).
Any of these produces a falsely reassuring pass — the environment simply can't reproduce
the query plans, cache-miss rates, or contention that production traffic will hit.

### BAD — load test targets a tiny staging tier with toy seed data

```yaml
# loadtests/checkout.yaml
target: https://staging-checkout.azurewebsites.net   # B1 tier vs prod's P2v3
# Staging DB seeded with 200 sample products; production catalog has 4.2 million.
# Query plans that scan-and-filter fine at 200 rows fall over at production scale —
# this load test cannot possibly surface that.
```

### GOOD — load test targets a production-equivalent tier with production-scale data

```yaml
# loadtests/checkout.yaml
target: https://loadtest-checkout.azurewebsites.net   # same tier/SKU as production
# Seeded from an anonymized production-scale snapshot (see test-data-management)
# so query plans and cache behavior match what production will actually see.
warmup:
  duration: 5m   # cache populated before measurement starts, avoiding a cold-cache
                 # result that doesn't reflect steady-state production behavior
```

---

## Check D — No CI/CD-wired regression gate (LPT-004)

### Detection

Check whether load tests run automatically as part of the deployment pipeline (blocking a
release on regression) versus only ad hoc, run manually by whoever remembers to before a
big launch. Without an automated gate, a gradual performance regression introduced over
several small PRs — none individually load-tested — ships silently and is only caught
later by production alerting, after users already felt it.

### BAD — load testing exists only as a manual, occasional exercise

```markdown
<!-- Runbook note: "Run a load test before major releases." -->
<!-- Last run: 7 months ago, before the Q4 launch. Twelve deploys have shipped since,
     with no load test against any of them. -->
```

### GOOD — load test runs automatically on every deploy to the hot-path service, gating the release

```yaml
# .github/workflows/deploy-checkout-service.yml
on:
  push:
    branches: [main]
    paths: ["src/CheckoutService/**"]
jobs:
  loadtest:
    runs-on: ubuntu-latest
    steps:
      - uses: azure/load-testing@v1
        with:
          loadTestConfigFile: loadtests/checkout.yaml
  deploy:
    needs: loadtest   # deploy job only runs if the load test job passed
    runs-on: ubuntu-latest
    steps:
      - run: az webapp deploy ...
```

---

## Check E — Scenarios only model the happy path (LPT-005)

### Detection

Check whether load test scenarios include a downstream-failure condition (a dependency
timing out or returning 5xx under load) in addition to the pure happy-path scenario.
Happy-path-only load testing never exercises retry-storm/thundering-herd behavior — the
pattern where a struggling downstream service gets hammered by retries from every caller
simultaneously and is driven from "slow" to "fully down." Whether the system's resilience
policies (`dotnet-resilience`) and chaos scenarios (`dotnet-chaos-engineering`) actually
prevent that under real load is exactly what a happy-path-only test can never tell you.

### BAD — load test only ever exercises the fully-healthy path

```yaml
# loadtests/checkout.yaml
scenario: happy-path
steps:
  - GET /products
  - POST /cart/items
  - POST /orders
# Never simulates the payment-gateway dependency degrading under load — the retry/
# circuit-breaker policy from dotnet-resilience has never actually been load-tested.
```

### GOOD — a companion scenario injects downstream failure under load

```yaml
# loadtests/checkout-degraded-dependency.yaml
scenario: payment-gateway-degraded
setup:
  # Chaos fault injected per dotnet-chaos-engineering: payment gateway responds
  # with 503 for 30% of calls and adds 2s latency, for the duration of the test.
  chaos-fault: payment-gateway-partial-outage
steps:
  - GET /products
  - POST /cart/items
  - POST /orders
success-criteria:
  - error_percentage < 5   # circuit breaker should shed load gracefully, not cascade
  - no_retry_amplification: true   # verifies retries don't multiply load on the
                                     # already-struggling dependency (dotnet-resilience)
```
