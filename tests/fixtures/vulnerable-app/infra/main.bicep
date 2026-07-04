// Vulnerable infrastructure fixture for /pilot-audit acceptance gate
// VULN-009: Public blob storage + non-CAF naming

param location string = resourceGroup().location
param env string = 'dev'

// VULN-009: ASB-NS-1 P0 — allowBlobPublicAccess: true exposes blobs without auth
// CAF-NAME-001 P2 — 'mystoragedev' does not follow <type><workload><env><region><instance>
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'mystoragedev'
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    allowBlobPublicAccess: true
    publicNetworkAccess: 'Enabled'
    minimumTlsVersion: 'TLS1_0'
  }
  // WAF-COST-001: no tags
}

// No Microsoft.Security/pricings resource — WAF-LT-1 P2 (Defender not enabled)
