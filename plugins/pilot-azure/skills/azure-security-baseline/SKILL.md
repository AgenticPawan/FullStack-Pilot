---
name: azure-security-baseline
description: Checks Azure Bicep resources against the Microsoft security baseline: blocks public blob storage, flags PaaS services without private endpoints, verifies managed identity authentication over connection-string keys, validates Key Vault secret references, checks RBAC least-privilege (no Owner/Contributor at subscription scope), and checks Azure Defender enablement. Outputs findings with Azure Security Benchmark control IDs and OWASP references.
when_to_use: Azure security, managed identity, Key Vault, private endpoint, public storage, RBAC, least privilege, Azure Defender, security baseline, network security, storage security, connection string, Bicep security, Azure Security Benchmark
---

## Standard IDs

| ID | Benchmark control | Severity |
|----|------------------|----------|
| ASB-NS-1 | Network Security NS-1: no public access to storage | P0 |
| ASB-NS-2 | Network Security NS-2: use private endpoints for PaaS | P1 |
| ASB-IM-1 | Identity Management IM-1: managed identity over keys | P0 |
| ASB-IM-2 | Identity Management IM-2: Key Vault for secrets, not inline | P0 |
| ASB-PA-1 | Privileged Access PA-1: no Owner/Contributor at subscription | P1 |
| ASB-LT-1 | Logging & Threat LT-1: Defender plan enabled | P2 |

---

## Check A — Public storage access (ASB-NS-1)

**P0: exploitable now — unauthenticated data read.**

```bicep
// BAD: allowBlobPublicAccess enables anonymous blob read
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  properties: {
    allowBlobPublicAccess: true   // ASB-NS-1: P0
  }
}

// BAD: container-level public access
resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  properties: {
    publicAccess: 'Blob'          // ASB-NS-1: P0
    // or publicAccess: 'Container'
  }
}

// GOOD
properties: {
  allowBlobPublicAccess: false
  publicNetworkAccess: 'Disabled'
}
```

**Detection rule:** scan `.bicep` files for `allowBlobPublicAccess: true` or
`publicAccess: 'Blob'` or `publicAccess: 'Container'`.

---

## Check B — Private endpoints for PaaS (ASB-NS-2)

Flag SQL Server, Storage, Key Vault, Service Bus, and Container Registry resources that
have `publicNetworkAccess: 'Enabled'` without a corresponding `privateEndpoints` resource.

```bicep
// BAD: SQL Server open to public network
resource sql 'Microsoft.Sql/servers@2023-02-01-preview' = {
  properties: {
    publicNetworkAccess: 'Enabled'   // ASB-NS-2: P1
  }
}

// GOOD: public access disabled, private endpoint defined elsewhere
properties: {
  publicNetworkAccess: 'Disabled'
}
```

---

## Check C — Managed identity over connection-string keys (ASB-IM-1)

**P0: key rotation failure = immediate credential exposure.**

Scan `.bicep` files for:
- `listKeys(` function calls assigned to outputs or stored as secrets
- `storageAccountKey` / `primaryKey` / `secondaryKey` references in connection-string outputs

```bicep
// BAD: exporting storage key to app settings
{
  name: 'StorageConnectionString'
  value: 'DefaultEndpointsProtocol=https;AccountName=${sa.name};AccountKey=${sa.listKeys().keys[0].value}'
}

// GOOD: use managed identity — no key needed
// App authenticates via DefaultAzureCredential; grant Storage Blob Data Reader role
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(sa.id, app.id, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  scope: sa
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: app.identity.principalId
  }
}
```

---

## Check D — Key Vault references for secrets (ASB-IM-2)

App Service / Container Apps should reference secrets via Key Vault references, not inline values.

```bicep
// BAD: secret value inline in app settings
{ name: 'ApiKey', value: 'super-secret-value' }

// GOOD: Key Vault reference
{ name: 'ApiKey', value: '@Microsoft.KeyVault(SecretUri=${kv.properties.vaultUri}secrets/ApiKey/)' }
```

---

## Check E — RBAC least privilege (ASB-PA-1)

Flag any `roleAssignment` where:
- `scope` resolves to a subscription or management group (not a resource group)
- `roleDefinitionId` maps to `Owner` (`8e3af657-...`) or `Contributor` (`b24988ac-...`)

```bicep
// BAD: Contributor at subscription scope
resource ra 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: subscription()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')
  }
}
```

---

## Check F — Azure Defender / Defender for Cloud (ASB-LT-1)

Check for the absence of Defender plan resources:

```bicep
// GOOD: Defender for Storage enabled
resource defenderStorage 'Microsoft.Security/pricings@2023-01-01' = {
  name: 'StorageAccounts'
  properties: { pricingTier: 'Standard' }
}
```

Absence of any `Microsoft.Security/pricings` resource → P2 finding.
