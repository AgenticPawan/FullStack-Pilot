---
name: sql-data-protection
description: Reviews SQL Server-side protection for PII columns — the database counterpart to dotnet-data-protection's application-layer checks. Flags highly sensitive columns with no Always Encrypted configuration, no Dynamic Data Masking on columns visible to lower-privilege roles, Transparent Data Encryption not verified as enabled, and backups/restores that don't preserve the same encryption and masking guarantees as production. Outputs findings with pilot-sql data-protection standard IDs.
when_to_use: Always Encrypted, Dynamic Data Masking, TDE, Transparent Data Encryption, column encryption SQL Server, masked column, backup encryption, PII column SQL, data at rest encryption
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| SDP-001 | P0 | Highly sensitive column has no Always Encrypted configuration |
| SDP-002 | P1 | Column visible to lower-privilege roles has no Dynamic Data Masking |
| SDP-003 | P0 | Transparent Data Encryption not verified as enabled on the database |
| SDP-004 | P2 | Backup/restore process doesn't preserve production's encryption/masking guarantees |

---

## Check A — No Always Encrypted on highly sensitive columns (SDP-001)

### Detection

For columns holding government IDs, payment data, or health data (the same "highly
sensitive" tier `dotnet-data-protection` DP-001 flags for column-level encryption at the
EF Core layer), check whether the SQL Server column itself is configured for Always
Encrypted — protecting the value even from a DBA with `SELECT` access to the raw table,
which an application-layer `ValueConverter` alone does not.

### BAD — SSN column with no Always Encrypted configuration

```sql
CREATE TABLE Employees (
    Id UNIQUEIDENTIFIER PRIMARY KEY,
    Ssn NVARCHAR(11) NOT NULL -- readable in plaintext by anyone with SELECT on the table
);
```

### GOOD — Always Encrypted column

```sql
CREATE TABLE Employees (
    Id UNIQUEIDENTIFIER PRIMARY KEY,
    Ssn NVARCHAR(11) COLLATE Latin1_General_BIN2
        ENCRYPTED WITH (
            COLUMN_ENCRYPTION_KEY = CEK_Employee,
            ENCRYPTION_TYPE = Deterministic,
            ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256'
        ) NOT NULL
);
-- Even a DBA with SELECT access sees only ciphertext without the column master key.
```

---

## Check B — No Dynamic Data Masking for lower-privilege roles (SDP-002)

### Detection

For PII columns viewed by roles that don't need the raw value for their job function
(support staff viewing a customer record who only need the last 4 digits of a phone
number, not the full number), check for a `MASKED WITH` clause. Always Encrypted (Check A)
protects the *storage* layer; masking protects what a legitimately-connected but
lower-privileged query sees.

### BAD — support role sees the full phone number

```sql
CREATE TABLE Customers (
    Id UNIQUEIDENTIFIER PRIMARY KEY,
    Phone NVARCHAR(20) -- support agents querying this see the full number, not just enough to verify identity
);
```

### GOOD — masked column, unmasked only for roles granted UNMASK

```sql
CREATE TABLE Customers (
    Id UNIQUEIDENTIFIER PRIMARY KEY,
    Phone NVARCHAR(20) MASKED WITH (FUNCTION = 'partial(0,"XXX-XXX-",4)')
);

GRANT UNMASK TO [ComplianceAuditorRole]; -- only roles that genuinely need the full value get it
```

---

## Check C — TDE not verified as enabled (SDP-003)

### Detection

Query `sys.dm_database_encryption_keys` (or the Azure SQL equivalent `Microsoft.Sql/servers/databases` Bicep property `transparentDataEncryption`) to confirm Transparent Data
Encryption is enabled on every production database. TDE protects the physical data/log
files and backups at rest — its absence means a stolen backup file or disk is fully
readable.

### BAD — TDE not configured in the Bicep template

```bicep
resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01' = {
  name: 'sqldb-orders-prod-eus-001'
  // No transparentDataEncryption child resource — TDE state left to portal defaults.
}
```

### GOOD — TDE explicitly enabled

```bicep
resource tde 'Microsoft.Sql/servers/databases/transparentDataEncryption@2023-08-01' = {
  parent: sqlDb
  name: 'current'
  properties: { state: 'Enabled' }
}
```

---

## Check D — Backup/restore doesn't preserve encryption/masking guarantees (SDP-004)

### Detection

Confirm that restoring a production backup into a lower environment (staging, a
developer's local sandbox) doesn't silently strip Always Encrypted/masking protections —
e.g., a "refresh staging from prod" script that restores the raw `.bak` file without also
carrying over the column master key access policy, exposing PII in an environment with
weaker access controls than production.

### BAD — production backup restored into staging with no masking/encryption review

```powershell
# refresh-staging.ps1
Restore-SqlDatabase -Database "OrdersStaging" -BackupFile "prod-backup.bak"
# Staging now has copies of every Always-Encrypted/masked column's protections,
# but staging's access control is looser than prod's — no review of who can now reach it.
```

### GOOD — restore process re-applies stricter masking/access policy for the lower environment

```powershell
Restore-SqlDatabase -Database "OrdersStaging" -BackupFile "prod-backup.bak"
Invoke-Sqlcmd -Query "GRANT UNMASK TO [StagingDevRole]" -Database "OrdersStaging" # explicit, reviewed grant only for staging's own roles, not a copy of prod's grants
```
