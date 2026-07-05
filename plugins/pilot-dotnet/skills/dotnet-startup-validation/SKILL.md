---
name: dotnet-startup-validation
description: Reviews fail-fast configuration validation at ASP.NET Core startup, so misconfiguration surfaces at boot instead of at first request or silently. Flags options classes bound with no IValidateOptions<T>/data-annotation validation, missing .ValidateOnStart() calls that defer errors until first resolution, required external dependencies with no startup-time reachability check, environment-specific configuration with no schema-parity check, secrets logged in plaintext during startup diagnostics, and no documented smoke test verifying the app came up healthy before traffic is routed. Outputs findings with pilot-dotnet startup-validation standard IDs.
when_to_use: options validation, IValidateOptions, ValidateOnStart, ValidateDataAnnotations, fail fast startup, configuration validation, appsettings schema parity, startup health check, smoke test on boot, connection string validation, secrets in logs, boot diagnostics
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| SV-001 | P1 | Options class bound via `Configure<T>()` with no `IValidateOptions<T>` / data-annotation validation |
| SV-002 | P1 | No `.ValidateOnStart()` call, deferring validation errors until the option is first resolved |
| SV-003 | P1 | Required external dependency (connection string, API key, feature toggle) with no startup-time reachability/shape check |
| SV-004 | P2 | Environment-specific configuration with no schema-parity check between environments |
| SV-005 | P0 | Secrets or connection strings logged in plaintext during startup diagnostics |
| SV-006 | P2 | No documented smoke test verifying the app came up healthy before traffic is routed to it |

---

## Check A — Options bound with no validation (SV-001)

### Detection

1. Grep `Program.cs` / module extension methods for `services.Configure<T>(...)` calls.
2. For each bound options type, check whether `T` carries data-annotation attributes
   (`[Required]`, `[Range]`, `[Url]`) or a companion `IValidateOptions<T>` implementation is
   registered. If neither exists, flag SV-001 — a missing or malformed setting (e.g., an
   empty connection string, a zero timeout) only surfaces when the code path that reads that
   option finally executes, potentially in production under load.

### BAD — options bound with zero validation

```csharp
public class PaymentGatewayOptions
{
    public string ApiKey { get; set; } = default!;
    public string BaseUrl { get; set; } = default!;
    public int TimeoutSeconds { get; set; }
}

builder.Services.Configure<PaymentGatewayOptions>(
    builder.Configuration.GetSection("PaymentGateway"));
// A blank ApiKey or TimeoutSeconds = 0 is accepted silently and only fails on first real call.
```

### GOOD — data annotations plus IValidateOptions catch bad config immediately

```csharp
public class PaymentGatewayOptions
{
    [Required, MinLength(20)]
    public string ApiKey { get; set; } = default!;

    [Required, Url]
    public string BaseUrl { get; set; } = default!;

    [Range(1, 60)]
    public int TimeoutSeconds { get; set; }
}

public class PaymentGatewayOptionsValidator : IValidateOptions<PaymentGatewayOptions>
{
    public ValidateOptionsResult Validate(string? name, PaymentGatewayOptions options)
    {
        if (options.TimeoutSeconds > 30 && options.BaseUrl.Contains("sandbox"))
            return ValidateOptionsResult.Fail("Sandbox gateway timeout must not exceed 30s.");
        return ValidateOptionsResult.Success;
    }
}

builder.Services
    .AddOptions<PaymentGatewayOptions>()
    .Bind(builder.Configuration.GetSection("PaymentGateway"))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services.AddSingleton<IValidateOptions<PaymentGatewayOptions>, PaymentGatewayOptionsValidator>();
```

---

## Check B — No `.ValidateOnStart()` (SV-002)

### Detection

1. Grep every `AddOptions<T>()...Validate*()` chain for the presence of `.ValidateOnStart()`.
2. Without it, `IOptions<T>`/`IOptionsSnapshot<T>` validation only runs the first time
   something injects and resolves that options type — which can be minutes or hours after
   boot, on the very first request that needs it, in production. Flag SV-002 whenever a
   validated options chain is missing this call.

### BAD — validation configured but never runs until first use

```csharp
builder.Services
    .AddOptions<SmtpOptions>()
    .Bind(builder.Configuration.GetSection("Smtp"))
    .ValidateDataAnnotations();
    // No .ValidateOnStart() — a broken Smtp:Host setting isn't caught until the
    // first outgoing email attempt, possibly days after deployment.
```

### GOOD — validation runs eagerly at boot

```csharp
builder.Services
    .AddOptions<SmtpOptions>()
    .Bind(builder.Configuration.GetSection("Smtp"))
    .ValidateDataAnnotations()
    .ValidateOnStart(); // app.Run() throws immediately if SmtpOptions is invalid
```

---

## Check C — No startup-time reachability check for required dependencies (SV-003)

### Detection

1. Check whether required external dependencies — the primary database connection string,
   a required third-party API key, a message broker connection, a required feature toggle
   that gates a whole subsystem — are probed once at startup (a lightweight connectivity
   check, not a full health-check subsystem) before the app starts accepting traffic.
2. If the only place these are exercised is the first real request that needs them, flag
   SV-003 — a bad connection string or unreachable dependency then presents as a confusing
   500 to the first user instead of a clear boot-time failure.

### BAD — connection string only exercised on first real query

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("Default")));

var app = builder.Build();
app.Run();
// A typo'd connection string is only discovered when the first request hits the database.
```

### GOOD — connectivity verified once at startup, before Run()

```csharp
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("Default")));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (!await db.Database.CanConnectAsync())
    {
        throw new InvalidOperationException(
            "Cannot reach the configured database at startup. Check ConnectionStrings:Default.");
    }
}

app.Run();
```

---

## Check D — No schema-parity check across environment configuration (SV-004)

### Detection

1. Compare the key set present in `appsettings.Development.json` against
   `appsettings.Production.json` (and any other environment file). Check whether CI runs any
   automated diff or a startup assertion that every key expected by bound options classes
   exists in every environment's configuration source (including Key Vault / App
   Configuration for prod).
2. If a setting exists in one environment's file but is silently absent from another with
   nothing catching the gap before deploy, flag SV-004 — the option may fall back to a
   default that is wrong for that environment, or fail validation only in that environment.

### BAD — a required section exists in dev but was never added to production

```json
// appsettings.Development.json
{ "FeatureFlags": { "NewCheckoutFlow": true }, "PaymentGateway": { "BaseUrl": "https://sandbox..." } }
```

```json
// appsettings.Production.json
{ "PaymentGateway": { "BaseUrl": "https://api..." } }
// FeatureFlags section is missing entirely — nothing flags this before deploy.
```

### GOOD — CI step diffs configuration schemas across environments

```csharp
// tests/ConfigParityTests.cs — run in CI against every appsettings.*.json
[Fact]
public void AllEnvironmentConfigsExposeTheSameKeySchema()
{
    var devKeys = FlattenKeys("appsettings.Development.json");
    var prodKeys = FlattenKeys("appsettings.Production.json");

    var missingInProd = devKeys.Except(prodKeys);
    Assert.Empty(missingInProd); // fails the build instead of failing at deploy or first request
}
```

---

## Check E — Secrets logged in plaintext during startup diagnostics (SV-005)

### Detection

1. Grep startup diagnostic logging (`Console.WriteLine`, `logger.LogInformation` calls in
   `Program.cs` or a startup diagnostics module) for interpolated configuration values that
   include connection strings, API keys, or client secrets — often added temporarily to
   "see what got loaded" and never removed.
2. Flag SV-005 for any log statement whose format string or arguments include a secret-shaped
   configuration value, regardless of log level.

### BAD — connection string and API key logged at boot for debugging

```csharp
var connString = builder.Configuration.GetConnectionString("Default");
var apiKey = builder.Configuration["PaymentGateway:ApiKey"];
Console.WriteLine($"Starting up with connection string: {connString}"); // plaintext secret in logs
logger.LogInformation("Payment gateway key loaded: {ApiKey}", apiKey);   // ships to log aggregator
```

### GOOD — startup diagnostics confirm presence without revealing the value

```csharp
var connString = builder.Configuration.GetConnectionString("Default");
var apiKey = builder.Configuration["PaymentGateway:ApiKey"];

logger.LogInformation("Database connection configured: {IsConfigured}", !string.IsNullOrEmpty(connString));
logger.LogInformation("Payment gateway API key configured: {IsConfigured}, length: {Length}",
    !string.IsNullOrEmpty(apiKey), apiKey?.Length ?? 0);
// Confirms configuration was loaded without ever writing the secret value to a log sink.
```

---

## Check F — No documented smoke test verifying boot health before traffic (SV-006)

### Detection

1. Check the deployment pipeline (`azure-pipelines.yml`, GitHub Actions workflow, or
   deployment runbook) for a step that hits a health endpoint (`/health`, `/healthz`) once
   after deploy and gates traffic cutover (App Service slot swap, AKS readiness gate, load
   balancer registration) on that check succeeding.
2. If deployment proceeds straight to routing production traffic with no post-deploy smoke
   check — relying only on the process having started, not on it being actually healthy —
   flag SV-006.

### BAD — deployment routes traffic the instant the process starts

```yaml
# deploy.yml
- task: AzureWebApp@1
  inputs:
    appName: contoso-api
    package: $(Build.ArtifactStagingDirectory)/**/*.zip
# No post-deploy check — traffic is served as soon as the process is listening,
# even if the DbContext failed to connect or a required option failed validation.
```

### GOOD — pipeline gates cutover on a post-deploy health check

```yaml
# deploy.yml
- task: AzureWebApp@1
  inputs:
    appName: contoso-api
    package: $(Build.ArtifactStagingDirectory)/**/*.zip
    slotName: staging

- task: PowerShell@2
  displayName: "Smoke test staging slot health before swap"
  inputs:
    targetType: inline
    script: |
      $response = Invoke-WebRequest -Uri "https://contoso-api-staging.azurewebsites.net/health" -UseBasicParsing
      if ($response.StatusCode -ne 200) { throw "Staging slot failed health check — aborting swap" }

- task: AzureAppServiceManage@0
  displayName: "Swap staging to production only after health check passes"
  inputs:
    action: "Swap Slots"
    sourceSlot: staging
```
