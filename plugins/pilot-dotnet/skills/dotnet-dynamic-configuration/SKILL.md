---
name: dotnet-dynamic-configuration
description: Reviews where ASP.NET Core configuration values live. Flags business-tunable settings hardcoded in appsettings.json instead of a DB-backed configuration source, secrets stored in the DB config table instead of Key Vault, undocumented precedence between bootstrap appsettings.json and DB-backed values, DB config read on every request with no caching/invalidation, and no admin surface to edit DB config. Outputs findings with pilot-dotnet dynamic-configuration standard IDs.
when_to_use: IConfigurationSource, DB-backed configuration, dynamic configuration, feature flag, appsettings.json, Key Vault secret, App Insights instrumentation key, configuration precedence, configuration caching, IOptionsMonitor, runtime configuration change, admin settings
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| CFG-001 | P1 | Business-tunable setting hardcoded in `appsettings.json` instead of DB-backed |
| CFG-002 | P0 | Secret stored in the DB config table instead of Key Vault |
| CFG-003 | P2 | No documented/enforced precedence between bootstrap config and DB-backed config |
| CFG-004 | P2 | DB-backed config read per-request with no caching/invalidation |
| CFG-005 | P3 | No admin surface to edit DB config values (advisory) |

---

## Check A — Business-tunable setting hardcoded in appsettings.json (CFG-001)

### Detection

1. Grep `appsettings*.json` for values that are business/ops-tunable (feature flags, retry thresholds, email-template subjects, job cron/enabled flags — see `dotnet-background-jobs` BGJ-002) rather than deployment-topology values (connection strings, service URLs).
2. If changing one of these values requires a redeploy instead of an admin-panel edit or DB update, flag it.
3. Deployment-topology values (DB connection string, Key Vault URI, App Insights instrumentation key) are explicitly **not** a finding here — see Check B for why those must stay out of the DB.

### BAD — feature flags and thresholds baked into appsettings.json

```json
{
  "Features": { "NewCheckoutFlow": false },
  "Orders": { "MaxRetryAttempts": 3, "LowStockThreshold": 10 }
}
```

### GOOD — a DB-backed configuration source layered over appsettings.json

```csharp
public class DatabaseConfigurationSource : IConfigurationSource
{
    public IConfigurationProvider Build(IConfigurationBuilder builder) => new DatabaseConfigurationProvider();
}

public class DatabaseConfigurationProvider : ConfigurationProvider
{
    public override void Load()
    {
        using var scope = ServiceProviderAccessor.Root.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Data = db.AppSettings.ToDictionary(s => s.Key, s => s.Value); // "Features:NewCheckoutFlow" -> "true"
    }
}

// Program.cs
builder.Configuration.AddDatabaseConfiguration(); // added AFTER appsettings.json so DB values win — see Check C
```

---

## Check B — Secret stored in DB config table (CFG-002)

### Detection

1. Grep the DB-backed settings table's seeded/inserted values (and any admin endpoint that writes to it) for connection strings, API keys, JWT signing keys, or third-party credentials.
2. Secrets must come from Key Vault (or another dedicated secret store) — the DB config table is for non-secret, business-tunable values only. A secret sitting in an ordinary settings table is readable by anyone with DB read access or a SQL-injection foothold, with no audit trail or rotation support.

### BAD — API key stored alongside feature flags in the settings table

```csharp
await _db.AppSettings.AddAsync(new AppSetting { Key = "Payments:StripeApiKey", Value = "sk_live_..." });
```

### GOOD — secret stays in Key Vault, only its *reference* (if anything) touches app config

```csharp
builder.Configuration.AddAzureKeyVault(keyVaultUri, new DefaultAzureCredential());
// "Payments:StripeApiKey" resolves from Key Vault, never from the AppSettings DB table.
```

---

## Check C — No documented precedence between bootstrap and DB config (CFG-003)

### Detection

Check whether `Program.cs` clearly establishes and documents (comment or naming) that `appsettings.json`/environment variables/Key Vault are for *bootstrap-only* values (the connection string that reaches the DB in the first place, the Key Vault URI, the App Insights key) and are loaded before the DB-backed provider, with DB values taking precedence for everything else. Flag ambiguous ordering where it's unclear which source wins for a given key.

### BAD — DB config source added with no stated precedence

```csharp
builder.Configuration.AddDatabaseConfiguration();
builder.Configuration.AddJsonFile("appsettings.json"); // added after — silently overrides DB values, defeats the purpose
```

### GOOD — explicit precedence, bootstrap-only keys called out

```csharp
// 1. appsettings.json / env vars: BOOTSTRAP ONLY — DB connection string, Key Vault URI, AI instrumentation key
builder.Configuration.AddJsonFile("appsettings.json").AddEnvironmentVariables();

// 2. Key Vault: secrets (never stored in the DB config table — see Check B)
builder.Configuration.AddAzureKeyVault(keyVaultUri, new DefaultAzureCredential());

// 3. DB-backed config: everything else, added LAST so it overrides bootstrap defaults
builder.Configuration.AddDatabaseConfiguration();
```

---

## Check D — DB config read per-request with no caching (CFG-004)

### Detection

Check whether `IConfiguration`/`IOptionsMonitor<T>` backed by the DB provider re-queries the database on every access, or whether the provider caches loaded values in memory with a change-token/polling refresh (`ConfigurationProvider.OnReload()` on a timer, or a cache invalidated by the admin-edit endpoint).

### BAD — every config read hits the database

```csharp
public string GetFeatureFlag(string key) =>
    _db.AppSettings.Single(s => s.Key == key).Value; // one query per call, every request
```

### GOOD — cached with a refresh trigger

```csharp
public class DatabaseConfigurationProvider : ConfigurationProvider
{
    public override void Load() => ReloadFromDatabase(); // called once at startup...

    public void TriggerReload() // ...and again whenever the admin endpoint saves a change
    {
        ReloadFromDatabase();
        OnReload();
    }
}
```

---

## Check E — No admin surface to edit DB config (CFG-005, advisory)

### Detection

Confirm there is an authorized admin endpoint/UI (permission-gated, per `dotnet-authorization`) to add/update/remove DB-backed settings, rather than requiring a direct database edit for every change — otherwise the "no redeploy needed" benefit from Check A is only half-realized.
