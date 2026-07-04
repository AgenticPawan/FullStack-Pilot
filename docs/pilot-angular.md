# pilot-angular

Angular / TypeScript governance for Angular 15–20. Deep, actively-maintained coverage
targets 17–20; 15–16 are EOL and get upgrade guidance only.

## Agent

- **angular-reviewer** — reviews a component diff or file against every materialized
  Angular rule and all skills below. Runs automatically on diff-review requests,
  or invoke manually with `@angular-reviewer`.

## Skills

| Skill | Covers |
|---|---|
| `angular-signals-and-state` | `signal()`/`computed()`/`effect()`, when RxJS still wins, `toSignal()`/`toObservable()`, `linkedSignal()` (v20), `resource()`/`httpResource()` |
| `angular-performance` | OnPush, zoneless (v18+ experimental, v20 stable), `@for`/`track` (v17+), `@defer` (v17+), lazy routes, bundle budgets, `NgOptimizedImage` |
| `angular-a11y` | WCAG 2.2 AA: semantic HTML first, ARIA only when needed, focus management via CDK `FocusTrap`/`LiveAnnouncer`, keyboard nav, contrast, skip links |
| `angular-security` | XSS via template binding, `DomSanitizer` bypass policy, nonce-based CSP, Trusted Types (v17+), CSRF via `HttpClientXsrfModule`, and permissions-ONLY route guards/UI gating (no role checks, ever) |
| `angular-http-resilience` | Typed `HttpClient` wrappers, interceptor retry/backoff, correlation-ID propagation, typed error models, loading state |
| `angular-memory-leaks` | Subscription leaks, `takeUntilDestroyed()` (v16+), async pipe preference, `DestroyRef`, detached change-detector trees |
| `angular-upgrade-path` | Step-by-step v15→v17+ migration: standalone schematics, NgModule removal, control-flow migration, signal input/output adoption, TSLint→ESLint |
| `angular-coding-standards` | Naming conventions, standalone-first architecture, service extraction, strict TypeScript, barrel-file risk, signal-based input/output |
| `angular-multi-layout` | Centralized layout component, layout-selection service, persisted layout preference, responsive sidebar/header shells |
| `angular-theming` | Design-token/CSS-custom-property themes, runtime switching without reload, Material M3 theming (v17+), FOUC prevention, WCAG contrast |
| `angular-shared-libraries` | Reusable reactive-forms building blocks, generic paged/sortable/filterable `DataTableComponent`, workspace-library extraction |
| `angular-dynamic-forms` | JSON-schema-driven reactive forms — field descriptors (id, name, validations, enabled, localization key, tooltip), generic renderer, descriptor-driven validation/enablement/localization |
| `angular-testing` | Accessible-role component queries (Testing Library), `HttpTestingController`, Component Test Harnesses, documented e2e (Playwright) convention, signal-test flushing |
| `angular-i18n` | i18n library wiring, shared translation-key space with `dotnet-localization`, locale-aware date/number/currency formatting, RTL layout support |
| `angular-error-handling` | Global `ErrorHandler`, shared error-notification pattern, `ProblemDetails`-aware HTTP error parsing (the frontend counterpart to `dotnet-error-handling`), recoverable-vs-crash fallback UI |
| `angular-pwa-offline` | `@angular/service-worker` configuration, offline fallback UI, shell-vs-API caching strategy, offline-edit conflict resolution — only relevant for field/offline-capable apps |
| `angular-telemetry` | Application Insights JS SDK wiring, consistent event-tracking naming convention, frontend-to-backend trace-ID correlation, PII-free telemetry properties |

## Version policy

| Range | Status |
|---|---|
| 20 | Current — zoneless stable, `linkedSignal()`/`resource()` stable |
| 17–19 | Deep coverage |
| 15–16 | **EOL.** Only `angular-upgrade-path` applies; no new rules are written against these versions |
