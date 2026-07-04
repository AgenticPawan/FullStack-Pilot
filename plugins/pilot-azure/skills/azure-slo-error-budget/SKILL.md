---
name: azure-slo-error-budget
description: Reviews proactive reliability target-setting — the SLO/error-budget layer above incident-response-runbook's reactive severity SLAs. Flags no defined SLO for a customer-facing service, no error-budget policy gating release velocity when the budget is exhausted, SLIs that don't match what users actually experience, and no dashboard surfacing current budget consumption. Outputs findings with pilot-azure slo-error-budget standard IDs.
when_to_use: SLO, service level objective, error budget, SLI, service level indicator, error budget policy, release freeze, reliability target, availability target
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| SLO-001 | P1 | No defined SLO for a customer-facing service |
| SLO-002 | P1 | No error-budget policy gating release velocity when the budget is exhausted |
| SLO-003 | P2 | SLI doesn't match what users actually experience |
| SLO-004 | P2 | No dashboard surfacing current error-budget consumption |

`incident-response-runbook` governs the reactive side (how fast to respond once
something breaks). This skill governs the proactive side — deciding in advance how much
unreliability is acceptable, and what happens automatically once that budget is spent.

---

## Check A — No defined SLO (SLO-001)

### Detection

Check whether each customer-facing service has an explicit SLO (e.g., "99.9% of requests
succeed with < 500ms latency, measured monthly") backed by an SLI computed from real
telemetry (`azure-observability`'s Application Insights data, or the health checks
`dotnet-observability` OBS-001 establishes). Without one, "is the service reliable
enough" has no answer beyond gut feeling, and there's no way to tell whether a
degradation is within acceptable bounds or a real problem.

### BAD — no stated reliability target for a customer-facing service

```markdown
<!-- No SLO documented anywhere for the Orders API. "Is it reliable enough" is
     answered by vibes, not by a number anyone agreed to in advance. -->
```

### GOOD — an explicit SLO backed by a measurable SLI

```markdown
<!-- docs/SLO.md -->
**Orders API SLO:** 99.9% of requests return within 500ms over a rolling 30-day window.
**SLI:** (successful requests < 500ms) / (total requests), computed from Application
Insights request telemetry, excluding requests to `/health/*` endpoints.
```

---

## Check B — No error-budget policy gating release velocity (SLO-002)

### Detection

Check whether there's a documented policy for what happens once the error budget (the
allowed unreliability under the SLO — 0.1% for a 99.9% target) is exhausted within the
measurement window: typically a feature-release freeze until reliability work brings the
service back within budget. Without a policy, an SLO is just a number nobody acts on —
the entire point of an error budget is that it's a forcing function, not a vanity metric.

### BAD — SLO exists, but nothing happens when the budget is blown

```markdown
<!-- Orders API has burned through its entire monthly error budget by day 10, but
     feature releases continue on the normal schedule regardless — the SLO is decorative. -->
```

### GOOD — an error-budget policy with real teeth

```markdown
<!-- docs/SLO.md -->
**Error-budget policy:** If the Orders API's error budget is more than 50% consumed
before the 15th of the month, new feature releases pause; only reliability fixes and
P0/P1 incident remediation (per incident-response-runbook) ship until the budget
recovers. Enforced via a release-checklist gate, not just a documented expectation.
```

---

## Check C — SLI doesn't match user experience (SLO-003)

### Detection

Check whether the SLI actually reflects what a user experiences, versus a proxy metric
that's easy to measure but doesn't correlate — e.g., measuring server-side request
success/latency while ignoring that the Angular frontend's own error handling
(`angular-error-handling`) might surface a failure to the user even when the backend
technically "succeeded" (a slow-but-successful response the user perceives as broken).

### BAD — SLI measures server-side success only, misses the user's actual experience

```markdown
<!-- SLI: backend request success rate. Meanwhile the Angular app's HTTP interceptor
     retries silently 3 times before showing an error — by the time the user sees a
     failure, the backend has already logged 3 "successful" retried requests, masking
     the real user-facing failure rate. -->
```

### GOOD — SLI accounts for the full request path including client-side retries

```markdown
<!-- SLI: percentage of user-initiated actions (tracked via angular-telemetry's
     trackEvent calls, correlated to backend traces via the shared correlation ID)
     that complete successfully within 500ms, counting a client-side retry exhaustion
     as a failure even if an individual backend attempt "succeeded." -->
```

---

## Check D — No dashboard surfacing budget consumption (SLO-004)

### Detection

Check for a live dashboard (Azure Monitor workbook, Grafana) showing current error-budget
consumption against the SLO, versus the SLO living only in a document nobody checks
until an incident forces a look. A budget that's only calculated retroactively during a
postmortem can't function as the proactive gating mechanism Check B describes.

### BAD — SLO computed only after the fact, during postmortems

```
<!-- Nobody knows the current error-budget consumption until someone manually
     calculates it during a postmortem — by which point the budget-gating decision
     in Check B has already been missed for weeks. -->
```

### GOOD — a live workbook tracking budget burn-down in real time

```bicep
resource sloWorkbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  properties: {
    displayName: 'Orders API — SLO Error Budget'
    // Queries request telemetry for the rolling-window success rate against the 99.9%
    // target, visualized as a burn-down chart so the team sees consumption trending
    // toward the release-freeze threshold before it's actually hit.
  }
}
```
