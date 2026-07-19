# Vetted Stack Packages — FullStack Pilot Multi-Stack Guide

> Curated packages for Angular / .NET / SQL / Azure projects.
> Includes "when NOT to use" guidance to prevent over-engineering.
>
> **Version pinning rule**: Always `dotnet add package <name>` without `--version` to get
> latest stable. For Angular: `ng add` or `npm install <pkg>@latest`. Never pin to a version
> from memory — versions in training data are stale.

---

## Angular

### NgRx (State Management)

- **Package**: `@ngrx/store`, `@ngrx/effects`, `@ngrx/entity`, `@ngrx/signals` (17+)
- **Use when**: Global state shared across multiple feature areas with complex update logic.
- **When NOT to use**: For local component state (use signals), for a single-page form (use reactive forms + signals), or when the app has fewer than 3 routes sharing state.
- **Breaking versions to avoid**: NgRx < 17 uses class-based effects; NgRx 17+ supports functional effects. Do not mix styles within one store.

### RxJS

- **Package**: `rxjs` (7.x, ships with Angular)
- **Key operators**: `switchMap` (cancel previous), `mergeMap` (parallel), `exhaustMap` (ignore while busy), `combineLatest`, `distinctUntilChanged`.
- **When NOT to use**: For simple one-shot HTTP calls, prefer Angular signals + resource API (Angular 17+) over RxJS chains.
- **Antipattern**: Nesting subscriptions. Always compose with operators.

### Angular CDK

- **Package**: `@angular/cdk`
- **Use for**: Drag-and-drop, virtual scroll, overlays, accessibility utilities (FocusTrap, A11y).
- **When NOT to use**: When you only need one CDK utility — evaluate if the weight is justified for a single drag interaction.

### Angular Material

- **Package**: `@angular/material`
- **Use when**: Standardizing UI components and theming across the application.
- **When NOT to use**: When using a custom design system that conflicts with Material tokens. Do not mix Material and another component library in the same app.

---

## .NET

### Mediator (in-process messaging) — Recommended Default

- **Package**: `Mediator.SourceGenerator` + `Mediator.Abstractions`
- **Why**: Source-generated, zero-reflection, Native AOT compatible, MIT license, near-identical API to MediatR. Use `ISender` for requests.
- **When NOT to use**: Apps with fewer than 5 features where handler indirection adds complexity without benefit. For distributed messaging, use Wolverine instead.
- **Version note**: MediatR 13+ requires a commercial license for most use — prefer this package for new projects.

### FluentValidation

- **Package**: `FluentValidation` + `FluentValidation.DependencyInjectionExtensions`
- **Use when**: Complex validation rules, async rules (DB-dependent), testable validators.
- **When NOT to use**: Simple DTOs where DataAnnotations suffice, or Blazor EditForms with standard DataAnnotations.

### Polly v8 / Microsoft.Extensions.Http.Resilience

- **Package**: `Microsoft.Extensions.Http.Resilience`
- **Use when**: Outbound HTTP calls need retry, circuit breaker, or hedging.
- **When NOT to use**: Internal in-process calls. Wolverine/MassTransit have built-in retry — don't stack.

### HybridCache (built-in .NET 9+)

- **Package**: `Microsoft.Extensions.Caching.Hybrid`
- **Use when**: L1 (in-memory) + L2 (Redis/distributed) caching with stampede protection and tag-based invalidation.
- **When NOT to use**: Simple in-memory-only caching with no distributed cache — `IMemoryCache` is sufficient there.
- **Breaking note**: Replaces manual `IDistributedCache` + serialization patterns. Do not mix both approaches in one service.

### Testcontainers

- **Package**: `Testcontainers` + `Testcontainers.MsSql` / `Testcontainers.PostgreSql`
- **Use for**: Integration tests with real databases, no shared test infrastructure.
- **When NOT to use**: CI environments without Docker. Pure unit tests where in-memory provider is faster.

### xUnit v3

- **Package**: `xunit.v3`
- **Use for**: All new test projects. V3 brings improved parallel execution and `IAsyncLifetime`.
- **When NOT to use**: Migrating an existing large NUnit suite where migration cost exceeds benefit.

### Wolverine (messaging + mediator)

- **Package**: `WolverineFx`
- **Use when**: You need both in-process mediator AND distributed messaging (RabbitMQ, Azure Service Bus) from one library.
- **When NOT to use**: Pure in-process mediator only — prefer `Mediator` (lighter). MassTransit shops already invested in state machines may prefer staying on MassTransit v8.

### Serilog

- **Package**: `Serilog.AspNetCore` + sink packages
- **Use when**: Structured logging with multiple sinks (Seq, App Insights, Elasticsearch, file).
- **When NOT to use**: Simple CLI tools where `Microsoft.Extensions.Logging` with a console provider is enough.

---

## SQL / EF Core

### EF Core

- **Package**: `Microsoft.EntityFrameworkCore` + provider (SqlServer, PostgreSQL)
- **Use when**: Relational data with LINQ queries, migrations, and change tracking.
- **When NOT to use**: Read-heavy reporting (use raw SQL / Dapper for those paths), bulk operations (use EF Core bulk extensions or raw SQL), non-relational data.
- **Version pinning**: Match the major version to your .NET version (net10 → EF Core 10.x).

### EF Core Bulk Extensions

- **Package**: `EFCore.BulkExtensions`
- **Use for**: BulkInsert, BulkUpdate, BulkDelete when EF Core's default tracking-based operations are too slow.
- **When NOT to use**: Standard CRUD — EF Core's change tracker is faster for small batches.

---

## Azure

### Bicep Registry Modules to Prefer

- **`avm/res/`** (Azure Verified Modules): First-party Microsoft-maintained Bicep modules for standard resources (storage accounts, key vaults, app services, AKS). Prefer over hand-written resource blocks for any resource with a verified module.
- **When to hand-write**: Custom role assignments, policy definitions, or resources not yet covered by AVM.

### Application Configuration

- **Package**: `Azure.Extensions.AspNetCore.Configuration.Secrets`
- **Use for**: Loading Key Vault secrets into `IConfiguration` at startup.
- **When NOT to use**: Dynamic configuration that changes at runtime without restart — use Azure App Configuration with the refresh mechanism instead.

### Azure.Identity

- **Package**: `Azure.Identity`
- **Use for**: Managed identity authentication to all Azure services (`DefaultAzureCredential`).
- **When NOT to use**: Never use connection strings with embedded keys — always prefer managed identity or workload identity.
