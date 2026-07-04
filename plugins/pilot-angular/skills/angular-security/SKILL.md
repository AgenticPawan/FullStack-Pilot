---
name: angular-security
description: Angular security hardening: XSS via template binding hygiene, DomSanitizer bypass policy, nonce-based CSP (no unsafe-inline), Trusted Types (v17+ built-in policies), and CSRF token handling with .NET backend via HttpClientXsrfModule. References OWASP A03 and Angular security guide.
when_to_use: XSS, innerHTML, DomSanitizer, CSP, Content Security Policy, Trusted Types, CSRF, cross-site scripting, sanitization, security audit, nonce, unsafe-inline, XSRF token, bypassSecurityTrust, security review
applies_to: angular
---

<!-- Version index:
  DomSanitizer            all Angular versions
  CSP_NONCE token         Angular 16+
  autoCsp option          Angular 17+
  Trusted Types policies  Angular 17+ (5 built-in policies)
  Trusted Types stable    Angular 17+
  withXsrfConfiguration() Angular 15+ (provideHttpClient functional API)
-->

## Rule reference

| ID | Standard | Severity |
|----|----------|----------|
| angular-no-innerhtml | OWASP A03 | block |
| angular-no-bypass-without-comment | OWASP A03 | block |
| angular-csp-nonce | InternalPolicy | warn |
| angular-trusted-types | InternalPolicy | warn |
| angular-csrf-dotnet | InternalPolicy | warn |

---

## XSS — template binding hygiene

Angular escapes `{{ interpolation }}` and `[textContent]` bindings automatically. The danger surface is:

- `[innerHTML]` — Angular sanitizes but `bypassSecurityTrustHtml` disables sanitization entirely
- Dynamic `<script>` injection via `Renderer2.createElement`
- `[style]` / `[src]` / `[href]` with user-controlled values

### BAD — innerHTML with untrusted content

```html
<!-- OWASP A03: Angular sanitizes here, but the pattern invites bypass misuse -->
<div [innerHTML]="user.bio"></div>
<div [innerHTML]="product.description"></div>
```

```typescript
// CRITICAL: disables ALL sanitization for this value
this.content = this.sanitizer.bypassSecurityTrustHtml(apiResponse.html);
```

### GOOD — text binding (always safe); HTML only with justification

```html
<!-- Option 1: text binding — zero XSS risk -->
<p>{{ user.bio }}</p>

<!-- Option 2: HTML required — sanitized value with justification comment -->
<div [innerHTML]="sanitizedBio"></div>
```

```typescript
// Acceptable ONLY when source is server-validated rich text (e.g. CMS output).
// Source: CMS markdown-to-HTML pipeline — no user-supplied HTML is accepted.
this.sanitizedBio = this.sanitizer.bypassSecurityTrustHtml(cms.html);
```

**Rule:** every call to any `bypassSecurityTrust*` method MUST have a comment on the
preceding line explaining the trusted source. PR reviewers MUST reject uncommented bypasses.

---

## Content Security Policy — nonce-based (Angular 16+)

Do not use `unsafe-inline`. Use per-request nonces generated server-side.

### BAD — unsafe-inline in CSP header

```
# .NET backend response header — DO NOT USE
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
```

### GOOD — nonce-based CSP end-to-end

**Step 1 — .NET backend generates a nonce per request:**

```csharp
// Program.cs / middleware
app.Use(async (ctx, next) =>
{
    var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
    ctx.Items["csp-nonce"] = nonce;
    ctx.Response.Headers.Append(
        "Content-Security-Policy",
        $"default-src 'self'; script-src 'self' 'nonce-{nonce}'; style-src 'self' 'nonce-{nonce}';"
    );
    await next();
});
```

**Step 2 — Inject nonce into the Angular root element:**

```html
<!-- index.html — nonce written by the .NET view/Razor page -->
<app-root ngCspNonce="@ViewData["csp-nonce"]"></app-root>
```

**Step 3 — Angular reads the nonce automatically** via the `CSP_NONCE` token (Angular 16+).
No further configuration is required — Angular applies the nonce to all inline styles it generates.

**Optional (Angular 17+): enable autoCsp in angular.json:**
```json
{
  "architect": {
    "build": {
      "options": {
        "security": { "autoCsp": true }
      }
    }
  }
}
```

---

## Trusted Types (Angular 17+)

Angular ships five built-in Trusted Types policies:

| Policy | Used by |
|--------|---------|
| `angular` | Core framework DOM operations |
| `angular#bundler` | Lazy-loaded chunk injection |
| `angular#unsafe-bypass` | `DomSanitizer.bypassSecurityTrust*` calls |
| `angular#unsafe-jit` | JIT compiler (dev only — disable in production) |
| `angular#unsafe-upgrade` | `@angular/upgrade` hybrid apps |

**Enable Trusted Types in CSP:**

```
Content-Security-Policy:
  require-trusted-types-for 'script';
  trusted-types angular angular#bundler;
```

Remove `angular#unsafe-bypass` from the policy to enforce that no bypass calls reach the DOM.
Remove `angular#unsafe-jit` in production (JIT should not run in production builds).

### BAD — Trusted Types policy omitted

```
# Allows any string as DOM sink — Trusted Types enforcement inactive
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-...';
```

### GOOD — full Trusted Types enforcement

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{nonce}';
  style-src 'self' 'nonce-{nonce}';
  require-trusted-types-for 'script';
  trusted-types angular angular#bundler;
```

---

## CSRF — .NET backend integration

`HttpClient` sends the XSRF-TOKEN cookie value as the `X-XSRF-TOKEN` request header on
all state-changing methods (POST, PUT, PATCH, DELETE) automatically.

### BAD — custom token header names that break CSRF protection

```typescript
// withNoXsrfProtection() disables CSRF completely — requires explicit justification
provideHttpClient(withNoXsrfProtection())
```

### GOOD — coordinate cookie/header names with .NET antiforgery options

```typescript
// app.config.ts — Angular side
export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(
      withXsrfConfiguration({
        cookieName: 'XSRF-TOKEN',    // must match .NET AntiforgeryOptions.Cookie.Name
        headerName: 'X-XSRF-TOKEN'  // must match .NET AntiforgeryOptions.HeaderName
      })
    )
  ]
};
```

```csharp
// Program.cs — .NET side
builder.Services.AddAntiforgery(opts =>
{
    opts.Cookie.Name  = "XSRF-TOKEN";
    opts.HeaderName   = "X-XSRF-TOKEN";
    opts.Cookie.SameSite = SameSiteMode.Strict;
    opts.Cookie.SecurePolicy = CookieSecurePolicy.Always;
});
```

---

## Angular security checklist

- [ ] No `bypassSecurityTrust*` calls without a preceding source-justification comment
- [ ] No `unsafe-inline` in CSP headers — use nonces (Angular 16+)
- [ ] `ngCspNonce` set on root element from server-generated per-request nonce
- [ ] `require-trusted-types-for 'script'` in CSP (Angular 17+)
- [ ] `angular#unsafe-jit` excluded from `trusted-types` in production builds
- [ ] `withXsrfConfiguration()` cookie/header names match .NET `AntiforgeryOptions`
- [ ] `withNoXsrfProtection()` is not used unless the endpoint is a public read-only API
- [ ] Dynamic route parameters are never interpolated into `[innerHTML]`
- [ ] `[src]` and `[href]` bindings with user content go through `bypassSecurityTrustUrl` with justification

---

## References

- Angular security guide: https://angular.dev/best-practices/security
- OWASP A03:2021 Injection: https://owasp.org/Top10/A03_2021-Injection/
- W3C Trusted Types: https://w3c.github.io/trusted-types/dist/spec/
- .NET Antiforgery: https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery
