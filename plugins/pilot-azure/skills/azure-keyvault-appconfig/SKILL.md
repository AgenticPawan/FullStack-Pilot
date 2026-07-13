---
name: azure-keyvault-appconfig
description: Reviews Azure provisioning of the secret/config store that dotnet-secrets-rotation, dotnet-dynamic-configuration, and dotnet-feature-flags consume. Flags inline secrets instead of Key Vault references, App Configuration via connection string not managed identity, no Key Vault soft-delete/purge-protection, flags in App Settings not the flag store, and either resource open to public network. Outputs pilot-azure azure-keyvault-appconfig standard IDs.
when_to_use: Key Vault, App Configuration, Key Vault reference, keyVaultReference, managed identity secret access, secret in app settings, appsettings secret, feature flag store, App Configuration Bicep, purge protection, soft delete Key Vault, private endpoint Key Vault, secretUri, connection string config store, DefaultAzureCredential config
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| KVA-001 | P0 | Secret value defined inline (Bicep param/App Setting) instead of a Key Vault reference |
| KVA-002 | P0 | App Configuration / Key Vault accessed by connection string or access key, not managed identity |
| KVA-003 | P1 | Key Vault missing `enableSoftDelete` + `enablePurgeProtection` |
| KVA-004 | P1 | Feature flags stored in App Settings/env instead of the App Configuration flag store |
| KVA-005 | P1 | Key Vault / App Configuration `publicNetworkAccess` enabled with no private endpoint |

`dotnet-secrets-rotation`, `dotnet-dynamic-configuration`, and `dotnet-feature-flags` govern
how the *application* reads secrets, refreshes config, and evaluates flags — all of which
assume a backing store exists and is reachable by identity. This skill governs the Azure
resources that provide it: Key Vault and App Configuration, provisioned in Bicep, accessed by
managed identity (never a key), so the consumer-side skills have something safe to consume.
Complements `azure-security-baseline` ASB-IM-2 (Key Vault for secrets) with the concrete
Bicep wiring.

---

## Check A — No inline secrets; use Key Vault references (KVA-001)

### Detection

Scan Bicep and app-settings for secret-looking values assigned literally — a connection
string with a password, an API key, a client secret — where the value should be a Key Vault
reference resolved at runtime by identity. A secret in a Bicep param or an App Service
`appSettings` entry lands in deployment history and the portal in cleartext.

### BAD — client secret handed to the app as a literal setting

```bicep
resource site 'Microsoft.Web/sites@2023-12-01' = {
  properties: {
    siteConfig: {
      appSettings: [
        { name: 'Db__Password', value: dbPassword }   // KVA-001: literal secret in config
      ]
    }
  }
}
```

### GOOD — App Setting is a Key Vault reference, resolved by the site's managed identity

```bicep
appSettings: [
  {
    name: 'Db__Password'
    value: '@Microsoft.KeyVault(SecretUri=${kv.properties.vaultUri}secrets/db-password/)'
  }
]
// The app's system-assigned identity has 'Key Vault Secrets User' on the vault (Check B).
```

---

## Check B — Managed identity, not keys/connection strings (KVA-002)

### Detection

Check how the app authenticates to Key Vault and App Configuration. A connection string with
an access key (`Endpoint=...;Id=...;Secret=...`) is itself a secret — using it to fetch other
secrets defeats the purpose. The consumer uses `DefaultAzureCredential`
(`dotnet-dynamic-configuration`); Bicep must grant that identity RBAC on both resources.

### BAD — App Configuration reached via an access-key connection string

```bicep
{ name: 'AppConfig__ConnectionString', value: appConfig.listKeys().value[0].connectionString }
// KVA-002 (+ ASB-IM-1): a bootstrap secret in config, and listKeys() in a Bicep expression.
```

### GOOD — RBAC role assignment to the app's identity; app uses DefaultAzureCredential

```bicep
resource acReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: appConfig
  name: guid(appConfig.id, site.id, 'App Configuration Data Reader')
  properties: {
    principalId: site.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions',
      '516239f1-63e1-4d78-a4de-a74fb236a071')   // App Configuration Data Reader
    principalType: 'ServicePrincipal'
  }
}
// App code: builder.Configuration.AddAzureAppConfiguration(o =>
//   o.Connect(new Uri(endpoint), new DefaultAzureCredential()) ...)
```

---

## Check C — Soft-delete + purge protection on Key Vault (KVA-003)

### Detection

Confirm the vault sets `enableSoftDelete: true` and `enablePurgeProtection: true`. Without
purge protection a deleted (or maliciously purged) vault/secret is unrecoverable, and a
rotation mistake (`dotnet-secrets-rotation`) can permanently destroy the only copy of a key.

### BAD / GOOD

```bicep
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  properties: {
    enableRbacAuthorization: true
    enableSoftDelete: true          // BAD when false/absent — KVA-003
    enablePurgeProtection: true     // BAD when false/absent — KVA-003 (cannot be disabled later)
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
  }
}
```

---

## Check D — Feature flags in the App Configuration flag store (KVA-004)

### Detection

If the app uses feature flags (`dotnet-feature-flags` / `angular-feature-flags`), the flags
belong in App Configuration's feature-flag store, not in App Settings or `environment.ts`.
Flags in App Settings require a redeploy/restart to toggle and can't do percentage rollouts
or targeting; the App Configuration store gives runtime toggling and a single flag key both
tiers resolve (see the client/server flag-key agreement those skills enforce).

### BAD — flag as a plain App Setting (redeploy to flip)

```bicep
{ name: 'Features__NewCheckout', value: 'true' }   // KVA-004: static, needs restart to toggle
```

### GOOD — feature flag as an App Configuration key-value of the feature-flag content type

```bicep
resource flag 'Microsoft.AppConfiguration/configurationStores/keyValues@2023-03-01' = {
  parent: appConfig
  name: '.appconfig.featureflag~2FNewCheckout'
  properties: {
    contentType: 'application/vnd.microsoft.appconfig.ff+json;charset=utf-8'
    value: '{"id":"NewCheckout","enabled":false,"conditions":{"client_filters":[]}}'
  }
}
// Toggle at runtime with no redeploy; dotnet-feature-flags reads it via IFeatureManager.
```

---

## Check E — Lock down public network access (KVA-005)

### Detection

Check `publicNetworkAccess` on the vault and the App Configuration store. Both hold or gate
secrets; left open to the public internet they're reachable by anyone with a leaked
credential or misconfigured RBAC. Prefer `Disabled` with a private endpoint, or at minimum a
scoped IP/VNet firewall — consistent with `azure-security-baseline` ASB-NS-2.

### BAD / GOOD

```bicep
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  properties: {
    publicNetworkAccess: 'Disabled'   // BAD when 'Enabled' with no firewall — KVA-005
    networkAcls: { defaultAction: 'Deny', bypass: 'AzureServices' }
    // pair with a Microsoft.KeyVault/vaults + privateEndpoint (azure-bicep-patterns)
  }
}
```
