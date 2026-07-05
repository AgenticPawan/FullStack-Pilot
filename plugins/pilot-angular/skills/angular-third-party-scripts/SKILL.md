---
name: angular-third-party-scripts
description: Reviews third-party script governance — CDN-loaded scripts, analytics/chat-widget tags — that angular-security's CSP work doesn't fully close on its own. Flags a CDN-loaded script with no Subresource Integrity (SRI) hash, a third-party tag added with no documented allow-list/review process, a third-party script granted broader CSP allowances than it needs, and no monitoring for a third-party script's behavior changing after initial approval. Outputs findings with pilot-angular third-party-scripts standard IDs.
when_to_use: Subresource Integrity, SRI hash, CDN script, third-party script, analytics tag, chat widget, tag manager, third-party script review, CSP script-src, script supply chain
applies_to: angular>=17
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| TPS-001 | P0 | CDN-loaded script has no Subresource Integrity (SRI) hash |
| TPS-002 | P1 | Third-party tag added with no documented allow-list/review process |
| TPS-003 | P2 | Third-party script granted broader CSP allowances than it needs |
| TPS-004 | P2 | No monitoring for a third-party script's behavior changing after approval |

`angular-security`'s CSP/nonce work (ATH/CSP checks) governs what the *application's own*
code is allowed to do. This skill governs a different trust boundary — code the
application doesn't control at all, loaded from someone else's CDN, which is a supply-
chain risk closer in spirit to `dependency-supply-chain` than to XSS prevention.

---

## Check A — CDN script with no SRI hash (TPS-001)

### Detection

Grep `index.html`/dynamically-injected `<script src="https://...">` tags pointing at an
external CDN for a missing `integrity`/`crossorigin` attribute pair. Without SRI, if the
CDN is compromised or serves a modified file (a supply-chain attack, or simply an
unannounced breaking change), the browser executes whatever the CDN returns with no
verification — the exact scenario SRI exists to prevent.

### BAD — CDN script with no integrity check

```html
<script src="https://cdn.example.com/analytics.js"></script>
<!-- If this CDN is compromised, the browser executes whatever it now serves, unverified. -->
```

### GOOD — SRI hash pins the exact expected file content

```html
<script
  src="https://cdn.example.com/analytics.js"
  integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"
  crossorigin="anonymous">
</script>
<!-- Browser refuses to execute the script if its content doesn't match this hash. -->
```

For a script loaded dynamically (Angular's `Renderer2.createElement`), set the same
`integrity`/`crossorigin` attributes programmatically before appending the element.

---

## Check B — No documented allow-list/review process (TPS-002)

### Detection

Check for a documented process governing which third-party scripts/tags are permitted at
all — without one, a new analytics pixel or chat widget gets added by whoever wants it,
with no security review of what data it can access or what it's permitted to do on the
page (read cookies, make network calls, access the DOM).

### BAD — no review process, tags added ad-hoc by any team

```html
<!-- Added by marketing last sprint with no security review: -->
<script src="https://random-widget-vendor.com/embed.js"></script>
```

### GOOD — a documented allow-list, new additions require review

```markdown
<!-- docs/THIRD-PARTY-SCRIPTS.md -->
**Approved:** Application Insights JS SDK (angular-telemetry), Stripe.js (payment iframe,
sandboxed, no page-wide script access).
**Requires security review before adding:** any new analytics/chat/marketing tag —
submit via the standard change-request process; review covers what data the script can
read (cookies, localStorage, DOM) and what CSP allowance it needs (Check C).
```

---

## Check C — Third-party script granted broader CSP allowances than needed (TPS-003)

### Detection

Check the CSP `script-src`/`connect-src`/`img-src` directives for a wildcard or overly
broad allowance added specifically to accommodate one third-party script, versus a
scoped allowance covering only that script's actual required origins — a wildcard
granted for one vendor's convenience weakens the CSP protection `angular-security`
established for the entire application, not just that one integration.

### BAD — wildcard CSP allowance added to accommodate one vendor

```
Content-Security-Policy: script-src 'self' https://*.vendor-cdn.com *;
<!-- The trailing "*" was added to unblock one chat widget and now allows scripts from anywhere. -->
```

### GOOD — scoped allowance, only the specific origins the script needs

```
Content-Security-Policy: script-src 'self' 'nonce-{nonce}' https://cdn.example.com;
connect-src 'self' https://api.example-chat-vendor.com;
```

---

## Check D — No monitoring for third-party script behavior drift (TPS-004, advisory)

### Detection

Check whether an approved third-party script's actual behavior (network calls it makes,
DOM elements it injects) is monitored for unexpected change over time — a script
approved once under a given SRI hash (Check A) is safe until the vendor pushes an update
requiring a new hash; the update process itself (who re-approves the new hash, and
re-reviews what changed) is the gap this check covers.

### BAD — SRI hash pinned once, never revisited, updates silently break or get force-updated with no re-review

```
<!-- The analytics vendor pushed a major update 6 months ago. Someone just updated the
     SRI hash to unblock the broken integration, with no review of what else changed
     in the new version. -->
```

### GOOD — a documented re-approval step tied to any SRI hash change

```markdown
<!-- docs/THIRD-PARTY-SCRIPTS.md -->
Any change to a pinned SRI hash requires the same security review as adding a new
script (Check B) — a hash bump is treated as "a different script," not a routine update.
```
