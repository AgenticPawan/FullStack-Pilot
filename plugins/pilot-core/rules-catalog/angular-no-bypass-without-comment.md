---
id: angular-no-bypass-without-comment
title: No Uncommented DomSanitizer bypassSecurityTrust* Calls
appliesTo: angular
severity: block
standard: OWASP-A03
---
Every call to any `DomSanitizer.bypassSecurityTrust*` method (`bypassSecurityTrustHtml`, `bypassSecurityTrustUrl`, `bypassSecurityTrustResourceUrl`, `bypassSecurityTrustScript`, `bypassSecurityTrustStyle`) MUST have a comment on the preceding line naming the trusted source and why it is safe. An uncommented bypass disables Angular's XSS sanitization with no reviewable justification.

**BAD**
```typescript
this.content = this.sanitizer.bypassSecurityTrustHtml(apiResponse.html);
```

**GOOD**
```typescript
// Acceptable ONLY when source is server-validated rich text (e.g. CMS output).
// Source: CMS markdown-to-HTML pipeline — no user-supplied HTML is accepted.
this.sanitizedBio = this.sanitizer.bypassSecurityTrustHtml(cms.html);
```
