---
id: dotnet-lt8-legacy
title: Legacy .NET Guidance (net6/net7 — EOL)
appliesTo: dotnet<8
severity: warn
standard: InternalPolicy
---
> **⚠ EOL ADVISORY**: net6 (end-of-life May 2024) and net7 (end-of-life May 2024) are out of Microsoft support. No further security patches will be issued. Run `/pilot-upgrade` to plan the migration to net8+. Governance for EOL stacks is **upgrade pressure**, not blessing.

Follow `Startup.cs` conventions for service registration and middleware ordering. Do not introduce Minimal API patterns into net6/net7 projects without upgrading first.

**BAD**
```csharp
// Mixing Minimal API top-level statements into a net6 Startup.cs app
// without a consistent boundary plan creates two competing registration styles
app.MapGet("/health", () => "OK"); // fine in net8+; confusing in Startup-style net6 apps
```

**GOOD**
```csharp
// net6/net7: keep Startup.cs pattern consistent; add new endpoints via Controllers
public void Configure(IApplicationBuilder app, IWebHostEnvironment env) {
    app.UseRouting();
    app.UseEndpoints(e => e.MapControllers());
}
// Then run /pilot-upgrade to plan the net8 migration
```
