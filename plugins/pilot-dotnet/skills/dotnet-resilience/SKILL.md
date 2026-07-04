---
name: dotnet-resilience
description: Reviews ASP.NET Core outbound HTTP call resilience — the backend counterpart to angular-http-resilience. Flags raw HttpClient instantiation instead of IHttpClientFactory/typed clients, missing Polly retry/backoff policies, no circuit breaker on failure-prone downstream dependencies, missing per-request timeouts, and correlation IDs received from the Angular frontend not propagated onto outbound calls or structured logs. Outputs findings with pilot-dotnet resilience standard IDs.
when_to_use: HttpClientFactory, Polly, retry policy, circuit breaker, timeout policy, outbound HTTP call, transient fault, resilience pipeline, IHttpClientFactory, typed client, correlation id propagation, socket exhaustion, downstream dependency
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| RES-001 | P0 | Raw `HttpClient` instantiated instead of via `IHttpClientFactory`/typed client |
| RES-002 | P1 | No Polly retry/backoff policy on an outbound call to another service |
| RES-003 | P1 | No circuit breaker on a downstream dependency prone to cascading failure |
| RES-004 | P1 | No per-request timeout configured on an outbound call |
| RES-005 | P2 | Correlation ID not propagated onto outbound calls or structured logs |

---

## Check A — Raw HttpClient instead of IHttpClientFactory (RES-001)

### Detection

1. Grep for `new HttpClient()` outside of test code.
2. Each `new HttpClient()` opens its own connection pool; disposing and recreating it per
   request/method call exhausts sockets under load (the classic "socket exhaustion"
   incident) because TCP connections linger in `TIME_WAIT`.

### BAD — new HttpClient() per call

```csharp
public class WeatherClient
{
    public async Task<WeatherDto> GetAsync(string city)
    {
        using var client = new HttpClient(); // new connection pool every call
        var response = await client.GetAsync($"https://weather.example.com/{city}");
        return await response.Content.ReadFromJsonAsync<WeatherDto>();
    }
}
```

### GOOD — typed client via IHttpClientFactory

```csharp
// Program.cs
builder.Services.AddHttpClient<WeatherClient>(client =>
{
    client.BaseAddress = new Uri("https://weather.example.com");
});

public class WeatherClient
{
    private readonly HttpClient _client;
    public WeatherClient(HttpClient client) => _client = client; // pooled/recycled by the factory

    public async Task<WeatherDto> GetAsync(string city) =>
        await _client.GetFromJsonAsync<WeatherDto>(city);
}
```

---

## Check B — No retry/backoff policy (RES-002)

### Detection

Grep the `AddHttpClient<T>` registration for a chained resilience handler
(`AddStandardResilienceHandler()` on .NET 8+'s `Microsoft.Extensions.Http.Resilience`, or a
Polly `AddPolicyHandler`). Flag an outbound client with no retry policy at all — a single
transient network blip (DNS hiccup, momentary 503) fails the whole request instead of
recovering silently.

### BAD — no resilience wrapping at all

```csharp
builder.Services.AddHttpClient<WeatherClient>(client =>
{
    client.BaseAddress = new Uri("https://weather.example.com");
});
// One dropped packet = a failed request, no retry.
```

### GOOD — standard resilience handler with retry + backoff

```csharp
builder.Services.AddHttpClient<WeatherClient>(client =>
{
    client.BaseAddress = new Uri("https://weather.example.com");
})
.AddStandardResilienceHandler(options =>
{
    options.Retry.MaxRetryAttempts = 3;
    options.Retry.BackoffType = DelayBackoffType.Exponential;
    options.Retry.UseJitter = true;
});
```

---

## Check C — No circuit breaker on a failure-prone dependency (RES-003)

### Detection

For a downstream dependency known to fail/degrade under load (a third-party API, a
frequently-slow internal service), check whether the resilience pipeline includes a circuit
breaker stage. Without one, retries against an already-down dependency pile up load on it
and on the calling service's thread pool, worsening an outage instead of containing it.

### BAD — retries alone against a degraded dependency

```csharp
.AddStandardResilienceHandler(); // default has retry + timeout, but verify circuit breaker
                                  // thresholds are appropriate for THIS dependency's failure mode
```

### GOOD — explicit circuit breaker tuned to the dependency

```csharp
builder.Services.AddHttpClient<PaymentGatewayClient>(client =>
{
    client.BaseAddress = new Uri("https://payments.example.com");
})
.AddResilienceHandler("payment-gateway", builder =>
{
    builder.AddRetry(new HttpRetryStrategyOptions { MaxRetryAttempts = 2 });
    builder.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
    {
        FailureRatio = 0.5,
        SamplingDuration = TimeSpan.FromSeconds(30),
        MinimumThroughput = 10,
        BreakDuration = TimeSpan.FromSeconds(15),
    });
});
```

---

## Check D — No per-request timeout (RES-004)

### Detection

Check whether the outbound client has an explicit timeout (via the resilience pipeline's
`Timeout` strategy or `HttpClient.Timeout`). A hung downstream call with no timeout can tie
up a request thread/connection indefinitely, exhausting the pool under concurrent load.

### BAD — no timeout, relying on the OS default

```csharp
builder.Services.AddHttpClient<WeatherClient>(client =>
{
    client.BaseAddress = new Uri("https://weather.example.com");
    // No Timeout set — defaults to 100 seconds, far too long for a user-facing request
});
```

### GOOD — explicit timeout matched to the call's real budget

```csharp
.AddResilienceHandler("weather", builder =>
{
    builder.AddTimeout(TimeSpan.FromSeconds(5));
});
```

---

## Check E — Correlation ID not propagated (RES-005)

### Detection

1. Confirm the incoming `X-Correlation-Id` header (sent by the Angular interceptor per
   `angular-http-resilience`) is read once (via middleware) and attached to the
   `ILogger` scope for the request.
2. Confirm the same correlation ID is added as an outgoing header on every downstream
   `HttpClient` call so a single user action can be traced across service boundaries.

### BAD — correlation ID received but dropped

```csharp
app.Use(async (ctx, next) =>
{
    var correlationId = ctx.Request.Headers["X-Correlation-Id"].FirstOrDefault();
    await next(); // never attached to logs or forwarded downstream
});
```

### GOOD — correlation ID flows through logs and outbound calls

```csharp
app.Use(async (ctx, next) =>
{
    var correlationId = ctx.Request.Headers["X-Correlation-Id"].FirstOrDefault()
        ?? Guid.NewGuid().ToString();
    ctx.Response.Headers["X-Correlation-Id"] = correlationId;

    using (_logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
    {
        ctx.Items["CorrelationId"] = correlationId;
        await next();
    }
});

// Outbound call — a DelegatingHandler forwards the same header
public class CorrelationIdHandler : DelegatingHandler
{
    private readonly IHttpContextAccessor _accessor;

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken ct)
    {
        var correlationId = _accessor.HttpContext?.Items["CorrelationId"] as string;
        if (correlationId is not null)
            request.Headers.TryAddWithoutValidation("X-Correlation-Id", correlationId);
        return base.SendAsync(request, ct);
    }
}

builder.Services.AddTransient<CorrelationIdHandler>();
builder.Services.AddHttpClient<WeatherClient>(...).AddHttpMessageHandler<CorrelationIdHandler>();
```

Ties to `dotnet-observability` OBS-003, which covers attaching the same correlation ID to
distributed traces (`Activity` tags), not just log scopes.
