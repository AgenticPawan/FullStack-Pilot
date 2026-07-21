---
name: dotnet-aspire-governance
description: "Governs .NET Aspire application models: AppHost project composition (resource naming, connection expressions), ServiceDefaults wiring (AddServiceDefaults call, telemetry/health/resilience auto-configuration), dashboard access policy, and container resource declarations. Checks Aspire project references follow the approved cross-project pattern and required observability hooks are registered."
when_to_use: aspire, apphost, service defaults, distributed application builder, AddServiceDefaults, aspire dashboard, aspire resource, container resource, aspire orchestration, apphost composition, aspire telemetry
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| ASP-001 | P0 | AppHost project references a non-Aspire service project that does not call `AddServiceDefaults` |
| ASP-002 | P1 | Service project does not call `builder.AddServiceDefaults()` before `builder.Build()` |
| ASP-003 | P1 | AppHost uses hardcoded connection strings instead of `WithReference` / `connectionStringExpression` |
| ASP-004 | P2 | Aspire dashboard endpoint exposed without authentication in non-development environments |
| ASP-005 | P2 | Container resource declared without an explicit image tag (floating `:latest`) |

---

## Check A — ServiceDefaults not wired

### Detection

1. Locate the `*.AppHost` project's `Program.cs`.
2. For each `.AddProject<T>()` call, find the referenced project's `Program.cs`.
3. Verify `builder.AddServiceDefaults()` is called before `builder.Build()`.

### BAD

```csharp
// OrdersApi/Program.cs — missing AddServiceDefaults
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
var app = builder.Build();
app.Run();
```

### GOOD

```csharp
// OrdersApi/Program.cs
var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults(); // wires OTel, health checks, resilience
builder.Services.AddControllers();
var app = builder.Build();
app.MapDefaultEndpoints();
app.Run();
```

**Fix:** Add `using Projects;` to AppHost if missing and invoke `builder.AddServiceDefaults()` as the first call after `WebApplication.CreateBuilder`.

---

## Check B — Hardcoded connection strings in AppHost

### Detection

Search `*.AppHost/Program.cs` for string literals in `AddConnectionString`,
`WithEnvironment`, or `WithReference` calls that look like real connection strings
(contain `Server=`, `mongodb://`, `redis://`, etc.).

### BAD

```csharp
var builder = DistributedApplication.CreateBuilder(args);
builder.AddProject<Projects.OrdersApi>("ordersapi")
    .WithEnvironment("ConnectionStrings__Db", "Server=localhost;Database=Orders;");
```

### GOOD

```csharp
var db = builder.AddSqlServer("sqlserver")
                .AddDatabase("ordersdb");
builder.AddProject<Projects.OrdersApi>("ordersapi")
       .WithReference(db);
```

---

## Check C — Floating image tag

### Detection

Search AppHost for `.AddContainer(` or `.AddDockerfile(` calls. Flag any `.WithImage`
call where the tag is `"latest"` or absent.

### BAD

```csharp
builder.AddContainer("redis", "redis"); // no tag — resolves to :latest
```

### GOOD

```csharp
builder.AddContainer("redis", "redis", "7.2.5");
```

---

## Check D — Aspire vs Container Apps decision

| Signal | Use Aspire | Use Azure Container Apps directly |
|--------|-----------|----------------------------------|
| Local dev orchestration needed | ✅ | ❌ no local experience |
| Team owns the app code (not a third-party image) | ✅ | works for both |
| Hosting on Azure Container Apps (ACA) | ✅ (`azd` provisions from Aspire manifest) | ✅ |
| Hosting on AKS / bare VMs | Aspire for local; Helm/Bicep for prod | ✅ |
| Want Aspire dashboard in production | ⚠️ secure carefully | ❌ use Azure Monitor |

**Findings**

| ID | Severity | What it checks |
|----|----------|----------------|
| ASP-006 | P2 | Project uses Aspire for local dev but deploys to AKS with no manifest-to-Helm bridge — Aspire manifest is unused in production |
| ASP-007 | P2 | Aspire dashboard exposed in non-development without HTTPS and auth (re-enforces ASP-004 for ACA deployments) |

**Cross-reference:** `azure-container-apps` for ACA-side governance.

---

## Check E — Local/Azure resource parity

Local Aspire resources must correspond to Azure-hosted equivalents so `azd provision`
and `azd deploy` produce a runnable environment.

**Parity rules:**
- Every `builder.AddSqlServer(...)` in AppHost must have a corresponding SQL Server
  flexible server or Azure SQL resource in the Bicep templates (or be declared as an
  `existingResource` in `main.bicep`).
- Every `builder.AddRedis(...)` must correspond to an Azure Cache for Redis resource.
- Every `builder.AddAzureServiceBus(...)` / `builder.AddAzureEventHubs(...)` must exist
  in Bicep with the same queue/topic names used in `WithReference`.
- Environment variables injected by `WithReference` in Aspire must match the key names
  read in `appsettings.json` / `Program.cs` in every target service — drift here silently
  breaks `azd up` without a compile error.

**Findings**

| ID | Severity | What it checks |
|----|----------|----------------|
| ASP-008 | P1 | Aspire resource declared in AppHost with no corresponding Bicep resource and no `existingResource` annotation |
| ASP-009 | P1 | `WithReference` connection variable name in AppHost does not match the `ConnectionStrings__<name>` key in `appsettings.json` of the consuming project |

---

## Aspire resource naming conventions

| Resource type | Pattern | Example |
|---------------|---------|---------|
| SQL database | `<service>-db` | `orders-db` |
| Redis cache | `<service>-cache` | `session-cache` |
| Service Bus | `<service>-bus` | `notifications-bus` |
| Blob storage | `<service>-blobs` | `documents-blobs` |

Names flow into environment variables and DNS service discovery — keep them lowercase-kebab.
