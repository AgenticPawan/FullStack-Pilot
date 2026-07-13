---
name: azure-storage-dataplane
description: Reviews Azure Storage data-plane governance — the client-access side complementing dotnet-document-io's uploads and the secret-guard hook's public-access block. Flags client access via account-key/shared-key SAS instead of Entra user-delegation SAS or managed identity, SAS tokens minted with long or no expiry, storage reachable over the public network with no private endpoint, no lifecycle-management policy, and blob soft-delete plus versioning left disabled. Outputs pilot-azure standard IDs (STG-*).
when_to_use: Azure Blob Storage, storage data plane, user delegation SAS, account key SAS, shared key access, SAS expiry, blob private endpoint, lifecycle management policy, blob soft delete, blob versioning, storage tiering, immutability policy, DefaultAzureCredential blob, storage RBAC
---

## Purpose

`dotnet-document-io` governs how the **application** accepts and scans uploads; the secret-guard
hook and `azure-security-baseline` (ASB-NS-1) block *anonymous public* blob access. This skill
covers the gap between them: how authenticated clients are granted access to storage and how the
data at rest is protected and aged out. A private container is still exposed if the app hands out
account-key SAS URLs with a one-year expiry.

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| STG-001 | P1 | Client access via account-key/shared-key SAS instead of Entra user-delegation SAS or managed identity |
| STG-002 | P1 | SAS tokens minted with long or no expiry — no short-TTL policy |
| STG-003 | P2 | Storage reachable over the public network with no private endpoint (data-plane specific) |
| STG-004 | P2 | No lifecycle-management policy — blobs never tier down or expire |
| STG-005 | P2 | Blob soft-delete and versioning disabled — no recovery from accidental delete/overwrite |
| STG-006 | P3 | Retention/compliance context but no immutability (WORM) policy or legal hold |

---

## Check A — Account-key SAS instead of user-delegation SAS (STG-001)

### Detection

Grep app code for `new StorageSharedKeyCredential(`, `GetSharedAccessSignature(` on a client
built from a connection string/key, or `AccountKey=` reaching a SAS builder. Account-key SAS
cannot be revoked without rotating the account key (breaking everything), carries the full
account's authority, and ties every audit entry to the key, not a user.

### BAD — account-key SAS

```csharp
var cred = new StorageSharedKeyCredential(accountName, accountKey); // full-account key
var sas = new BlobSasBuilder { /* ... */ }.ToSasQueryParameters(cred).ToString();
```

### GOOD — Entra user-delegation SAS (no key, scoped, revocable)

```csharp
var service = new BlobServiceClient(new Uri($"https://{accountName}.blob.core.windows.net"),
    new DefaultAzureCredential()); // managed identity — no key
var key = await service.GetUserDelegationKeyAsync(DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(15));
var sas = new BlobSasBuilder { /* scoped to one blob + read only */ }
    .ToSasQueryParameters(key.Value, accountName).ToString();
```

Where the client can call storage directly, prefer managed identity + RBAC (`Storage Blob Data
Reader/Contributor`) and skip SAS entirely.

---

## Check B — SAS expiry (STG-002)

Flag any SAS whose expiry is unset, or set from a large constant (`AddDays(365)`, `AddYears`).
A download/upload SAS should live minutes, not months — a leaked long-lived SAS is a standing
data breach. Enforce a project-wide max (e.g. ≤ 60 min) and set `StartsOn` with a small clock-skew
allowance, not far in the past.

```csharp
// BAD
ExpiresOn = DateTimeOffset.UtcNow.AddYears(1)
// GOOD
ExpiresOn = DateTimeOffset.UtcNow.AddMinutes(15)
```

---

## Check C — No private endpoint on the data plane (STG-003)

Complements ASB-NS but is data-plane specific: even with `allowBlobPublicAccess: false`, the blob
endpoint resolves on the public internet unless a private endpoint + `publicNetworkAccess:
'Disabled'` (or a default-deny `networkAcls`) is in place. Flag production storage with no
`Microsoft.Network/privateEndpoints` targeting the `blob` sub-resource.

---

## Check D — Lifecycle management (STG-004)

```bicep
// GOOD — tier cool after 30d, delete after 365d; keeps hot storage small and cost bounded
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: { policy: { rules: [ {
    enabled: true, name: 'age-out', type: 'Lifecycle'
    definition: {
      filters: { blobTypes: [ 'blockBlob' ] }
      actions: { baseBlob: {
        tierToCool: { daysAfterModificationGreaterThan: 30 }
        delete: { daysAfterModificationGreaterThan: 365 }
      } }
    }
  } ] } }
}
```

Absent any policy on an account that stores documents/exports: STG-004.

---

## Check E — Soft-delete + versioning (STG-005)

```bicep
resource blobSvc 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }          // recover deleted blobs
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }  // recover deleted containers
    isVersioningEnabled: true                                   // recover overwritten blobs
  }
}
```

Both `deleteRetentionPolicy.enabled` false / absent and `isVersioningEnabled` false → STG-005.

---

## Check F — Immutability where retention is required (STG-006)

If the project CLAUDE.md or a container's purpose states a compliance/retention requirement
(audit exports, financial records, `dotnet-audit-trail` sinks), flag the absence of a
time-based immutability (WORM) policy or legal-hold configuration on that container.

---

## Read budget

≤ 8 files: the storage Bicep (blobServices, managementPolicies, private endpoint), the app's
`BlobServiceClient`/SAS construction, and any config binding the storage endpoint. Reference
`azure-security-baseline` for public-access/managed-identity and `dotnet-document-io` for the
upload/scan path rather than re-checking them here. Budgets bound exploration, not quality — if a
SAS helper is factored into a shared library, read it and say why.
