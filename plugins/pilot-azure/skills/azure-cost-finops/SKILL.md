---
name: azure-cost-finops
description: Goes beyond the WAF-COST pillar checklist into concrete FinOps tooling — budgets with alert thresholds, autoscale right-sizing playbooks, and cost-anomaly detection. Flags no Azure Budget resource with action-group alerting, autoscale rules with no documented right-sizing review cadence, no cost-anomaly alerts configured, and orphaned/unused resources with no automated cleanup policy. Outputs findings with pilot-azure cost-finops standard IDs.
when_to_use: Azure Budget, cost alert, autoscale right-sizing, cost anomaly detection, FinOps, orphaned resources, unused resource cleanup, budget threshold, cost management, reserved instances, savings plan
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| FIN-001 | P1 | No Azure Budget resource with action-group alerting |
| FIN-002 | P2 | Autoscale rules with no documented right-sizing review cadence |
| FIN-003 | P2 | No cost-anomaly detection/alerts configured |
| FIN-004 | P2 | Orphaned/unused resources with no automated cleanup policy |

---

## Check A — No Budget resource with alerting (FIN-001)

### Detection

Grep Bicep for `Microsoft.Consumption/budgets`. This goes beyond `azure-waf-review`'s
WAF-COST pillar (which flags missing cost tags) by checking for an actual spend ceiling
with alert thresholds — without one, a runaway resource (an autoscale misconfiguration, a
forgotten test environment) accumulates cost with nobody notified until the monthly bill
arrives.

### BAD — no budget defined anywhere

```bicep
// No Microsoft.Consumption/budgets resource in any template — spend is unmonitored
// until someone happens to check the Cost Management blade.
```

### GOOD — budget with staged alert thresholds tied to the on-call action group

```bicep
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'budget-orders-prod-monthly'
  properties: {
    category: 'Cost'
    amount: 5000
    timeGrain: 'Monthly'
    notifications: {
      actual_80pct: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactGroups: [actionGroup.id] // same action group as azure-observability AOBS-003
      }
      forecasted_100pct: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Forecasted'
        contactGroups: [actionGroup.id]
      }
    }
  }
}
```

---

## Check B — Autoscale rules with no right-sizing review cadence (FIN-002)

### Detection

Check whether autoscale rules (`Microsoft.Insights/autoscaleSettings`, Container Apps
scale rules) have a documented review cadence — min/max replica counts and scale
thresholds set once at launch and never revisited drift out of sync with actual traffic
patterns over time, typically erring toward over-provisioned minimums "just to be safe."

### BAD — autoscale config with no review process

```bicep
resource autoscale 'Microsoft.Insights/autoscaleSettings@2022-10-01' = {
  properties: {
    profiles: [{ capacity: { minimum: '5', maximum: '20', default: '5' } }]
  }
  // Set once at launch based on a guess; no note on when/how this gets revisited.
}
```

### GOOD — right-sizing review documented and scheduled

```markdown
<!-- docs/COST-REVIEW.md -->
Autoscale min/max for ca-orders-prod is reviewed quarterly against the last 90 days of
CPU/request-rate metrics (Log Analytics query: `AppMetrics | where ...`). Last reviewed:
2026-04-01, min reduced from 5 to 2 replicas based on actual off-peak traffic.
```

---

## Check C — No cost-anomaly detection (FIN-003)

### Detection

Check for Cost Management's built-in anomaly detection (enabled per subscription, alerts
via `Microsoft.CostManagement` action group wiring) or an equivalent scheduled query
comparing day-over-day spend. Budget thresholds (Check A) catch *sustained* overspend;
anomaly detection catches a sudden spike (e.g., a misconfigured loop calling an expensive
API in a tight retry cycle) days before it would cross a monthly budget threshold.

### BAD — only a monthly budget threshold, no anomaly detection

```bicep
// Budget from Check A exists, but nothing flags a spend spike that occurs mid-month
// and would resolve itself (or compound) long before the 80% monthly threshold trips.
```

### GOOD — Cost Management anomaly alerts enabled and routed to the same action group

```bicep
resource anomalyAlert 'Microsoft.CostManagement/scheduledActions@2023-11-01' = {
  name: 'cost-anomaly-orders'
  properties: {
    notification: { to: ['oncall@example.com'] }
    schedule: { frequency: 'Daily' }
    viewId: costAnomalyView.id
  }
}
```

---

## Check D — Orphaned resources with no cleanup policy (FIN-004)

### Detection

Check for an automated policy (Azure Policy `auditIfNotExists`/`deny`, or a scheduled
script) that identifies and flags resources with no recent activity or no owner tag —
orphaned disks from deleted VMs, unattached public IPs, and forgotten dev/test
environments left running are a common, easily-preventable source of silent waste.

### BAD — no process for finding orphaned resources

```
# Nothing scans for unattached disks, unused public IPs, or stale dev/test resource groups.
```

### GOOD — a scheduled job (or Azure Policy) flags orphaned resources for review

```bicep
resource orphanedDiskPolicy 'Microsoft.Authorization/policyAssignments@2022-06-01' = {
  name: 'flag-unattached-disks'
  properties: {
    policyDefinitionId: subscriptionResourceId('Microsoft.Authorization/policyDefinitions', 'unattached-disks')
    parameters: { effect: { value: 'Audit' } }
  }
}
```

A Hangfire recurring job (`dotnet-background-jobs`) or scheduled runbook can also query
the Azure Resource Graph weekly for resources with no `owner`/`costCenter` tag (see
`azure-caf-naming`'s required tags) and notify the tag owner for cleanup or justification.
