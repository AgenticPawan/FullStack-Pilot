# pilot-azure

Azure / Bicep governance: naming, security baseline, Well-Architected Framework review,
and Bicep production-readiness.

## Agent

- **infra-reviewer** — reviews Bicep templates and GitHub Actions deployment workflows
  against all four skills below, emitting findings with standard IDs (`ASB-*`, `WAF-*`,
  `CAF-*`, `BIC-*`).

## Skills

| Skill | Covers |
|---|---|
| `azure-caf-naming` | Enforces `<type>-<workload>-<env>-<region>-<instance>` naming against the official CAF abbreviation list, required tags (`env`, `costCenter`, `owner`, `managedBy`). Uses the Microsoft Learn MCP server for the current abbreviation reference when available. |
| `azure-security-baseline` | Blocks public blob storage, flags PaaS without private endpoints, verifies managed identity over connection strings, Key Vault secret references, RBAC least-privilege, Defender enablement. |
| `azure-waf-review` | Five-pillar Well-Architected Framework checklist (Reliability, Security, Cost, Operational Excellence, Performance Efficiency) against Bicep + workflows. |
| `azure-bicep-patterns` | Module decomposition, parameterization, `what-if` step in CI, cost tags, secure parameter types, conditional deployment, Azure Verified Modules alignment. |
