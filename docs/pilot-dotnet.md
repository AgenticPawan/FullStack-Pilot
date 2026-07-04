# pilot-dotnet

C# / ASP.NET Core codebase governance for Clean Architecture solutions targeting the
supported .NET range (8, 9, 10, 11 — see the [root README](../README.md#supported-versions)).

## Agent

- **dotnet-reviewer** — reviews a controller/endpoint/service/DbContext diff or file
  against every rule and all skills below. Runs automatically on .NET diff-review
  requests, or invoke manually with `@dotnet-reviewer`.

## Skills

| Skill | Covers |
|---|---|
| `dotnet-clean-architecture` | Domain/Application/Infrastructure/Api layering, dependency-direction rule, DTO mapping, composition-root DI registration |
| `dotnet-solid-dry` | SRP/OCP/LSP/ISP/DIP violations, duplicated logic and magic values |
| `dotnet-coding-standards` | Nullable reference types, sync-over-async, exception handling, structured logging, Options pattern |
| `dotnet-performance` | Sync-over-async, streaming, minimal API overhead, response compression |
| `dotnet-caching` | `IMemoryCache` vs `IDistributedCache`, cache-aside/stampede, invalidation, HybridCache |
| `dotnet-authorization` | Permissions-ONLY access control — no `[Authorize(Roles=...)]` check is ever acceptable, custom `AuthorizationHandler`, resource-based auth, and JWTs kept free of embedded permission lists and PII |
| `dotnet-multitenancy` | Tenant resolution, shared-DB vs DB-per-tenant connection routing |
| `dotnet-soft-delete` | `ISoftDelete`, global query filter, `SaveChanges` interceptor, filtered unique indexes |
| `dotnet-audit-fields` | `CreatedAt`/`CreatedBy`/`ModifiedAt`/`ModifiedBy` via interceptor, `ICurrentUserService`, Guid-typed user fields |
| `dotnet-cors` | Named CORS policies, `AllowAnyOrigin`+`AllowCredentials`, preflight caching |
| `dotnet-repository-pattern` | Repository/Specification/Unit-of-Work usage, leaky `IQueryable` |
| `dotnet-shared-libraries` | String-extension conventions, shared library structure, internal NuGet versioning |
| `dotnet-document-io` | Excel/PDF import-export, streaming large files, row-level import validation, magic-byte upload signature verification, antivirus scan before durable storage |
| `dotnet-email-service` | `IEmailSender` abstraction, HTML template layout, queued sending, retry policy |
| `dotnet-entity-keys` | `Guid` vs `int` primary keys, sequential/v7 GUID generation for clustered-index health, opaque resource identifiers |
| `dotnet-api-versioning` | `Asp.Versioning` wiring, header/query/URL negotiation, breaking-change discipline, deprecation/sunset signaling |
| `dotnet-di-modules` | Per-module `IServiceCollection` extensions, clean `Program.cs` sectioning, module boundary discipline |
| `dotnet-background-jobs` | Hangfire vs hand-rolled `BackgroundService` loops, configurable job schedules (name/cron/enabled), admin-endpoint authorization, job idempotency, dashboard access control |
| `dotnet-dynamic-configuration` | DB-backed configuration for business-tunable settings, Key Vault for secrets, precedence, caching/invalidation |
| `dotnet-localization` | XML/resx default translations with a DB-override layer, culture resolution, missing-key fallback |
| `dotnet-resilience` | `IHttpClientFactory`/typed clients, Polly retry/circuit-breaker/timeout, correlation-ID propagation to outbound calls and logs, EF Core `EnableRetryOnFailure` |
| `dotnet-observability` | `/health/live` + `/health/ready` checks, OpenTelemetry tracing/metrics, correlation ID on distributed traces, PII-safe telemetry |
| `dotnet-error-handling` | Centralized `IExceptionHandler`, RFC 7807 `ProblemDetails`, no leaked exception detail, typed domain exceptions |
| `dotnet-validation` | Consistent FluentValidation-based strategy, single validation pipeline behavior, `ProblemDetails`-shaped validation failures |
| `dotnet-testing` | Shared `WebApplicationFactory` fixtures, Testcontainers over EF Core in-memory provider, test data builders, mocking policy |
| `dotnet-data-protection` | PII column-level encryption, PII erasure on soft-delete, log redaction, data-classification tagging |
| `dotnet-concurrency` | `RowVersion` optimistic concurrency, `DbUpdateConcurrencyException` handling, `ETag`/`If-Match`, read-modify-write guards |
| `dotnet-rate-limiting` | Auth-endpoint throttling, background-jobs admin rate limits, `AddRateLimiter` baseline, `Retry-After` header |
| `dotnet-outbox-pattern` | Transactional outbox for domain events published to Service Bus/Event Grid, idempotent consumers, dead-letter monitoring, outbox row cleanup |
| `dotnet-feature-flags` | `IFeatureManager` vs ad-hoc config checks, percentage/targeting-filter rollout, stale-flag cleanup, consistent frontend flag exposure |
| `dotnet-realtime` | SignalR hub permissions-only authorization, scale-out backplane, genuine `IAsyncEnumerable`/SSE streaming, client reconnection policy |
| `dotnet-audit-trail` | Append-only access-audit log for sensitive-data reads (distinct from `dotnet-audit-fields`' change tracking), tamper-evident storage, compliance query surface |
| `dotnet-financial-precision` | `decimal` vs `double` for currency, consistent rounding-mode convention (banker's rounding), exact decimal comparison, currency-code-paired money values |
| `dotnet-secrets-rotation` | JWT signing-key rotation with grace-period overlap, DB credential rotation cadence, certificate expiry monitoring, rotation audit logging |
| `dotnet-api-contract-testing` | Consumer-driven contract tests (Pact) between the Angular frontend and this API, error-response contract coverage, shared TypeScript-schema generation, provider-verification deploy gate |

## Relationship to dotnet/skills

`pilot-dotnet` builds on, and does not duplicate, Microsoft's official
[`dotnet/skills`](https://github.com/dotnet/skills) marketplace. EF Core query
optimization *implementation*, test running, and framework-version upgrades still route
to `dotnet-data`/`dotnet-test`/`dotnet-upgrade` — see the
[root README](../README.md#relationship-to-dotnetskills). `pilot-dotnet` is reserved for
house conventions those skills intentionally leave to each team.
