---
name: azure-waf-review
description: Applies the Azure Well-Architected Framework five-pillar checklist (Reliability, Security, Cost Optimization, Operational Excellence, Performance Efficiency) to Bicep files and GitHub Actions workflows detected in stack-profile.json. Outputs findings with WAF pillar IDs (WAF-REL, WAF-SEC, WAF-COST, WAF-OPS, WAF-PERF) and Microsoft Learn references. Uses the microsoft-learn MCP server when available for live documentation lookups.
when_to_use: Well-Architected Framework, WAF review, Azure reliability, Azure security pillar, cost optimization, operational excellence, performance efficiency, Bicep review, Azure architecture review, WAF assessment
---

## WAF pillar IDs

| Prefix | Pillar |
|--------|--------|
| WAF-REL | Reliability |
| WAF-SEC | Security |
| WAF-COST | Cost Optimization |
| WAF-OPS | Operational Excellence |
| WAF-PERF | Performance Efficiency |

---

## Step 0 — Load scope

Read `stack-profile.json`. Use `azure.bicepFiles` and `azure.githubActionsFiles` as the scan targets.

If microsoft-learn MCP is available, call `microsoft_docs_search` with "Azure Well-Architected Framework <pillar>" for each pillar before running checks, to capture the latest recommendations.

---

## Pillar A — Reliability (WAF-REL)

| Check | ID | Severity |
|-------|----|----------|
| No availability zones configured on compute/data resources | WAF-REL-001 | P2 |
| No health probes on load balancers / ACA ingress | WAF-REL-002 | P2 |
| No retry / circuit-breaker policy referenced in GitHub Actions deploy | WAF-REL-003 | P3 |
| Single-region deployment with no geo-redundancy note | WAF-REL-004 | P3 |

```bicep
// BAD: no zones
resource aca 'Microsoft.App/containerApps@2023-05-01' = {
  properties: { template: { scale: { minReplicas: 1 } } }
}

// GOOD: zone-redundant via managed environment
resource env 'Microsoft.App/managedEnvironments@2023-05-01' = {
  properties: { zoneRedundant: true }
}
```

---

## Pillar B — Security (WAF-SEC)

Delegate to `azure-security-baseline` skill for detailed checks. Here flag:

| Check | ID | Severity |
|-------|----|----------|
| No WAF policy on Application Gateway / Front Door | WAF-SEC-001 | P1 |
| TLS minimum version < 1.2 on any resource | WAF-SEC-002 | P1 |
| Diagnostic logs not enabled on key resources | WAF-SEC-003 | P2 |

```bicep
// BAD: no minimum TLS enforcement
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  properties: { }  // minimumTlsVersion omitted → defaults to TLS1_0
}

// GOOD
properties: {
  minimumTlsVersion: 'TLS1_2'
  supportsHttpsTrafficOnly: true
}
```

---

## Pillar C — Cost Optimization (WAF-COST)

| Check | ID | Severity |
|-------|----|----------|
| No `costCenter` / `env` tags on resources (prevents cost allocation) | WAF-COST-001 | P2 |
| SKU is Production tier in a dev/test environment | WAF-COST-002 | P2 |
| No autoscale configured on compute resources | WAF-COST-003 | P3 |

```bicep
// BAD: no tags
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'st-myapp-prod-eus-001'
  // tags: missing entirely
}

// GOOD
tags: {
  env: 'prod'
  costCenter: 'engineering'
  owner: 'platform-team'
  managedBy: 'bicep'
}
```

---

## Pillar D — Operational Excellence (WAF-OPS)

| Check | ID | Severity |
|-------|----|----------|
| No what-if step before deployment in GitHub Actions | WAF-OPS-001 | P2 |
| Hard-coded resource names (no parameters for workload/env) | WAF-OPS-002 | P2 |
| No deployment slot or blue-green pattern for zero-downtime | WAF-OPS-003 | P3 |

```yaml
# GOOD: what-if before deploy
- name: Bicep what-if
  run: az deployment group what-if --resource-group ${{ vars.RG }} --template-file infra/main.bicep

- name: Bicep deploy
  run: az deployment group create --resource-group ${{ vars.RG }} --template-file infra/main.bicep
```

---

## Pillar E — Performance Efficiency (WAF-PERF)

| Check | ID | Severity |
|-------|----|----------|
| No CDN / Front Door for static assets | WAF-PERF-001 | P3 |
| Database not using read replicas or connection pooling config | WAF-PERF-002 | P3 |
| Container min-replicas set to 0 (cold-start latency) | WAF-PERF-003 | P3 |

---

## Finding output format

```json
{
  "source": "semantic",
  "severity": "P2",
  "cwe": null,
  "owasp": "A05:2021",
  "file": "infra/main.bicep",
  "line": 14,
  "title": "WAF-COST-001: Missing cost allocation tags on storage account",
  "evidence": "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = { // no tags property }",
  "proposedFix": "Add tags: { env, costCenter, owner, managedBy } to resource declaration",
  "batchable": true,
  "confidence": "high"
}
```
