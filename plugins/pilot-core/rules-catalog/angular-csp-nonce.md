---
id: angular-csp-nonce
title: Nonce-Based CSP, Never unsafe-inline (Angular 16+)
appliesTo: angular>=16
severity: warn
standard: InternalPolicy
---
Content-Security-Policy headers must not use `unsafe-inline`. Generate a per-request nonce server-side, set it on the Angular root element via `ngCspNonce`, and let Angular's `CSP_NONCE` token apply it automatically to framework-generated inline styles.

**BAD**
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
```

**GOOD**
```html
<!-- index.html — nonce written by the .NET view/Razor page -->
<app-root ngCspNonce="@ViewData["csp-nonce"]"></app-root>
```
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{nonce}'; style-src 'self' 'nonce-{nonce}';
```
