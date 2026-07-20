---
id: angular-zoneless-bootstrap
title: Angular — Zoneless Provider Must Not Co-exist with zone.js Import
appliesTo: angular
severity: warn
standard: InternalPolicy
---

When `provideZonelessChangeDetection()` (Angular 18+) or
`provideExperimentalZonelessChangeDetection()` (Angular 17.1+) is present in the
bootstrap providers, `zone.js` MUST NOT appear in the `polyfills` array of `angular.json`.
Co-existing will not cause an immediate error, but zone.js will still patch browser APIs and
add ~30 KB, defeating the purpose of the migration and making CD behavior unpredictable.

**BAD**
```json
// angular.json — zone.js left in polyfills
"polyfills": ["zone.js"]
```
```typescript
// main.ts
providers: [provideExperimentalZonelessChangeDetection()]
```

**GOOD**
```json
// angular.json
"polyfills": []  // remove zone.js entirely
```
```typescript
// main.ts
providers: [provideZonelessChangeDetection()]
```

Also remove `zone.js` from `package.json` `dependencies` once no other polyfill or
third-party library requires it directly.
