---
id: angular-csrf-dotnet
title: XSRF Cookie/Header Names Must Match .NET AntiforgeryOptions
appliesTo: angular
severity: warn
standard: InternalPolicy
---
`withXsrfConfiguration()` cookie and header names must match the .NET backend's `AntiforgeryOptions` exactly, or `HttpClient`'s automatic XSRF-TOKEN → X-XSRF-TOKEN handshake silently fails closed. `withNoXsrfProtection()` must never be used except against a genuinely public, read-only endpoint.

**BAD**
```typescript
// Disables CSRF completely — requires explicit justification, and none is given
provideHttpClient(withNoXsrfProtection())
```

**GOOD**
```typescript
// app.config.ts
provideHttpClient(
  withXsrfConfiguration({
    cookieName: 'XSRF-TOKEN',   // must match .NET AntiforgeryOptions.Cookie.Name
    headerName: 'X-XSRF-TOKEN', // must match .NET AntiforgeryOptions.HeaderName
  })
)
```
