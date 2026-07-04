---
name: azure-observability
description: Reviews Azure observability design beyond the WAF-OPS pillar checklist. Flags missing centralized Log Analytics workspace design (per-resource-group workspaces instead of one shared workspace with RBAC), Application Insights sampling left at defaults for high-volume APIs, no alert rules/action groups defined for critical resources, and diagnostic settings not routed to the central workspace. Outputs findings with pilot-azure observability standard IDs.
when_to_use: Log Analytics workspace, Application Insights sampling, alert rule, action group, diagnostic settings, Azure Monitor, KQL query pack, workspace design, ingestion cost, sampling percentage
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| AOBS-001 | P1 | No centralized Log Analytics workspace — diagnostics scattered per-resource-group with no shared query surface |
| AOBS-002 | P2 | Application Insights sampling left at 100% for a high-volume API, inflating ingestion cost |
| AOBS-003 | P1 | No alert rules/action groups defined for critical resources (App Service, SQL, Container Apps) |
| AOBS-004 | P2 | Diagnostic settings not configured to route resource logs to the central workspace |

---

## Check A — No centralized Log Analytics workspace (AOBS-001)

### Detection

1. Grep Bicep templates for `Microsoft.OperationalInsights/workspaces` resources —
   flag if every resource group provisions its own workspace instead of resources across
   environments pointing at one shared (or one-per-environment) workspace with RBAC-scoped
   query access.
2. A fragmented-workspace setup means an incident spanning two resource groups requires
   cross-workspace KQL queries (`workspace("other-ws").Table`) instead of one query surface.

### BAD — a new workspace provisioned per resource group

```bicep
// resource-group-orders/main.bicep
resource ordersWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-orders-prod-eus-001'
}
// resource-group-invoicing/main.bicep provisions its own separate workspace — no shared query surface
```

### GOOD — one shared workspace per environment, referenced by every resource group

```bicep
// shared/observability.bicep — deployed once per environment
resource sharedWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-platform-prod-eus-001'
}

// resource-group-orders/main.bicep references the shared workspace by resourceId
param sharedWorkspaceId string
resource diag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  properties: { workspaceId: sharedWorkspaceId }
}
```

---

## Check B — Application Insights sampling left at defaults (AOBS-002)

### Detection

For a high-volume production API, check `ApplicationInsights:SamplingSettings` /
`Microsoft.ApplicationInsights.AspNetCore` config for adaptive sampling left unconfigured
(defaults to 100% below a threshold, then adapts) versus a deliberately tuned sampling
percentage. Untuned sampling on a high-traffic API can silently balloon ingestion cost.

### BAD — no sampling configuration, cost scales linearly with traffic

```json
{
  "ApplicationInsights": { "ConnectionString": "..." }
  // No SamplingSettings — adaptive sampling defaults may not suit a spiky, high-volume API.
}
```

### GOOD — explicit adaptive sampling target

```csharp
builder.Services.AddApplicationInsightsTelemetry(options =>
{
    options.EnableAdaptiveSampling = true;
});
builder.Services.Configure<TelemetryConfiguration>(config =>
{
    // target ~5 requests/sec sampled regardless of total traffic volume
});
```

---

## Check C — No alert rules/action groups on critical resources (AOBS-003)

### Detection

Grep Bicep for `Microsoft.Insights/metricAlerts`/`Microsoft.Insights/scheduledQueryRules`
and `Microsoft.Insights/actionGroups` tied to production App Service, SQL Database, and
Container Apps resources. Flag critical resources with no alert coverage at all — an
outage or resource-exhaustion event goes unnoticed until a user reports it.

### BAD — no alerting on a production SQL database

```bicep
resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01' = {
  name: 'sqldb-orders-prod-eus-001'
  // No metricAlerts for DTU/vCore utilization, no actionGroup wired up.
}
```

### GOOD — alert rule + action group on the critical resource

```bicep
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-platform-oncall'
  properties: { groupShortName: 'oncall', enabled: true, emailReceivers: [...] }
}

resource dtuAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-sqldb-orders-dtu-high'
  properties: {
    severity: 2
    scopes: [sqlDb.id]
    criteria: { /* DTU percentage > 80% for 5 minutes */ }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}
```

---

## Check D — Diagnostic settings not routed to the central workspace (AOBS-004)

### Detection

For each provisioned resource, check whether a `diagnosticSettings` sub-resource routes
its logs/metrics to the shared workspace from Check A. A resource with no diagnostic
settings at all produces no queryable logs when something goes wrong with it.

### BAD — resource provisioned with no diagnostic settings

```bicep
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'ca-orders-prod-eus-001'
  // No Microsoft.Insights/diagnosticSettings child resource — logs go nowhere queryable.
}
```

### GOOD — diagnostic settings routing to the shared workspace

```bicep
resource diag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: containerApp
  name: 'diag-orders'
  properties: {
    workspaceId: sharedWorkspaceId
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}
```
