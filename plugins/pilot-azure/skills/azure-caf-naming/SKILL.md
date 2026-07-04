---
name: azure-caf-naming
description: Enforces Azure Cloud Adoption Framework naming and tagging conventions: validates resource names match the CAF pattern <type>-<workload>-<env>-<region>-<instance> using the official abbreviation list, checks required tags (env, costCenter, owner, managedBy), detects missing or wrong type prefixes, and emits a regex pattern set consumable by the dangerous-patterns hook for live enforcement. Uses microsoft-learn MCP server when available for the current abbreviation reference.
when_to_use: CAF naming, Cloud Adoption Framework, resource naming, Azure naming convention, CAF abbreviation, resource tags, tagging policy, naming enforcement, Bicep naming, dangerous-patterns, naming regex
---

## CAF resource-name pattern

```
<type>-<workload>-<env>-<region>-<instance>
```

Examples:
| Resource | CAF abbreviation | Example name |
|----------|-----------------|--------------|
| Storage account | `st` | `stmyappdeveus001` (no hyphens — storage limits to 24 chars, alphanumeric) |
| App Service | `app` | `app-myapp-dev-eus-001` |
| Container App | `ca` | `ca-myapp-dev-eus-001` |
| Container App Environment | `cae` | `cae-myapp-dev-eus-001` |
| Key Vault | `kv` | `kv-myapp-dev-eus-001` |
| SQL Server | `sql` | `sql-myapp-dev-eus-001` |
| SQL Database | `sqldb` | `sqldb-myapp-dev-eus-001` |
| Log Analytics Workspace | `log` | `log-myapp-dev-eus-001` |
| Application Insights | `appi` | `appi-myapp-dev-eus-001` |
| Container Registry | `cr` | `crmyappdeveus001` (no hyphens — ACR has restrictions) |

If microsoft-learn MCP is available, call `microsoft_docs_search` with
"Azure Cloud Adoption Framework abbreviations" to retrieve the full current list before
running checks.

---

## Step 1 — Extract resource names

For each resource declaration in `.bicep` files, extract:
- `type` (e.g., `Microsoft.Storage/storageAccounts`)
- `name` value (may be a parameter reference — record as unknown if so)
- `tags` property

---

## Step 2 — Validate naming pattern

For each resource with a literal string name:

1. Look up the CAF abbreviation for the resource type.
2. Check that the name starts with the abbreviation followed by `-` (or is concatenated
   correctly for no-hyphen types like storage accounts and container registries).
3. Check that the name contains environment segment (`dev`, `test`, `staging`, `prod`, `uat`).
4. Check that the name ends with a numeric instance segment (`001`, `01`, etc.).

```bicep
// BAD: no CAF structure
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'mystoragedev'    // no type prefix, no region, no instance
}

// GOOD: storage uses concatenation (no hyphens allowed)
param workload string = 'myapp'
param env string = 'dev'
param region string = 'eus'
param instance string = '001'

resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'st${workload}${env}${region}${instance}'
}
```

---

## Step 3 — Validate required tags

Every resource must have at minimum:

| Tag | Values |
|-----|--------|
| `env` | `dev`, `test`, `staging`, `prod`, `uat` |
| `costCenter` | any non-empty string |
| `owner` | team or person identifier |
| `managedBy` | `bicep`, `terraform`, `manual` |

Flag missing tags as WAF-COST-001 (P2).

---

## Step 4 — Emit dangerous-pattern regex set

After the review, output the following JSON block **and** tell the user to add it to
`plugins/pilot-core/hooks/config/dangerous-patterns.json` so the hook enforces it live:

```json
[
  {
    "id": "no-public-blob-access",
    "name": "AZURE_PUBLIC_BLOB_ACCESS",
    "description": "Public blob access exposes storage data without authentication — ASB-NS-1 P0",
    "fileExtensions": [".bicep"],
    "pattern": "allowBlobPublicAccess\\s*:\\s*true",
    "message": "Set allowBlobPublicAccess: false. Use managed identity or SAS tokens for client access."
  },
  {
    "id": "no-public-container-access",
    "name": "AZURE_PUBLIC_CONTAINER_ACCESS",
    "description": "Container-level public access allows anonymous blob read — ASB-NS-1 P0",
    "fileExtensions": [".bicep"],
    "pattern": "publicAccess\\s*:\\s*'(?:Blob|Container)'",
    "message": "Set publicAccess: 'None'. Use RBAC or SAS tokens instead of anonymous access."
  },
  {
    "id": "no-storage-key-output",
    "name": "AZURE_STORAGE_KEY_IN_OUTPUT",
    "description": "Exporting storage account key in outputs leaks credentials — ASB-IM-1 P0",
    "fileExtensions": [".bicep"],
    "pattern": "\\.listKeys\\(\\)",
    "message": "Use managed identity instead of account keys. Remove listKeys() from outputs."
  }
]
```

---

## Finding output format

```json
{
  "source": "semantic",
  "severity": "P2",
  "cwe": null,
  "owasp": "A05:2021",
  "file": "infra/main.bicep",
  "line": 5,
  "title": "CAF-NAME-001: Storage account name 'mystoragedev' does not follow CAF convention",
  "evidence": "name: 'mystoragedev'",
  "proposedFix": "Rename to 'st<workload><env><region><instance>' e.g. 'stmyappdeveus001'",
  "batchable": true,
  "confidence": "high"
}
```
