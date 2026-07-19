---
name: azure-bicep-patterns
description: "Reviews Bicep files for production-readiness: module decomposition vs monolithic templates, parameterization of environment-specific values, what-if step in GitHub Actions deployment workflow, required cost tags on all resources, secure parameter types for secrets, conditional deployment for environment tiers, and Azure Verified Modules (AVM) alignment. Outputs a scored checklist with Bicep best-practice IDs."
when_to_use: Bicep patterns, Bicep modules, Bicep parameterization, what-if deployment, Bicep secure parameter, Azure Verified Modules, AVM, Bicep best practices, Bicep review, deployment workflow, Bicep conditional, cost tags, Bicep production
---

## Checklist

Score each item pass / fail / n-a. Output a scored summary at the end.

| ID | Category | Check |
|----|----------|-------|
| BIC-001 | Structure | Template decomposed into modules (not one monolithic main.bicep > 200 lines) |
| BIC-002 | Parameterization | Environment-specific values (SKUs, counts, names) use parameters with `@allowed` |
| BIC-003 | Security | Secrets and keys use `@secure()` parameter type — never plain `string` |
| BIC-004 | Deployment | GitHub Actions workflow has a `what-if` step before `az deployment group create` |
| BIC-005 | Tagging | All resources have `env`, `costCenter`, `owner`, `managedBy` tags |
| BIC-006 | Conditional | Non-production environments skip expensive resources via `if (env == 'prod')` |
| BIC-007 | AVM | Resources with an Azure Verified Module equivalent use the AVM module |
| BIC-008 | Idempotency | Template uses `existing` keyword for pre-existing resources, not hard-coded IDs |

---

## BIC-001 — Module decomposition

A monolithic `main.bicep` > 200 lines that deploys compute, network, data, and security
resources in one file is hard to review and redeploy independently.

```bicep
// GOOD: main.bicep orchestrates modules
module network 'modules/network.bicep' = {
  name: 'network'
  params: { env: env, location: location }
}

module app 'modules/app.bicep' = {
  name: 'app'
  params: { env: env, location: location, vnetId: network.outputs.vnetId }
}
```

---

## BIC-002 — Parameterization

```bicep
// BAD: SKU hard-coded — must edit source for each environment
sku: { name: 'Standard_LRS' }

// GOOD: parameter with environment-appropriate defaults
@allowed(['Standard_LRS', 'Standard_GRS', 'Premium_LRS'])
param storageSku string = env == 'prod' ? 'Standard_GRS' : 'Standard_LRS'
```

---

## BIC-003 — Secure parameters

```bicep
// BAD: secret passed as plain string — shows in deployment logs
param sqlAdminPassword string

// GOOD: @secure() — value redacted from logs and portal history
@secure()
param sqlAdminPassword string
```

Any parameter name containing `password`, `secret`, `key`, `token`, or `connectionString`
that is not decorated with `@secure()` is a BIC-003 P1 finding.

---

## BIC-004 — What-if before deploy

```yaml
# .github/workflows/azure-deploy.yml

# GOOD: what-if surfaces changes before applying them
- name: Bicep what-if
  run: |
    az deployment group what-if \
      --resource-group ${{ vars.RG }} \
      --template-file infra/main.bicep \
      --parameters @infra/params.${{ vars.ENV }}.json

- name: Bicep deploy (requires approval for prod)
  run: |
    az deployment group create \
      --resource-group ${{ vars.RG }} \
      --template-file infra/main.bicep \
      --parameters @infra/params.${{ vars.ENV }}.json
```

Absence of a `what-if` step when there is a deployment step → BIC-004 P2.

---

## BIC-006 — Conditional deployment

```bicep
// Only deploy Application Insights with Defender in production
resource defender 'Microsoft.Security/pricings@2023-01-01' = if (env == 'prod') {
  name: 'StorageAccounts'
  properties: { pricingTier: 'Standard' }
}
```

---

## BIC-007 — Azure Verified Modules (AVM)

When an AVM module exists for a resource type, prefer it over a hand-rolled resource.
Common AVM modules:

| Resource | AVM module path |
|----------|----------------|
| Storage | `avm/res/storage/storage-account` |
| App Service | `avm/res/web/site` |
| Container App | `avm/res/app/container-app` |
| Key Vault | `avm/res/key-vault/vault` |
| SQL Database | `avm/res/sql/server` |

```bicep
module kv 'br/public:avm/res/key-vault/vault:0.9.0' = {
  name: 'kv'
  params: { name: kvName, location: location, enableRbacAuthorization: true }
}
```

Emit BIC-007 as P3 advisory — not a blocker, but reduces maintenance burden.

---

## Scored output format

```
## Bicep Pattern Review — infra/main.bicep

| ID | Check | Result |
|----|-------|--------|
| BIC-001 | Module decomposition | PASS |
| BIC-002 | Parameterization | FAIL — SKU hard-coded on line 23 |
| BIC-003 | Secure parameters | PASS |
| BIC-004 | What-if step | FAIL — no what-if in azure-deploy.yml |
| BIC-005 | Required tags | FAIL — storage account missing tags (line 8) |
| BIC-006 | Conditional by env | N/A — single-environment template |
| BIC-007 | AVM alignment | ADVISORY — Key Vault has AVM equivalent |
| BIC-008 | Idempotency | PASS |

Score: 3/7 checks pass (2 N/A). 2 failures require fixes before production deployment.
```
