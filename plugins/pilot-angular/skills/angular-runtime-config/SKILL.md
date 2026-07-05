---
name: angular-runtime-config
description: Reviews runtime environment configuration for containerized Angular SPAs — the frontend mirror of dotnet-dynamic-configuration. Flags API base URLs and feature flags baked into environment.ts at build time (forcing a separate Docker image per environment), no runtime config.json + APP_INITIALIZER pattern, config fetched too late for early-bootstrap consumers like interceptors, secrets placed in a client-visible config.json, no startup error handling when the config endpoint is unreachable, and inconsistent precedence between build-time defaults and runtime overrides. Outputs findings with pilot-angular runtime-config standard IDs.
when_to_use: runtime config, config.json, APP_INITIALIZER, provideAppInitializer, environment.ts, build-time config, one image many environments, Docker image per environment, feature flags, container config injection, reverse proxy config, startup config fetch, config precedence
applies_to: angular
---

<!-- Version index:
  APP_INITIALIZER token                Angular 2+ (all versions)
  provideAppInitializer() function     Angular 19+ (functional replacement for APP_INITIALIZER)
  provideEnvironmentInitializer()      Angular 14.2+
-->

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ARC-001 | P1 | API base URL / feature flags baked into `environment.ts` at build time |
| ARC-002 | P1 | No runtime `config.json` + `APP_INITIALIZER`/`provideAppInitializer` pattern |
| ARC-003 | P1 | Runtime config not cached synchronously before early-bootstrap code needs it |
| ARC-004 | P0 | Secrets or sensitive values placed in the client-visible `config.json` |
| ARC-005 | P1 | No fallback/error handling when the config endpoint is unreachable at startup |
| ARC-006 | P2 | Inconsistent precedence between build-time defaults and runtime overrides |

**Cross-reference:** this is the Angular-side counterpart to `dotnet-dynamic-configuration` —
that skill governs the backend's layered configuration providers (appsettings + environment
variables + Azure App Configuration); this skill governs how the *same promoted container image*
picks up environment-specific values on the client without a rebuild.

---

## Check A — Build-time config forces per-environment images (ARC-001)

### Detection
1. Inspect `src/environments/environment.ts` / `environment.prod.ts` (or `fileReplacements` in
   `angular.json`) for `apiBaseUrl`, feature-flag booleans, or tenant-specific values.
2. Confirm whether the Dockerfile/CI pipeline builds a distinct image per environment
   (`ng build --configuration=staging`, `ng build --configuration=production`) rather than
   building once and promoting the same artifact through environments.
3. Flag any environment-specific value that only exists as a compiled-in TypeScript constant —
   changing it requires a rebuild, which breaks "build once, deploy everywhere" and makes the
   staging-tested image different from the production image.

### BAD — environment-specific values compiled into the bundle
```typescript
// environment.prod.ts
export const environment = {
  production: true,
  apiBaseUrl: 'https://api.prod.contoso.com',
  featureFlags: { newCheckout: true }
};
```
```dockerfile
# Dockerfile — builds a different image per environment; staging image != prod image
ARG BUILD_CONFIG=production
RUN npm run build -- --configuration=$BUILD_CONFIG
```

### GOOD — one image, environment-specific values resolved at container start
```typescript
// environment.ts — only build-time constants that never vary per deployment target
export const environment = {
  production: true
};
```
```dockerfile
# Dockerfile — a single image is built once and promoted dev -> staging -> prod
RUN npm run build -- --configuration=production
# config.json is NOT baked in; it is mounted/generated at container start (see Check B)
```

---

## Check B — Runtime config.json + APP_INITIALIZER (ARC-002)

### Detection
1. Search for a runtime-fetched `assets/config.json` (or equivalent) loaded before the app
   renders, via `APP_INITIALIZER` or, on Angular 19+, `provideAppInitializer()`.
2. If no such pattern exists and `apiBaseUrl`/feature flags are read only from the compiled
   `environment` object, flag ARC-002 — the app has no way to pick up per-environment values
   without a rebuild.
3. Confirm the initializer function returns/awaits the fetch so bootstrap blocks until config
   is available — a fire-and-forget fetch that isn't awaited defeats the pattern.

### BAD — no runtime config; everything from compiled environment.ts
```typescript
// api.service.ts
@Injectable({ providedIn: 'root' })
export class ApiService {
  private baseUrl = environment.apiBaseUrl; // fixed at build time, no runtime override
}
```

### GOOD — config.json fetched and awaited before bootstrap (Angular 19+)
```typescript
// app-config.service.ts
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private config = signal<RuntimeConfig | null>(null);

  async load(): Promise<void> {
    const response = await fetch('/assets/config.json');
    this.config.set(await response.json());
  }

  get(): RuntimeConfig {
    const value = this.config();
    if (!value) throw new Error('AppConfigService.load() must complete before use');
    return value;
  }
}
```
```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => inject(AppConfigService).load())
  ]
};
```
```json
// assets/config.json — mounted read-only at container start, not baked into the image
{
  "apiBaseUrl": "https://api.staging.contoso.com",
  "featureFlags": { "newCheckout": false }
}
```

---

## Check C — Availability for early-bootstrap consumers (ARC-003)

### Detection
1. Identify code that needs config *before* or *during* the same bootstrap phase as the
   `APP_INITIALIZER` fetch — most commonly an `HttpInterceptorFn` building a base URL, or a
   root-injected service constructed eagerly.
2. Confirm the config value is read synchronously from an already-populated signal/variable at
   the point of use, not from a `Promise` or `Observable` that may not have resolved yet.
3. Flag any interceptor or eagerly-instantiated provider that calls the async config fetch
   itself (a second, uncoordinated fetch) or reads a signal that may still be `null` at request
   time with no guard.

### BAD — interceptor races the initializer's fetch
```typescript
// base-url.interceptor.ts
export const baseUrlInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(AppConfigService);
  // config.get() throws if load() hasn't resolved yet — order is not guaranteed
  return next(req.clone({ url: `${config.get().apiBaseUrl}${req.url}` }));
};
```

### GOOD — APP_INITIALIZER guarantees config is populated before any HTTP request fires
```typescript
// app.config.ts — initializer runs to completion before providers depending on it are used
export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => inject(AppConfigService).load()),
    provideHttpClient(withInterceptors([baseUrlInterceptor]))
  ]
};
```
```typescript
// base-url.interceptor.ts — safe: by the time any component/service issues an HTTP
// request, provideAppInitializer's promise has already resolved
export const baseUrlInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(AppConfigService).get();
  return next(req.clone({ url: `${config.apiBaseUrl}${req.url}` }));
};
```

---

## Check D — Secrets must never appear in client-visible config (ARC-004)

### Detection
1. Inspect `config.json`/runtime-config-generation scripts for anything that is a secret:
   connection strings, API keys, signing secrets, third-party client secrets.
2. `config.json` is served to any browser that loads the SPA — treat every key in it as public.
   Only non-secret, environment-*shaped* values belong there (base URLs, public client IDs,
   feature-flag booleans, telemetry instrumentation keys that are already public by design).
3. Flag any secret-shaped value (regex for `key`, `secret`, `connectionString`, `password`,
   `token` combined with a non-placeholder-looking value) found in `config.json` or the script
   that generates it.

### BAD — API secret shipped to every browser
```json
// assets/config.json — visible via View Source / DevTools Network tab to any visitor
{
  "apiBaseUrl": "https://api.prod.contoso.com",
  "paymentGatewaySecretKey": "sk_live_51H8...",
  "featureFlags": { "newCheckout": true }
}
```

### GOOD — only non-secret values in the client config; secrets stay server-side
```json
// assets/config.json — safe to expose to any client
{
  "apiBaseUrl": "https://api.prod.contoso.com",
  "publicStripeKey": "pk_live_51H8...",
  "featureFlags": { "newCheckout": true }
}
```
```csharp
// .NET backend holds the secret key; the SPA never sees it, it only ever
// calls a backend endpoint that uses the secret server-side
builder.Services.Configure<PaymentOptions>(
    builder.Configuration.GetSection("Payments")); // secretKey lives in Key Vault / App Config
```

---

## Check E — Startup fallback when config is unreachable (ARC-005)

### Detection
1. Confirm the `AppConfigService.load()` fetch (or equivalent) has a `catch`/error path.
2. If the fetch fails (network error, 404, malformed JSON), the app must not silently continue
   bootstrapping with an undefined config object, nor hang indefinitely — it should render a
   clear "unable to start" error state or fall back to safe, documented defaults.
3. Flag a bare `fetch(...).then(...)` with no `.catch`/`try/catch`, and flag an initializer whose
   failure crashes the whole bootstrap with an unhandled promise rejection and a blank screen.

### BAD — unhandled fetch failure leaves a blank screen
```typescript
async load(): Promise<void> {
  const response = await fetch('/assets/config.json'); // throws on network failure — uncaught
  this.config.set(await response.json());
}
```

### GOOD — explicit fallback and user-visible error state
```typescript
async load(): Promise<void> {
  try {
    const response = await fetch('/assets/config.json');
    if (!response.ok) throw new Error(`config.json returned ${response.status}`);
    this.config.set(await response.json());
  } catch (err) {
    this.startupError.set(true); // read by AppComponent to render a startup-failure page
    console.error('Runtime config unavailable; application cannot start safely.', err);
  }
}
```
```html
<!-- app.component.html -->
@if (appConfig.startupError()) {
  <app-startup-error />
} @else {
  <router-outlet />
}
```

---

## Check F — Consistent precedence across deployment targets (ARC-006)

### Detection
1. When more than one config source exists (compiled `environment.ts` defaults, mounted
   `config.json`, and/or a reverse-proxy-injected `<meta>` tag or `window.__APP_CONFIG__`),
   confirm a single documented precedence order (e.g. runtime `config.json` overrides
   `environment.ts` defaults; a proxy-injected value overrides both).
2. Flag setups where different services in the same app resolve config from different sources
   with no shared merge point — e.g. one service reads `window.__APP_CONFIG__` directly while
   another reads `AppConfigService`, silently diverging if the two are ever out of sync.
3. Require all config reads to go through the single `AppConfigService` (or equivalent) that
   performs the merge once, in one documented order.

### BAD — two independent config sources with no defined precedence
```typescript
// feature-flags.service.ts — reads window global directly
const flags = (window as any).__APP_CONFIG__?.featureFlags ?? {};
```
```typescript
// api.service.ts — reads a different source (config.json via AppConfigService)
const baseUrl = inject(AppConfigService).get().apiBaseUrl;
```

### GOOD — single merge point with documented precedence
```typescript
// app-config.service.ts
async load(): Promise<void> {
  const defaults = { apiBaseUrl: environment.apiBaseUrl, featureFlags: {} };
  const runtime = await (await fetch('/assets/config.json')).json();
  // Precedence, documented once: environment.ts defaults < config.json < proxy-injected meta tag
  const proxyOverride = this.readMetaTagConfig();
  this.config.set({ ...defaults, ...runtime, ...proxyOverride });
}
```

---

## Runtime config checklist

- [ ] No environment-specific API URLs or feature flags compiled into `environment.ts`
- [ ] A single image is built once and promoted across environments (no per-environment build)
- [ ] `config.json` is fetched via `APP_INITIALIZER`/`provideAppInitializer` and blocks bootstrap until resolved
- [ ] Early-bootstrap consumers (interceptors, eager providers) read an already-populated config value, never a pending promise
- [ ] `config.json` contains only non-secret values — no keys, connection strings, or tokens
- [ ] Config fetch failure is caught and surfaces a clear startup-error state, not a blank screen
- [ ] All config reads go through one service with a single documented precedence order

---

## References

- Angular `APP_INITIALIZER`: https://angular.dev/api/core/APP_INITIALIZER
- Angular `provideAppInitializer`: https://angular.dev/api/core/provideAppInitializer
- Angular build configurations: https://angular.dev/tools/cli/environments
- Twelve-Factor App — Config: https://12factor.net/config
