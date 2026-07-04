---
id: always-no-hardcoded-secrets
title: No Hardcoded Secrets
appliesTo: always
severity: block
standard: OWASP-A02
---
Store secrets in environment variables, Azure Key Vault, or .NET user-secrets. Never embed credentials, API keys, or connection strings in source files or IaC templates.

**BAD**
```csharp
var conn = "Server=prod.database.windows.net;Password=SuperSecret123;";
var apiKey = "sk-live-abc123def456";
```

**GOOD**
```csharp
// appsettings.json has a placeholder; real value comes from Key Vault at runtime
var conn = builder.Configuration.GetConnectionString("Default");
var apiKey = builder.Configuration["ExternalApi:Key"]; // injected via Key Vault reference
```
