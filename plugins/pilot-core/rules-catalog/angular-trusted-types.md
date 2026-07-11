---
id: angular-trusted-types
title: Trusted Types Enforced in Production (Angular 17+)
appliesTo: angular>=17
severity: warn
standard: InternalPolicy
---
Production CSP must include `require-trusted-types-for 'script'` with an explicit `trusted-types` allow-list. `angular#unsafe-jit` (the JIT compiler policy) must never appear in a production policy, and `angular#unsafe-bypass` should only remain if the app genuinely still calls `DomSanitizer.bypassSecurityTrust*`.

**BAD**
```
# Allows any string as a DOM sink — Trusted Types enforcement inactive
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-...';
```

**GOOD**
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{nonce}';
  require-trusted-types-for 'script';
  trusted-types angular angular#bundler;
```
