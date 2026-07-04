# pilot-angular

Angular / TypeScript governance for Angular 15–20. Deep, actively-maintained coverage
targets 17–20; 15–16 are EOL and get upgrade guidance only.

## Agent

- **angular-reviewer** — reviews a component diff or file against every materialized
  Angular rule and all seven skills below. Runs automatically on diff-review requests,
  or invoke manually with `@angular-reviewer`.

## Skills

| Skill | Covers |
|---|---|
| `angular-signals-and-state` | `signal()`/`computed()`/`effect()`, when RxJS still wins, `toSignal()`/`toObservable()`, `linkedSignal()` (v20), `resource()`/`httpResource()` |
| `angular-performance` | OnPush, zoneless (v18+ experimental, v20 stable), `@for`/`track` (v17+), `@defer` (v17+), lazy routes, bundle budgets, `NgOptimizedImage` |
| `angular-a11y` | WCAG 2.2 AA: semantic HTML first, ARIA only when needed, focus management via CDK `FocusTrap`/`LiveAnnouncer`, keyboard nav, contrast, skip links |
| `angular-security` | XSS via template binding, `DomSanitizer` bypass policy, nonce-based CSP, Trusted Types (v17+), CSRF via `HttpClientXsrfModule` |
| `angular-http-resilience` | Typed `HttpClient` wrappers, interceptor retry/backoff, correlation-ID propagation, typed error models, loading state |
| `angular-memory-leaks` | Subscription leaks, `takeUntilDestroyed()` (v16+), async pipe preference, `DestroyRef`, detached change-detector trees |
| `angular-upgrade-path` | Step-by-step v15→v17+ migration: standalone schematics, NgModule removal, control-flow migration, signal input/output adoption, TSLint→ESLint |

## Version policy

| Range | Status |
|---|---|
| 20 | Current — zoneless stable, `linkedSignal()`/`resource()` stable |
| 17–19 | Deep coverage |
| 15–16 | **EOL.** Only `angular-upgrade-path` applies; no new rules are written against these versions |
