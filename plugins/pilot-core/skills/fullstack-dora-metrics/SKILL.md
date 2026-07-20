---
name: fullstack-dora-metrics
description: "Instruments and baselines the four DORA metrics (deployment frequency, lead time for changes, change failure rate, mean time to restore) across Angular CI pipelines and .NET/Azure deployments: GitHub Actions workflow tagging, Azure Monitor workbook queries, alert rules for MTTR SLO, and a starter dashboard template. Outputs baseline measurements and top-3 improvement recommendations."
when_to_use: dora metrics, deployment frequency, lead time, change failure rate, mean time to restore, mttr, devops performance, deployment pipeline, azure monitor, dora dashboard, four keys, github actions metrics, elite performer, accelerate
---

## DORA metric definitions and target tiers

| Metric | Elite | High | Medium | Low |
|--------|-------|------|--------|-----|
| Deployment frequency | On-demand (multiple/day) | Once/week–month | Once/month–6mo | <6mo |
| Lead time for changes | <1 hour | 1 day–1 week | 1 week–1 month | >6 months |
| Change failure rate | <5% | 5–10% | 10–15% | >15% |
| MTTR | <1 hour | <1 day | <1 week | >6 months |

---

## Instrumentation

### Deployment frequency — GitHub Actions

Tag every successful deployment job with a custom event sent to Application Insights:

```yaml
# .github/workflows/deploy.yml
- name: Track deployment event
  if: success()
  run: |
    az monitor app-insights events track \
      --app ${{ vars.APPINSIGHTS_NAME }} \
      --resource-group ${{ vars.RG }} \
      --name "DeploymentCompleted" \
      --properties '{"environment":"${{ inputs.environment }}","version":"${{ github.sha }}"}'
```

**Azure Monitor KQL — deployment frequency (last 30 days)**

```kusto
customEvents
| where name == "DeploymentCompleted"
| where timestamp > ago(30d)
| summarize DeploymentCount = count(), DistinctDays = dcount(bin(timestamp, 1d))
| extend FrequencyPerDay = round(toreal(DeploymentCount) / 30, 2)
```

---

### Lead time for changes — PR merge to production deploy

```kusto
// Requires DeploymentCompleted events with pr_merged_at property
customEvents
| where name == "DeploymentCompleted"
| where timestamp > ago(30d)
| extend MergedAt = todatetime(customDimensions["pr_merged_at"])
| extend LeadTimeHours = datetime_diff("hour", timestamp, MergedAt)
| summarize P50LeadTime = percentile(LeadTimeHours, 50), P95LeadTime = percentile(LeadTimeHours, 95)
```

---

### Change failure rate — failed deployments

```kusto
customEvents
| where name in ("DeploymentCompleted", "DeploymentFailed", "RollbackCompleted")
| where timestamp > ago(30d)
| summarize Total = countif(name in ("DeploymentCompleted","DeploymentFailed")),
            Failures = countif(name in ("DeploymentFailed","RollbackCompleted"))
| extend ChangeFailureRate = round(toreal(Failures) / Total * 100, 1)
```

---

### MTTR — incident open to resolution

```kusto
// Requires alert-fired and incident-resolved custom events (or Azure Monitor alert history)
customEvents
| where name in ("IncidentOpened", "IncidentResolved")
| extend IncidentId = tostring(customDimensions["incidentId"])
| summarize Opened = minif(timestamp, name == "IncidentOpened"),
            Resolved = minif(timestamp, name == "IncidentResolved") by IncidentId
| extend MttrHours = datetime_diff("hour", Resolved, Opened)
| where MttrHours > 0
| summarize P50Mttr = percentile(MttrHours, 50), P95Mttr = percentile(MttrHours, 95)
```

---

## MTTR SLO alert rule

```bicep
// alerts.bicep — alert if MTTR P50 exceeds 24 hours in the last 7 days
resource mttrAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'mttr-slo-breach'
  properties: {
    severity: 2
    evaluationFrequency: 'PT1H'
    windowSize: 'P7D'
    criteria: { /* KQL from above */ }
    actions: { actionGroups: [oncallGroupId] }
  }
}
```

---

## Baseline report template

When invoked, output `.claude/pilot/dora-baseline.md`:

```
# DORA Baseline — <date>
Stack: <Angular version> / .NET <version> / Azure <region>

| Metric | Current | Target tier | Gap |
|--------|---------|-------------|-----|
| Deployment frequency | ? deploys/week | High (1/week) | — |
| Lead time | ? hours P50 | High (<1 day) | — |
| Change failure rate | ?% | High (<10%) | — |
| MTTR | ? hours P50 | High (<1 day) | — |

## Top-3 improvement recommendations
1. ...
2. ...
3. ...
```
