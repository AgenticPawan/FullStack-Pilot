---
id: dotnet-aspire-service-defaults
title: .NET Aspire — ServiceDefaults Required in Every Participating Service
appliesTo: dotnet
severity: warn
standard: InternalPolicy
---

Every project referenced from the AppHost via `AddProject<T>()` MUST call
`builder.AddServiceDefaults()` before `builder.Build()`. This single call wires
OpenTelemetry traces/metrics, standard health check endpoints (`/healthz`, `/alive`),
and Polly resilience defaults. Omitting it silently breaks the Aspire service graph:
the project will not appear in the dashboard and will not receive telemetry config.

**BAD**
```csharp
// OrdersApi/Program.cs — skips ServiceDefaults
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
var app = builder.Build();
app.Run();
```

**GOOD**
```csharp
// OrdersApi/Program.cs
var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults(); // required for Aspire participation
builder.Services.AddControllers();
var app = builder.Build();
app.MapDefaultEndpoints();
app.Run();
```
