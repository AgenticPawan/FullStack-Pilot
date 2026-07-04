# pilot-azure

Azure / Bicep governance: naming, security baseline, Well-Architected Framework review,
and Bicep production-readiness.

## Agent

- **infra-reviewer** — reviews Bicep templates and GitHub Actions deployment workflows
  against all skills below, emitting findings with standard IDs (`ASB-*`, `WAF-*`,
  `CAF-*`, `BIC-*`, `AOBS-*`, `CICD-*`, `ADR-*`, `FIN-*`, `AKS-*`, `APIM-*`, `LZ-*`, `SLO-*`).

## Skills

| Skill | Covers |
|---|---|
| `azure-caf-naming` | Enforces `<type>-<workload>-<env>-<region>-<instance>` naming against the official CAF abbreviation list, required tags (`env`, `costCenter`, `owner`, `managedBy`). Uses the Microsoft Learn MCP server for the current abbreviation reference when available. |
| `azure-security-baseline` | Blocks public blob storage, flags PaaS without private endpoints, verifies managed identity over connection strings, Key Vault secret references, RBAC least-privilege, Defender enablement. |
| `azure-waf-review` | Five-pillar Well-Architected Framework checklist (Reliability, Security, Cost, Operational Excellence, Performance Efficiency) against Bicep + workflows. |
| `azure-bicep-patterns` | Module decomposition, parameterization, `what-if` step in CI, cost tags, secure parameter types, conditional deployment, Azure Verified Modules alignment. |
| `azure-observability` | Centralized Log Analytics workspace design, Application Insights sampling, alert rules/action groups, diagnostic settings routing. |
| `azure-cicd-security` | OIDC federated credentials vs long-lived service-principal secrets, environment approval gates, least-privilege deployment identity, no secrets hardcoded in workflow YAML. |
| `azure-dr-multiregion` | Paired-region secondary deployment, Traffic Manager/Front Door failover routing, documented RPO/RTO, cross-region database replication/auto-failover groups. |
| `azure-cost-finops` | Azure Budget resources with action-group alerting, autoscale right-sizing review cadence, cost-anomaly detection, orphaned-resource cleanup policy. |
| `azure-aks-governance` | Pod Security Standards, container resource requests/limits, `NetworkPolicy`, Azure Workload Identity — only applies when AKS is the compute target (Container Apps deployments are covered by the skills above instead). |
| `azure-api-management` | Gateway-layer rate-limit/quota policy, JWT validation consistency with the backend, backend pool health/circuit-breaker, thin pass-through policy discipline. |
| `azure-landing-zone` | Management-group hierarchy separating platform from landing-zone subscriptions, production/non-production subscription isolation, tenant-wide Azure Policy initiatives, documented subscription-vending process. |
| `azure-slo-error-budget` | Defined SLO/SLI per customer-facing service, an error-budget policy that gates release velocity once exhausted, user-experience-accurate SLIs, a live budget-consumption dashboard — the proactive counterpart to `incident-response-runbook`'s reactive severity SLAs. |
