---
name: dotnet-health-checks
description: Reviews ASP.NET Core health check middleware (Microsoft.Extensions.Diagnostics.HealthChecks) that feeds Kubernetes/AKS/ACA/App Service liveness and readiness probes. Flags missing health endpoints, liveness/readiness conflation causing unnecessary pod restarts, checks that don't actually verify the dependency, expensive checks run on every probe hit, unauthenticated endpoints leaking dependency details, and probe config wired to the wrong path. Outputs findings with pilot-dotnet health-checks standard IDs.
when_to_use: health check, healthz, AddHealthChecks, MapHealthChecks, liveness probe, readiness probe, Kubernetes probe, AKS probe, ACA health probe, HealthCheckResult, dependency health, probe misconfiguration, startup probe
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| HC-001 | P0 | No health check endpoints registered at all |
| HC-002 | P0 | Liveness and readiness not distinguished — one endpoint serves both |
| HC-003 | P1 | Health check doesn't actually verify the dependency it claims to check |
| HC-004 | P1 | Health check runs an expensive query on every probe hit |
| HC-005 | P1 | Health check endpoint exposes internal dependency details to unauthenticated callers |
| HC-006 | P2 | Probe config (K8s/ACA/Bicep) not wired to the correct endpoint path/tags |

---

## Check A — No health check endpoints registered (HC-001)

### Detection

Grep `Program.cs` for `AddHealthChecks()` and `MapHealthChecks()`. If neither is present,
the orchestrator (AKS, Azure Container Apps, App Service health check path) has nothing to
probe and falls back to TCP-connect checks or nothing at all — a process that's deadlocked
internally (thread pool starvation, EF Core connection pool exhaustion) but still accepting
TCP connections will look "healthy" forever and never get recycled.

### BAD — no health checks wired at all

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlServer(connectionString));

var app = builder.Build();
app.MapControllers();
app.Run(); // no /healthz endpoint — orchestrator has no signal beyond "port is open"
```

### GOOD — health checks registered and mapped

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDbContext>("database", tags: new[] { "ready" })
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: new[] { "live" });

var app = builder.Build();
app.MapHealthChecks("/healthz/live", new HealthCheckOptions { Predicate = c => c.Tags.Contains("live") });
app.MapHealthChecks("/healthz/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains("ready") });
app.Run();
```

---

## Check B — Liveness and readiness conflated (HC-002)

### Detection

Grep for a single `MapHealthChecks` call with no `Predicate`/tag filtering, used by both
the Kubernetes `livenessProbe` and `readinessProbe`. If the DB check fails transiently (a
brief connection blip, a failover), the liveness probe fails too — Kubernetes kills and
restarts a process that was otherwise perfectly alive, turning a 2-second DB hiccup into a
full pod restart storm and cold-start latency spike. Liveness should only ask "is this
process alive" (no dependency calls); readiness should check dependencies and can safely
flip the pod out of the load-balancer rotation without killing it.

### BAD — one endpoint used for both liveness and readiness

```csharp
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDbContext>("database"); // no tags

app.MapHealthChecks("/healthz"); // single endpoint checks DB connectivity

// deployment.yaml
// livenessProbe:  { httpGet: { path: /healthz } }   <-- DB blip kills the pod
// readinessProbe: { httpGet: { path: /healthz } }
```

### GOOD — separate tagged endpoints, liveness has no dependency calls

```csharp
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: new[] { "live" })
    .AddDbContextCheck<AppDbContext>("database", tags: new[] { "ready" })
    .AddCheck<ServiceBusHealthCheck>("service-bus", tags: new[] { "ready" });

app.MapHealthChecks("/healthz/live", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("live") // process-only, no I/O
});
app.MapHealthChecks("/healthz/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready") // dependency checks live here only
});

// deployment.yaml
// livenessProbe:  { httpGet: { path: /healthz/live } }
// readinessProbe: { httpGet: { path: /healthz/ready } }
```

---

## Check C — Health check doesn't actually verify the dependency (HC-003)

### Detection

Grep custom `IHealthCheck` implementations for a `CheckHealthAsync` body that returns
`HealthCheckResult.Healthy()` unconditionally, or that catches every exception and still
returns healthy. A health check that can never report unhealthy is worse than no health
check — it gives false confidence in dashboards and readiness gates while the real
dependency is down.

### BAD — always reports healthy regardless of actual state

```csharp
public class ServiceBusHealthCheck : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(HealthCheckResult.Healthy()); // never actually pings Service Bus
    }
}
```

### GOOD — actually exercises the dependency and surfaces failures

```csharp
public class ServiceBusHealthCheck : IHealthCheck
{
    private readonly ServiceBusAdministrationClient _adminClient;
    private readonly string _queueName;

    public ServiceBusHealthCheck(ServiceBusAdministrationClient adminClient, string queueName)
    {
        _adminClient = adminClient;
        _queueName = queueName;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            var props = await _adminClient.GetQueueRuntimePropertiesAsync(_queueName, cancellationToken);
            return HealthCheckResult.Healthy($"Active messages: {props.Value.ActiveMessageCount}");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("Service Bus unreachable", ex);
        }
    }
}
```

---

## Check D — Expensive check on every probe hit (HC-004)

### Detection

Kubernetes/ACA probes fire every few seconds by default. Grep custom health checks for
`SELECT COUNT(*)` over a large table, a full report query, or any call that isn't O(1).
Under load, an expensive check compounds the very outage it's trying to detect — the DB is
already struggling, and now every replica is hammering it every few seconds just to ask
"are you up".

### BAD — heavy aggregate query runs on every probe interval

```csharp
public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct)
{
    var orderCount = await _db.Orders.CountAsync(ct); // full table scan every 5s per pod
    return orderCount >= 0 ? HealthCheckResult.Healthy() : HealthCheckResult.Unhealthy();
}
```

### GOOD — cheap connectivity probe (SELECT 1 / open-connection check)

```csharp
public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct)
{
    try
    {
        await _db.Database.ExecuteSqlRawAsync("SELECT 1", ct); // constant-time connectivity check
        return HealthCheckResult.Healthy();
    }
    catch (Exception ex)
    {
        return HealthCheckResult.Unhealthy("Database unreachable", ex);
    }
}
```

---

## Check E — Health endpoint leaks internal details (HC-005)

### Detection

Grep for `UIResponseWriter.WriteHealthCheckUIResponse` or a custom `ResponseWriter` that
serializes `HealthReportEntry.Description`/`Data` (connection strings, internal hostnames,
Service Bus namespace names) and is exposed on a route with no `[Authorize]`/network
restriction. Any unauthenticated internet-facing caller can then map out internal topology.

### BAD — full diagnostic detail returned to any caller

```csharp
app.MapHealthChecks("/healthz", new HealthCheckOptions
{
    ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse // dumps connection strings, hostnames
}); // no auth, no network restriction — publicly routable
```

### GOOD — minimal public status, detailed report gated internally

```csharp
app.MapHealthChecks("/healthz/ready", new HealthCheckOptions
{
    ResponseWriter = async (ctx, report) =>
    {
        ctx.Response.ContentType = "text/plain";
        await ctx.Response.WriteAsync(report.Status.ToString()); // "Healthy" / "Unhealthy" only
    }
});

app.MapHealthChecks("/internal/healthz/detail", new HealthCheckOptions
{
    ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse
}).RequireAuthorization("InternalOnly"); // detailed report behind auth + internal network policy
```

---

## Check F — Probe misconfigured against the wrong path (HC-006)

### Detection

Cross-check the Kubernetes deployment YAML / Container Apps Bicep `probes` block against
the actual mapped routes in `Program.cs`. A common copy-paste mistake: both `livenessProbe`
and `readinessProbe` point at `/healthz/live`, so a dependency outage never removes the pod
from service (readiness never fails) — traffic keeps routing to a pod that can't reach its
database.

### BAD — readiness probe pointed at the liveness-only path

```yaml
livenessProbe:
  httpGet: { path: /healthz/live, port: 8080 }
readinessProbe:
  httpGet: { path: /healthz/live, port: 8080 } # should be /healthz/ready — DB outage never removes pod from LB
```

### GOOD — each probe targets its matching endpoint

```yaml
livenessProbe:
  httpGet: { path: /healthz/live, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /healthz/ready, port: 8080 }
  periodSeconds: 5
  failureThreshold: 2
```
