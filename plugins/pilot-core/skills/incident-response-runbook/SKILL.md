---
name: incident-response-runbook
description: Defines what happens after an azure-observability alert fires — the response layer this marketplace's observability/alerting skills wire up but don't govern. Flags an alert with no linked runbook, no severity-to-response-time SLA, no blameless-postmortem template/process, and no tracked action-item follow-through after an incident closes. Outputs findings with pilot-core incident-response standard IDs.
when_to_use: incident response, runbook, postmortem, blameless postmortem, on-call, severity SLA, action item tracking, alert response, incident commander, retrospective template
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| IR-001 | P1 | Alert rule has no linked runbook describing the response procedure |
| IR-002 | P1 | No severity-to-response-time SLA for on-call |
| IR-003 | P2 | No blameless-postmortem template/process for incidents above a severity threshold |
| IR-004 | P2 | No tracked follow-through on postmortem action items |

This skill governs the response layer sitting on top of `azure-observability`'s alert
rules/action groups (AOBS-003) and `dotnet-observability`'s health checks — those skills
get the page to fire; this one governs what a human does once it does.

---

## Check A — Alert with no linked runbook (IR-001)

### Detection

For each alert rule (`azure-observability` AOBS-003), check whether it links to (or its
description contains) a runbook: what this alert means, likely causes, first diagnostic
steps, and escalation path. An alert that just says "DTU utilization high" with no
runbook forces every on-call responder to rediscover the same diagnostic steps from
scratch during an active incident — exactly when that time is most expensive.

### BAD — alert fires with no actionable context

```bicep
resource dtuAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  properties: {
    description: 'SQL DB DTU utilization > 80%'
    // No runbook link — on-call has to figure out what to do from scratch, at 3am, mid-incident.
  }
}
```

### GOOD — alert links directly to its runbook

```bicep
resource dtuAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  properties: {
    description: 'SQL DB DTU utilization > 80%. Runbook: https://wiki.internal/runbooks/sql-dtu-high'
  }
}
```

```markdown
<!-- runbooks/sql-dtu-high.md -->
## SQL DB DTU utilization high

**Likely causes:** missing index (check sql-performance-review findings), a runaway
report query, or genuine traffic growth needing a tier bump.

**First steps:** 1) Check Query Store for top resource consumers. 2) Check for a recent
deploy correlating with the spike. 3) If genuine growth, scale tier per azure-cost-finops
right-sizing review — don't scale blindly under incident pressure.

**Escalate to:** #data-platform-oncall if not resolved in 30 minutes.
```

---

## Check B — No severity-to-response-time SLA (IR-002)

### Detection

Check for a documented on-call response-time SLA keyed to incident severity — without one,
"how fast should someone acknowledge this page" has no answer, and different responders
apply their own judgment inconsistently.

### BAD — no stated response-time expectation

```markdown
<!-- No SLA documented anywhere for how quickly a P0 page must be acknowledged. -->
```

### GOOD — explicit SLA tied to the same severity scale used elsewhere in this marketplace

```markdown
<!-- docs/ONCALL.md -->
| Severity | Acknowledge within | Mitigate within |
|---|---|---|
| SEV1 (full outage) | 5 minutes | 1 hour |
| SEV2 (degraded, workaround exists) | 15 minutes | 4 hours |
| SEV3 (minor, no user impact yet) | Next business day | — |
```

---

## Check C — No blameless-postmortem process (IR-003)

### Detection

Check whether incidents above a documented severity threshold (e.g., every SEV1/SEV2)
require a postmortem, and whether a template exists that focuses on systemic
contributing factors rather than individual blame — a process is much more likely to
surface true root causes when engineers aren't worried the writeup will be used against
them.

### BAD — no postmortem process, or one that names individuals as the cause

```markdown
<!-- Root cause: John forgot to update the connection string before deploying. -->
```

### GOOD — blameless template focused on systemic factors and process gaps

```markdown
<!-- docs/POSTMORTEM-TEMPLATE.md -->
## Incident summary
**What happened, what was the user impact, how long did it last.**

## Timeline
**Detection → mitigation → resolution, with timestamps.**

## Contributing factors (not "who")
- Why didn't a health check (dotnet-observability OBS-001) catch this before the deploy?
- Why didn't the CI/CD approval gate (azure-cicd-security CICD-002) surface this?

## Action items
**Each with an owner and a due date — see Check D.**
```

---

## Check D — No tracked follow-through on action items (IR-004)

### Detection

Check whether postmortem action items are tracked to completion (linked issues with
owners and due dates) versus living only inside a postmortem document that nobody
revisits — the same category of near-miss recurring because the fix everyone agreed on
during the postmortem never actually shipped.

### BAD — action items listed in the postmortem doc, never tracked anywhere else

```markdown
## Action items
- Add a health check for the payment gateway dependency
- Add an alert for connection-pool exhaustion
<!-- No linked issues, no owners, no due dates — revisit this doc in 6 months and nothing changed. -->
```

### GOOD — action items become tracked issues with owners and due dates

```markdown
## Action items
- [ ] Add health check for payment gateway dependency (#1423, @owner, due 2026-07-15)
- [ ] Add connection-pool-exhaustion alert (#1424, @owner, due 2026-07-10)
```

A recurring review (monthly, at the postmortem-review meeting) checks open action items
for staleness the same way `azure-cost-finops` FIN-004 checks for orphaned resources.
