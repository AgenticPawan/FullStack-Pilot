---
name: data-residency-compliance
description: Reviews data-residency/sovereignty — where regulated data may legally live and move — over sql-data-protection's at-rest controls and azure-dr-multiregion's replication. Flags regulated data deployed outside the required boundary, replication/failover copying it out of geography, backups/logs/telemetry in a non-compliant region, no residency requirement per data classification, and personal data to a third party with no residency guarantee. Outputs pilot-core data-residency-compliance standard IDs.
when_to_use: data residency, data sovereignty, GDPR region, data boundary, geo restriction, region pinning, cross-region replication compliance, EU data boundary, backup region residency, log data residency, personal data location, regulated data geography, in-country data storage, Schrems, sovereign cloud
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| DRC-001 | P1 | A resource holding regulated data deployed to a region outside the required residency boundary |
| DRC-002 | P1 | Cross-region replication/failover copies regulated data out of its allowed geography |
| DRC-003 | P2 | Backups, diagnostic logs, or telemetry shipped to a region/workspace outside the boundary |
| DRC-004 | P2 | No documented residency requirement mapped per data classification |
| DRC-005 | P2 | Personal data sent to a third-party/SaaS with no contractual residency guarantee |

`sql-data-protection` governs how regulated data is protected *at rest* (encryption,
masking); `azure-dr-multiregion` governs *availability* replication. Neither asks the prior
question this skill owns: **is this data legally allowed to live and move where the
architecture puts it?** A perfectly encrypted, highly-available copy in the wrong
geography is still a compliance breach.

---

## Check A — Resource deployed outside the residency boundary (DRC-001)

### Detection

For data-holding resources (SQL, Storage, Cosmos, Service Bus, backups), check the
deployment `location` against the documented residency requirement for the data class it
holds. An EU-personal-data workload with a resource pinned to a non-EU region violates
residency regardless of encryption.

### BAD — a hardcoded region contradicting the stated EU-only requirement

```bicep
// Requirement (docs/data-classification.md): customer PII must stay in EU regions.
resource sql 'Microsoft.Sql/servers@2023-08-01' = {
  location: 'eastus'   // US region for EU personal data — a residency breach
}
```

### GOOD — region constrained to the allowed set, enforced by policy

```bicep
@allowed([ 'westeurope', 'northeurope' ])   // only EU regions selectable
param location string
// Backed by an Azure Policy 'Allowed locations' assignment so a drift can't reintroduce a US region.
```

---

## Check B — Replication carries data out of geography (DRC-002)

### Detection

Cross-reference `azure-dr-multiregion`'s failover/replication design against the residency
boundary. A geo-redundant Storage account (`Standard_GRS`) or a SQL failover-group paired
region can silently copy regulated data to a region that violates residency. The secondary
must sit inside the allowed geography.

### BAD — geo-redundant storage pairing an EU primary to its default non-EU peer

```bicep
sku: { name: 'Standard_GRS' }   // westeurope pairs to a region outside the EU-only boundary
```

### GOOD — replication kept within the allowed geography

```bicep
sku: { name: 'Standard_ZRS' }   // zone-redundant within-region; or GZRS only if the paired region is in-boundary
// SQL failover group's secondary is explicitly an in-boundary EU region, not the default pairing.
```

---

## Check C — Backups / logs / telemetry leave the boundary (DRC-003)

### Detection

Residency applies to *copies* too. Check where backups, diagnostic logs, and telemetry
land: a Log Analytics workspace or Application Insights resource (`azure-observability`) in
a non-compliant region, or a backup vault outside the boundary, exports regulated data —
including PII that leaks into logs — out of geography.

### GOOD — the telemetry sink is in-boundary and PII is scrubbed before it ships

```bicep
resource laws 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  location: 'westeurope'   // logs stay in the EU boundary; app scrubs PII before logging (dotnet-logging)
}
```

---

## Check D — No documented residency requirement (DRC-004)

### Detection

Check for a data-classification document that states, per data class, which regions/geos
are permitted. Without it, "where is this allowed to live" has no answer to review against,
and every Check A/B/C decision is a guess. This is the source of truth the other checks cite.

### GOOD — an explicit classification-to-region mapping

```markdown
<!-- docs/data-classification.md -->
| Data class            | Residency requirement        | Allowed regions          |
|-----------------------|------------------------------|--------------------------|
| Customer PII (EU)     | EU Data Boundary             | westeurope, northeurope  |
| Operational telemetry | No cross-border restriction  | any                      |
```

---

## Check E — Personal data to a third party with no residency guarantee (DRC-005)

### Detection

Check outbound integrations that receive personal data (email/SMS providers per
`dotnet-notifications`/`dotnet-email-service`, analytics, a third-party API). Each must have
a contractual/technical residency guarantee (a region-pinned endpoint, a DPA) — otherwise
personal data crosses the boundary the moment it's sent, outside your infrastructure's control.

### GOOD — a region-pinned processor endpoint, documented

```markdown
<!-- docs/data-processors.md -->
Email: provider EU region endpoint (eu.api.provider.example), DPA on file, no US failover.
Analytics: region set to EU; IP anonymization on; no PII in event properties.
```
