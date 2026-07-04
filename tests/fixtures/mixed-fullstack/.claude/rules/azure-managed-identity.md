---
id: azure-managed-identity
title: Managed Identity over Connection Strings; CAF Resource Naming
appliesTo: azure
severity: warn
standard: InternalPolicy,CAF
---
Authenticate to Azure services (Storage, Key Vault, Service Bus, SQL) via Managed Identity (`DefaultAzureCredential`). Never embed connection strings in application code or IaC. Resource names must follow CAF convention: `<type>-<workload>-<env>-<region>-<instance>` (e.g. `st-myapp-dev-eus-001`).

**BAD**
```bicep
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'mystoragedev' // non-CAF: no type prefix, no env/region segments
}
```
```csharp
// App: connection string hardcoded or stored in config without Key Vault
var conn = "DefaultEndpointsProtocol=https;AccountName=mystoragedev;AccountKey=abc123==";
```

**GOOD**
```bicep
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'st-myapp-dev-eus-001' // CAF: st-<workload>-<env>-<region>-<instance>
}
```
```csharp
// App: no connection string — authenticate via Managed Identity
var client = new BlobServiceClient(
    new Uri($"https://stmyappdeveus001.blob.core.windows.net"),
    new DefaultAzureCredential());
```
