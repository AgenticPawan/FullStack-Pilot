---
id: angular-no-innerhtml
title: No [innerHTML] Without DomSanitizer Justification
appliesTo: angular
severity: block
standard: OWASP-A03
---
Never bind user-controlled content to `[innerHTML]` without explicit `DomSanitizer.bypassSecurityTrustHtml` and a justification comment explaining why the content is safe. Use text bindings by default.

**BAD**
```html
<!-- XSS: Angular sanitizes but bypassSecurityTrustHtml can be misused -->
<div [innerHTML]="userContent"></div>
<div [innerHTML]="product.description"></div>
```

**GOOD**
```html
<!-- Option 1: Use text binding — always XSS-safe -->
<div>{{ userContent }}</div>

<!-- Option 2: HTML required — sanitize with justification comment -->
<div [innerHTML]="sanitizedContent"></div>
```
```typescript
// Only if the source is server-validated rich-text (e.g. CMS markdown-to-HTML):
// this.sanitizedContent = this.sanitizer.bypassSecurityTrustHtml(html);
// Source: CMS output — validated server-side, no user-supplied HTML allowed
```
