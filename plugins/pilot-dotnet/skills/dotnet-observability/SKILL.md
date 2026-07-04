---
name: dotnet-observability
description: Reviews ASP.NET Core observability setup. Flags missing /health/live and /health/ready endpoints needed for Kubernetes/Azure Container Apps rolling deployments, missing OpenTelemetry tracing/metrics wiring, correlation IDs not attached to distributed traces, readiness checks that don't distinguish liveness from real dependency health, and high-cardinality/PII data logged as trace attributes without redaction. Outputs findings with pilot-dotnet observability standard IDs.
when_to_use: health check, IHealthCheck, liveness probe, readiness probe, OpenTelemetry, distributed tracing, Activity, AddOpenTelemetry, Application Insights, OTLP exporter, correlation id trace, metrics, span attributes, telemetry sampling
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| OBS-001 | P0 | No `/health/live` and `/health/ready` endpoints (`IHealthCheck`) |
| OBS-002 | P1 | No OpenTelemetry tracing/metrics wired, or traces not exported |
| OBS-003 | P1 | Correlation ID not attached to distributed traces/logging scope |
| OBS-004 | P2 | Readiness checks don't distinguish liveness from real dependency health |
| OBS-005 | P3 | High-cardinality/PII data logged as trace attributes with no redaction (advisory) |

---

## Check A — No health-check endpoints (OBS-001)

### Detection

Grep `Program.cs` for `AddHealthChecks()`/`MapHealthChecks(...)`. Without distinct liveness
and readiness endpoints, an orchestrator (Kubernetes, Azure Container Apps) can't tell "the
process is running" from "the process can actually serve traffic," causing it to route
traffic to an instance that's up but can't reach its database, or to restart a healthy
instance stuck waiting on a slow dependency.

### BAD — no health endpoints at all

```csharp
var app = builder.Build();
app.MapControllers();
app.Run();
// Orchestrator has no way to know if this instance can serve traffic.
```

### GOOD — separate liveness and readiness endpoints

```csharp
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: new[] { "live" })
    .AddDbContextCheck<AppDbContext>("database", tags: new[] { "ready" })
    .AddUrlGroup(new Uri("https://weather.example.com/health"), "weather-api", tags: new[] { "ready" });

var app = builder.Build();

app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("live")
});
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
});
```

---

## Check B — No OpenTelemetry wiring (OBS-002)

### Detection

Grep for `AddOpenTelemetry()` / `Microsoft.Extensions.Telemetry` /
`Azure.Monitor.OpenTelemetry.AspNetCore` registration. Flag an API with no tracing/metrics
exporter configured — once a request crosses two or more services, logs alone can't
reconstruct the call graph or show where latency was spent.

### BAD — no tracing/metrics pipeline

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
// No AddOpenTelemetry() anywhere — request latency and cross-service spans are invisible.
```

### GOOD — tracing and metrics exported to Application Insights

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddEntityFrameworkCoreInstrumentation())
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation())
    .UseAzureMonitor(); // or .AddOtlpExporter() for a vendor-neutral collector
```

---

## Check C — Correlation ID not attached to traces (OBS-003)

### Detection

Confirm the correlation ID established in `dotnet-resilience` RES-005 is also set as an
`Activity` tag (`Activity.Current?.SetTag("correlation.id", correlationId)`), not just a
logging scope — otherwise the trace view in Application Insights/Jaeger can't be filtered
by the same ID a support engineer sees in the response header.

### BAD — correlation ID only in logs, not on the trace span

```csharp
using (_logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
{
    await next(); // Activity/trace span has no matching tag
}
```

### GOOD — correlation ID on both the log scope and the active trace span

```csharp
Activity.Current?.SetTag("correlation.id", correlationId);
using (_logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
{
    await next();
}
```

---

## Check D — Readiness doesn't check real dependencies (OBS-004)

### Detection

Check whether the `/health/ready` check actually pings the database/critical downstream
dependencies (as in Check A's `AddDbContextCheck`/`AddUrlGroup`), or just returns
`Healthy()` unconditionally — the latter looks identical to liveness and defeats the
purpose of a separate readiness probe.

### BAD — readiness check is just liveness under a different name

```csharp
builder.Services.AddHealthChecks()
    .AddCheck("ready", () => HealthCheckResult.Healthy(), tags: new[] { "ready" });
// Always healthy — traffic gets routed to an instance that can't reach its database.
```

### GOOD — readiness reflects actual dependency health (see Check A's full example)

Reuse the `AddDbContextCheck`/`AddUrlGroup` registrations from Check A; readiness must fail
when a required dependency is unreachable.

---

## Check E — PII/high-cardinality data in trace attributes (OBS-005, advisory)

### Detection

Review custom `Activity.SetTag(...)` calls and OpenTelemetry instrumentation options for
values that are PII (full names, emails) or unbounded-cardinality (full URLs with query
strings, raw user IDs at high volume) — these inflate telemetry cost and, for PII, create
the same exposure risk flagged in `dotnet-data-protection` DP-003 for logs.

### BAD — PII and raw query strings as trace tags

```csharp
Activity.Current?.SetTag("user.email", user.Email);          // PII on every trace
Activity.Current?.SetTag("http.url", Request.GetDisplayUrl()); // full query string, unbounded cardinality
```

### GOOD — redacted/bounded tag values

```csharp
Activity.Current?.SetTag("user.id", user.Id.ToString());  // Guid identifier, not PII
Activity.Current?.SetTag("http.route", Request.Path);      // route template, not full URL/query string
```
