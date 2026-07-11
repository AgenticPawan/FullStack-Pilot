---
id: azure-public-network-access
title: No Enabled Public Network Access Without a Justification Comment
appliesTo: azure
severity: block
standard: InternalPolicy / ASB-NS-1
---
A Bicep resource must not set `publicNetworkAccess: 'Enabled'` (or omit it on a resource type that defaults to enabled) without a preceding comment naming why the resource must be internet-reachable and what compensating control (IP allow-list, WAF, Azure Front Door) is in front of it. Storage accounts, SQL servers, Key Vaults, and App Configuration stores should default to `'Disabled'` with private endpoints per `azure-security-baseline`.

**BAD**
```bicep
resource sql 'Microsoft.Sql/servers@2023-08-01-preview' = {
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}
```

**GOOD**
```bicep
resource sql 'Microsoft.Sql/servers@2023-08-01-preview' = {
  properties: {
    // Private endpoint only — see privateEndpoint.bicep in this module
    publicNetworkAccess: 'Disabled'
  }
}
```
