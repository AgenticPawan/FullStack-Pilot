---
id: dotnet-gte8-resilience
title: Polly v8 / Microsoft.Extensions.Resilience Named Pipelines
appliesTo: dotnet>=8
severity: block
standard: InternalPolicy
---
All HTTP calls and external integrations must use a named resilience pipeline (retry + timeout + circuit breaker) registered via `AddResiliencePipeline`. Ad-hoc retry loops are a code-review block.

**BAD**
```csharp
for (int i = 0; i < 3; i++) {
    try { return await client.GetAsync(url); }
    catch { await Task.Delay(1000 * i); }
}
```

**GOOD**
```csharp
// Program.cs — register once
builder.Services.AddResiliencePipeline("payments", b => b
    .AddRetry(new RetryStrategyOptions { MaxRetryAttempts = 3 })
    .AddTimeout(TimeSpan.FromSeconds(10))
    .AddCircuitBreaker(new CircuitBreakerStrategyOptions()));

// Service — inject and use
var pipeline = _pipelineProvider.GetPipeline("payments");
return await pipeline.ExecuteAsync(ct => _client.GetAsync(url, ct), cancellationToken);
```
