---
name: dotnet-secrets-rotation
description: Reviews secret and certificate rotation discipline — the lifecycle layer above dotnet-dynamic-configuration's storage-location rule (Key Vault, not the DB config table). Flags JWT signing keys with no rotation/grace-period overlap, database credentials never rotated on a schedule, certificates with no expiry monitoring/alerting, and rotation events that aren't logged for audit. Outputs findings with pilot-dotnet secrets-rotation standard IDs.
when_to_use: secret rotation, key rotation, JWT signing key rotation, certificate expiry, Key Vault rotation policy, credential rotation, grace period key overlap, cert monitoring, rotation audit log
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| SR-001 | P0 | JWT signing key has no rotation policy, or rotation has no grace-period overlap |
| SR-002 | P1 | Database credentials never rotated on a documented schedule |
| SR-003 | P0 | Certificate has no expiry monitoring/alerting |
| SR-004 | P2 | Rotation events not logged for audit |

`dotnet-dynamic-configuration` establishes *where* secrets live (Key Vault, not a DB table).
This skill governs what happens *over time* to a secret that's already stored correctly —
storage location alone doesn't prevent the standing-credential risk `dotnet-cicd-security`
(azure-cicd-security CICD-001) already flags for CI/CD identities; rotation is what closes it.

---

## Check A — JWT signing key with no rotation/grace period (SR-001)

### Detection

Check whether the JWT signing key is rotated on any schedule, and — critically — whether
rotation supports a grace period where *both* the old and new key validate incoming
tokens simultaneously. Rotating a signing key instantly invalidates every token issued
under the old key, forcing every logged-in user to re-authenticate at once; a grace
period lets already-issued tokens expire naturally while new tokens use the new key.

### BAD — single static signing key, never rotated

```csharp
builder.Services.AddAuthentication().AddJwtBearer(options =>
{
    options.TokenValidationParameters.IssuerSigningKey =
        new SymmetricSecurityKey(Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!));
    // Same key since the day this went to production — no rotation plan, no grace period.
});
```

### GOOD — key rotation with overlapping validation window

```csharp
builder.Services.AddAuthentication().AddJwtBearer(options =>
{
    // IssuerSigningKeys (plural) — both current and previous key validate during rollover
    options.TokenValidationParameters.IssuerSigningKeys = new[]
    {
        new SymmetricSecurityKey(Encoding.UTF8.GetBytes(keyVaultClient.GetSecret("jwt-signing-key-current").Value)),
        new SymmetricSecurityKey(Encoding.UTF8.GetBytes(keyVaultClient.GetSecret("jwt-signing-key-previous").Value)),
    };
});

// New tokens are always signed with "current"; "previous" stays valid only long enough
// for existing tokens to expire naturally (matches the token's own Expires claim), then
// is removed on the next rotation cycle.
```

---

## Check B — Database credentials never rotated (SR-002)

### Detection

Check for a documented rotation cadence for the SQL login/managed-identity credential the
application uses, versus a connection string created once at provisioning time and never
touched again. Long-lived database credentials are a standing target — if ever leaked
(a log line, a support ticket screenshot), they remain valid indefinitely with no
forcing function to invalidate them.

### BAD — connection string set up once, years ago, never rotated

```
<!-- No documented rotation cadence. The SQL login password hasn't changed since
     the database was provisioned 3 years ago. -->
```

### GOOD — managed identity (no password to rotate) or a documented rotation cadence

```bicep
// Prefer managed identity over a password entirely — see azure-security-baseline ASB-IM-1
resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01' = {
  properties: { /* connects via Azure AD-only authentication, no SQL login/password at all */ }
}
```

```markdown
<!-- For SQL-login-based connections where managed identity isn't available (legacy) -->
docs/SECRETS-ROTATION.md: SQL login passwords rotated quarterly via Key Vault secret
versioning + a scheduled Hangfire job (dotnet-background-jobs) that updates the app's
connection string reference with zero downtime (both old and new password valid for a
15-minute overlap window).
```

---

## Check C — Certificate with no expiry monitoring (SR-003)

### Detection

Check whether TLS/client-authentication certificates have an expiry-monitoring alert
(Key Vault's built-in near-expiry notification, or a custom check feeding into
`azure-observability`'s alert rules) configured. An expired certificate causing a hard
outage at 2am on a weekend, discovered only when customers can't connect, is one of the
most avoidable incident categories that exists — expiry dates are known in advance.

### BAD — no expiry monitoring, certificate just expires unnoticed

```
<!-- Key Vault holds the cert, but nothing watches its expiry date. -->
```

### GOOD — Key Vault near-expiry event routed to the same alerting pipeline as everything else

```bicep
resource certExpiryAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  properties: {
    criteria: { /* Key Vault "certificate near expiry" event, 30 days before expiration */ }
    actions: { actionGroups: [platformOncallActionGroup.id] } // same action group as azure-observability AOBS-003
  }
}
```

---

## Check D — Rotation events not logged (SR-004)

### Detection

Check whether a secret/certificate rotation event is itself logged (who/what triggered
it, old version identifier, new version identifier, timestamp) — without a rotation
audit trail, a compliance question ("when was this credential last rotated, and by
what process") has no answer, the same gap `dotnet-audit-trail` closes for data access
but applied to the secrets lifecycle instead.

### BAD — rotation happens silently, no record it occurred

```csharp
await keyVaultClient.SetSecretAsync("jwt-signing-key-current", newKey);
// No log entry anywhere recording that a rotation just happened.
```

### GOOD — rotation logged with before/after version identifiers

```csharp
var oldVersion = (await keyVaultClient.GetSecretAsync("jwt-signing-key-current")).Value.Properties.Version;
var newSecret = await keyVaultClient.SetSecretAsync("jwt-signing-key-current", newKey);
_logger.LogInformation(
    "Rotated secret {SecretName} from version {OldVersion} to {NewVersion}",
    "jwt-signing-key-current", oldVersion, newSecret.Value.Properties.Version);
```
