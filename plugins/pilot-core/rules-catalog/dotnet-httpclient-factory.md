---
id: dotnet-httpclient-factory
title: HttpClient via IHttpClientFactory Only
appliesTo: dotnet
severity: block
standard: CWE-400
---
Never instantiate `HttpClient` directly. Always use `IHttpClientFactory` (typed or named client) to prevent socket exhaustion and enable centralized policy configuration.

**BAD**
```csharp
public async Task<string> GetDataAsync(string url) {
    using var client = new HttpClient(); // socket exhaustion risk
    return await client.GetStringAsync(url);
}
```

**GOOD**
```csharp
// Program.cs
builder.Services.AddHttpClient<PaymentsService>(c => c.BaseAddress = new Uri(paymentsUrl));

// PaymentsService — HttpClient injected by factory
public PaymentsService(HttpClient client) => _client = client;

public async Task<string> GetDataAsync(string path) =>
    await _client.GetStringAsync(path);
```
