---
id: dotnet-no-sync-over-async
title: No Blocking on Async (.Result / GetAwaiter().GetResult())
appliesTo: dotnet
severity: warn
standard: CWE-833
---
Never block a thread on an async method with `.Result` or `.GetAwaiter().GetResult()`. In ASP.NET Core, synchronization-context deadlocks silently starve the thread pool; in background services, the behavior is undefined when the captured context is non-null.

**BAD**
```csharp
// Deadlocks ASP.NET Core when called from a synchronous context
var result = _httpClient.GetStringAsync(url).Result;
var data = LoadAsync().GetAwaiter().GetResult();
```

**GOOD**
```csharp
// Propagate async all the way up the call chain
var result = await _httpClient.GetStringAsync(url);
var data = await LoadAsync();
```

**Exception:** top-of-stack entry points where the call chain truly cannot be made async
(e.g. `Main` with `async Main` not available, `IHostedService.StartAsync` bootstrap).
Add a `// pilot: sync-over-async approved — <reason>` comment to suppress the advisory.
