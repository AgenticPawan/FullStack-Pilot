---
name: dotnet-logging
description: Reviews ASP.NET Core logging architecture as distinct from dotnet-observability's tracing/health-check focus. Flags no centralized logging abstraction/sink configuration (Console-only in production), no environment-gated log-level policy, log enrichers missing correlation ID/environment/version context, PII/secrets logged in message arguments, and high-volume endpoints with no sampling strategy driving up ingestion cost. Outputs findings with pilot-dotnet logging standard IDs.
when_to_use: Serilog, ILogger, structured logging, log level, LogInformation, LogWarning, enricher, log sink, Seq, ELK, Application Insights logs, log sampling, PII in logs, log redaction, logging policy
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| LOG-001 | P1 | No centralized sink configuration — logs go to `Console` only in production |
| LOG-002 | P1 | No environment-gated log-level policy (`Debug` noise in production, or errors silently dropped) |
| LOG-003 | P2 | Enrichers missing — logs carry no correlation ID/environment/version/machine context |
| LOG-004 | P0 | PII or secrets passed as log message arguments |
| LOG-005 | P2 | High-volume endpoint logs every request at `Information` with no sampling, inflating ingestion cost |

---

## Check A — No centralized sink configuration (LOG-001)

### Detection

Grep `Program.cs`/`appsettings.json` for logging configuration. If the only provider wired
is the default `Console`/`Debug` provider with no Serilog (or `Microsoft.Extensions.Logging`
equivalent) sink pointed at a durable, queryable store (Application Insights, Seq,
Elasticsearch), production logs vanish the moment the container recycles — nobody can
search "what happened at 3am" after the fact.

### BAD — default console-only logging in production

```csharp
var builder = WebApplication.CreateBuilder(args);
// no Serilog/sink configuration at all — logs only exist in the container's stdout buffer
var app = builder.Build();
```

### GOOD — Serilog with a durable sink, configured once

```csharp
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .WriteTo.ApplicationInsights(telemetryConfig, TelemetryConverter.Traces)
    .CreateLogger();

builder.Host.UseSerilog();
```

---

## Check B — No environment-gated log-level policy (LOG-002)

### Detection

Check `appsettings.json` vs `appsettings.Development.json` for a `Logging`/`Serilog.MinimumLevel`
section. Flag either extreme: `Debug`/`Verbose` left on in the production config (noise, cost,
potential PII exposure via framework-level debug logs), or `Warning`+ only with no `Information`
tier anywhere — meaning a support engineer investigating a reported incident has no request-level
trail to read, only errors that already paged someone.

### BAD — same verbose level shipped to production

```json
// appsettings.json (used in every environment, including production)
{ "Serilog": { "MinimumLevel": "Debug" } }
```

### GOOD — level tightened per environment, override per noisy namespace

```json
// appsettings.json
{ "Serilog": { "MinimumLevel": {
    "Default": "Information",
    "Override": { "Microsoft.EntityFrameworkCore": "Warning", "Microsoft.AspNetCore": "Warning" }
} } }
```

```json
// appsettings.Development.json
{ "Serilog": { "MinimumLevel": { "Default": "Debug" } } }
```

---

## Check C — Missing enrichers (LOG-003)

### Detection

Confirm `Enrich.FromLogContext()` plus explicit enrichers attach the correlation ID
established in `dotnet-resilience` RES-005, the deployed version/commit SHA, and environment
name to every log event — not just the message text. Without this, two log lines with an
identical message from different app instances/deployments/requests are indistinguishable
when triaging.

### BAD — logs carry only the message, no request/deployment context

```csharp
_logger.LogInformation("Order {OrderId} approved", orderId);
// which instance, which deployment, which request does this belong to? unanswerable from the log alone.
```

### GOOD — correlation ID and deployment context enriched onto every event

```csharp
Log.Logger = new LoggerConfiguration()
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Version", ThisAssembly.AssemblyInformationalVersion)
    .Enrich.WithProperty("Environment", builder.Environment.EnvironmentName)
    .CreateLogger();

// middleware, alongside the correlation ID already set in dotnet-resilience RES-005
using (LogContext.PushProperty("CorrelationId", correlationId))
{
    await next();
}
```

---

## Check D — PII or secrets logged (LOG-004)

### Detection

Grep `_logger.Log*` call sites for arguments that are email/phone/SSN/card-number fields or
connection-string/API-key values, per `always-structured-logging` and `dotnet-data-protection`
DP-003. This is a P0 because it's a direct data-exposure incident, not a hygiene concern —
logs are typically retained far longer and read by a wider audience than the database itself.

### BAD — customer PII and a secret both land in the log sink

```csharp
_logger.LogInformation("Password reset requested for {Email} using token {ResetToken}", user.Email, resetToken);
_logger.LogDebug("Connecting with connection string {ConnectionString}", connectionString);
```

### GOOD — identifiers only, secrets never logged at all

```csharp
_logger.LogInformation("Password reset requested for user {UserId}", user.Id);
_logger.LogDebug("Connecting to database {DatabaseName} on {Host}", db.Database, db.Host); // no credentials
```

---

## Check E — No sampling on high-volume endpoints (LOG-005)

### Detection

For endpoints known to be high-QPS (health polling proxies aside, think a hot read endpoint
called by a SPA on every keystroke), check whether every request logs at `Information` with
no rate-limiting/sampling. This is a cost and signal-to-noise problem: the sink bill scales
with request volume, and the useful error signal gets buried under routine success logs.

### BAD — every single request logged at Information, unconditionally

```csharp
app.Use(async (ctx, next) =>
{
    _logger.LogInformation("Request {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
    await next();
});
```

### GOOD — success logged at a sampled/lower level, failures always logged in full

```csharp
app.Use(async (ctx, next) =>
{
    await next();
    if (ctx.Response.StatusCode >= 400)
        _logger.LogWarning("Request {Method} {Path} failed with {StatusCode}", ctx.Request.Method, ctx.Request.Path, ctx.Response.StatusCode);
    else if (Random.Shared.NextDouble() < 0.01) // 1% sample of successful requests is enough for trend data
        _logger.LogInformation("Request {Method} {Path} succeeded (sampled)", ctx.Request.Method, ctx.Request.Path);
});
```

---

## Logging checklist

- [ ] Logs write to a durable, queryable sink (App Insights/Seq/ELK), not `Console` alone in production
- [ ] Log level is gated per environment (`Information`+ in prod, `Debug` only in dev), with noisy framework namespaces overridden
- [ ] Every log event is enriched with correlation ID, deployed version, and environment
- [ ] No PII (email, phone, SSN, card number) or secret (connection string, API key, token) ever appears as a log argument
- [ ] High-QPS endpoints sample routine success logs; failures are always logged in full
