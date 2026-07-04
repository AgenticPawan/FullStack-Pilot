---
name: azure-dr-multiregion
description: Turns the WAF Reliability pillar's checklist items into concrete Bicep disaster-recovery patterns. Flags a production workload with no paired-region secondary deployment, no Traffic Manager/Front Door failover routing configured, no documented RPO/RTO targets, and a database with no cross-region replication or geo-redundant backup matching those targets. Outputs findings with pilot-azure dr-multiregion standard IDs.
when_to_use: disaster recovery, multi-region, paired regions, Traffic Manager failover, Front Door failover routing, RPO, RTO, geo-redundant backup, cross-region replication, failover testing, active-passive, active-active
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ADR-001 | P1 | Production workload has no paired-region secondary deployment |
| ADR-002 | P1 | No Traffic Manager/Front Door failover routing configured |
| ADR-003 | P2 | No documented RPO/RTO targets for the workload |
| ADR-004 | P1 | Database has no cross-region replication/geo-redundant backup matching the RPO/RTO |

---

## Check A — No paired-region secondary deployment (ADR-001)

### Detection

Check whether the Bicep templates deploy only a single region for a production workload
with no secondary-region module using an Azure paired region (e.g., East US paired with
West US). A single-region deployment means a regional Azure outage takes the whole
workload down with no failover target — this is `azure-waf-review`'s WAF-REL-004
("single-region deployment with no geo-redundancy note") made concrete with an actual
pattern to fix it.

### BAD — one region, no secondary

```bicep
// main.bicep — deploys only to East US
param location string = 'eastus'

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  location: location
  // No secondary-region module; an East US outage takes the whole app down.
}
```

### GOOD — primary + paired-region secondary via a shared module

```bicep
// main.bicep
module primary 'modules/region.bicep' = {
  name: 'primary'
  params: { location: 'eastus', isPrimary: true }
}

module secondary 'modules/region.bicep' = {
  name: 'secondary'
  params: { location: 'westus', isPrimary: false } // Azure paired region for East US
}
```

---

## Check B — No Traffic Manager/Front Door failover routing (ADR-002)

### Detection

With two regional deployments (Check A) in place, confirm a Traffic Manager profile
(`Microsoft.Network/trafficManagerProfiles`) or Front Door (`Microsoft.Cdn/profiles`) with
`Priority` routing is configured to actually fail over — two independent regional
deployments with no shared front door still requires a manual DNS change during an
outage.

### BAD — two regions deployed, but nothing routes between them

```bicep
module primary 'modules/region.bicep' = { params: { location: 'eastus' } }
module secondary 'modules/region.bicep' = { params: { location: 'westus' } }
// No Traffic Manager/Front Door — a failover today means someone manually repointing DNS.
```

### GOOD — Traffic Manager with priority routing automates the failover

```bicep
resource trafficManager 'Microsoft.Network/trafficManagerProfiles@2022-04-01' = {
  name: 'tm-orders-prod'
  properties: {
    trafficRoutingMethod: 'Priority'
    endpoints: [
      { name: 'primary', properties: { target: primary.outputs.appHostname, priority: 1 } }
      { name: 'secondary', properties: { target: secondary.outputs.appHostname, priority: 2 } }
    ]
    monitorConfig: { protocol: 'HTTPS', port: 443, path: '/health/live' } // ties to dotnet-observability OBS-001
  }
}
```

---

## Check C — No documented RPO/RTO targets (ADR-003)

### Detection

Check for a documented Recovery Point Objective (how much data loss is acceptable) and
Recovery Time Objective (how long until the workload is back up) for the workload —
without stated targets, every downstream decision (geo-redundant backup frequency,
active-active vs. active-passive, failover automation) has no measurable bar to meet.

### BAD — DR patterns exist with no stated target driving their configuration

```markdown
<!-- No RPO/RTO documented anywhere — geo-replication frequency was picked arbitrarily -->
```

### GOOD — explicit targets driving the configuration choices in Checks A/B/D

```markdown
<!-- docs/DR-PLAN.md -->
Orders service: RPO 5 minutes, RTO 15 minutes.
- SQL geo-replication: continuous (async), meets 5-minute RPO.
- Traffic Manager failover: 30-second health-check interval, 3 consecutive failures
  before failover — well within the 15-minute RTO budget.
```

---

## Check D — Database has no cross-region replication matching RPO/RTO (ADR-004)

### Detection

Check the SQL Database Bicep resource for `Microsoft.Sql/servers/databases/geoReplicas`
(Active Geo-Replication) or an Auto-Failover Group, and confirm its replication lag/failover
time is actually consistent with the RPO/RTO documented in Check C. A geo-redundant
*backup* alone (point-in-time restore from another region) has a much longer RTO than an
active geo-replica and may not meet an aggressive target.

### BAD — only standard geo-redundant backup, RTO target requires much faster recovery

```bicep
resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01' = {
  properties: {
    requestedBackupStorageRedundancy: 'Geo' // backup-only — restoring from it can take hours, not minutes
  }
}
```

### GOOD — auto-failover group meeting a 15-minute RTO target

```bicep
resource failoverGroup 'Microsoft.Sql/servers/failoverGroups@2023-08-01' = {
  name: 'fog-orders-prod'
  properties: {
    partnerServers: [{ id: secondaryServer.id }]
    readWriteEndpoint: { failoverPolicy: 'Automatic', failoverWithDataLossGracePeriodMinutes: 60 }
    databases: [sqlDb.id]
  }
}
```
