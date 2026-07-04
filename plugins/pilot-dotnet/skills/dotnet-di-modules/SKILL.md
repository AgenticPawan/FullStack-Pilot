---
name: dotnet-di-modules
description: Reviews ASP.NET Core dependency-injection structure for a clean, modular Program.cs. Flags feature registration inlined directly into Program.cs instead of a per-module IServiceCollection extension method, a module reaching into another module's internals, infra bootstrap mixed with feature-module registration with no clear ordering, and module registration duplicated between Program.cs and test host setup. Outputs findings with pilot-dotnet di-modules standard IDs.
when_to_use: Program.cs, dependency injection, IServiceCollection extension, AddModule, composition root, DI per module, clean Program.cs, WebApplicationBuilder, service registration, module boundary, WebApplicationFactory, minimal hosting model
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| DIM-001 | P1 | Feature registration inlined in `Program.cs` instead of a per-module `IServiceCollection` extension |
| DIM-002 | P2 | A module's extension method reaches into another module's internal types |
| DIM-003 | P1 | `Program.cs` mixes infra bootstrap with feature registration with no clear sectioning/ordering |
| DIM-004 | P2 | Module registration duplicated between `Program.cs` and test host setup |

---

## Check A — Feature registration inlined in Program.cs (DIM-001)

### Detection

1. Scan `Program.cs` for a long run of `builder.Services.Add...` calls that all belong to one feature area (e.g., every Orders-related repository, service, validator, and mapper registered inline).
2. If a single feature contributes more than a handful of registrations directly in `Program.cs` instead of behind one extension method call, flag it — `Program.cs` should read as a table of contents, not an implementation.

### BAD — every feature's services registered inline

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddScoped<IOrderRepository, OrderRepository>();
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddScoped<IOrderValidator, OrderValidator>();
builder.Services.AddAutoMapper(typeof(OrderMappingProfile));
builder.Services.AddScoped<IInvoiceRepository, InvoiceRepository>();
builder.Services.AddScoped<IInvoiceService, InvoiceService>();
builder.Services.AddScoped<IInvoicePdfRenderer, InvoicePdfRenderer>();
// ...30 more lines, one giant undifferentiated block
```

### GOOD — one extension method per module

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddOrdersModule(builder.Configuration)
    .AddInvoicingModule(builder.Configuration)
    .AddNotificationsModule(builder.Configuration);

// Orders/DependencyInjection/OrdersModule.cs
public static class OrdersModule
{
    public static IServiceCollection AddOrdersModule(this IServiceCollection services, IConfiguration config)
    {
        services.AddScoped<IOrderRepository, OrderRepository>();
        services.AddScoped<IOrderService, OrderService>();
        services.AddScoped<IOrderValidator, OrderValidator>();
        services.AddAutoMapper(typeof(OrderMappingProfile));
        return services;
    }
}
```

---

## Check B — Module reaching into another module's internals (DIM-002)

### Detection

1. Grep a module's `AddXModule` extension for direct references to another module's non-public/implementation types (`new InvoiceRepository(...)` from the Orders module, or `services.AddScoped<InvoicingDbContext>()` registered from an unrelated module).
2. Each module should only register and expose its own composition root; cross-module dependencies should flow through the *interfaces* the other module publishes, resolved via DI — not by one module's registration code directly constructing another module's concrete classes.

### BAD — Orders module reaches into Invoicing's internals

```csharp
public static class OrdersModule
{
    public static IServiceCollection AddOrdersModule(this IServiceCollection services, IConfiguration config)
    {
        services.AddScoped<IOrderService, OrderService>();
        services.AddScoped<InvoicePdfRenderer>(); // Invoicing's concrete internal type — wrong module
        return services;
    }
}
```

### GOOD — each module owns only its own registrations; cross-module calls go through interfaces

```csharp
public static class OrdersModule
{
    public static IServiceCollection AddOrdersModule(this IServiceCollection services, IConfiguration config)
    {
        services.AddScoped<IOrderService, OrderService>(); // depends on IInvoicingClient, not InvoicePdfRenderer
        return services;
    }
}
```

---

## Check C — Program.cs mixes infra bootstrap with feature registration (DIM-003)

### Detection

Check whether `Program.cs` interleaves cross-cutting bootstrap (logging, auth, DbContext, CORS, health checks) with feature-module calls in no discernible order, versus a clear top-to-bottom sectioning: infra bootstrap first, then feature modules, then the request pipeline (`app.Use...`).

### BAD — infra and features interleaved with no structure

```csharp
builder.Services.AddOrdersModule(builder.Configuration);
builder.Services.AddDbContext<AppDbContext>(...);
builder.Services.AddAuthentication(...);
builder.Services.AddInvoicingModule(builder.Configuration);
builder.Services.AddCors(...);
builder.Services.AddNotificationsModule(builder.Configuration);
builder.Services.AddHealthChecks();
```

### GOOD — sectioned Program.cs

```csharp
var builder = WebApplication.CreateBuilder(args);

// --- Infrastructure bootstrap ---
builder.Services.AddDbContext<AppDbContext>(...);
builder.Services.AddAuthentication(...).AddJwtBearer(...);
builder.Services.AddCors(...);
builder.Services.AddHealthChecks();

// --- Feature modules ---
builder.Services
    .AddOrdersModule(builder.Configuration)
    .AddInvoicingModule(builder.Configuration)
    .AddNotificationsModule(builder.Configuration);

var app = builder.Build();

// --- Request pipeline ---
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.Run();
```

---

## Check D — Module registration duplicated in test host setup (DIM-004)

### Detection

Grep integration-test `WebApplicationFactory<Program>`/`CustomWebApplicationFactory` overrides for hand-repeated service registrations that duplicate a module's `AddXModule` call instead of invoking it and only overriding the few services the test needs to fake (e.g., swapping a real email sender for a test double via `ConfigureTestServices`).

### BAD — test factory re-registers services by hand instead of reusing the module

```csharp
protected override void ConfigureWebHost(IWebHostBuilder builder)
{
    builder.ConfigureServices(services =>
    {
        services.AddScoped<IOrderRepository, OrderRepository>();
        services.AddScoped<IOrderService, OrderService>();
        // Program.cs's AddOrdersModule() already does this — now two places must stay in sync
    });
}
```

### GOOD — reuse the same module extension, override only what the test needs

```csharp
protected override void ConfigureWebHost(IWebHostBuilder builder)
{
    // Program.cs already calls AddOrdersModule() via the normal startup path.
    builder.ConfigureTestServices(services =>
    {
        services.RemoveAll<IEmailSender>();
        services.AddScoped<IEmailSender, FakeEmailSender>();
    });
}
```
