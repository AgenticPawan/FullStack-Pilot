---
name: azure-edge-waf
description: Reviews the edge tier fronting an Angular SPA + public API — Azure Front Door or App Gateway with a Web Application Firewall (WAF) policy. The edge network firewall, NOT azure-waf-review (which is the Well-Architected Framework review). Flags a public API/SPA with no edge WAF, a policy left in Detection mode never switched to Prevention, no managed OWASP rule set, no edge rate limit, the origin reachable directly bypassing the edge, and TLS below 1.2 or no HTTPS redirect. Outputs pilot-azure azure-edge-waf standard IDs.
when_to_use: Azure Front Door, Application Gateway, Web Application Firewall, WAF policy, edge security, OWASP core rule set, Detection Prevention mode, edge rate limiting, L7 DDoS, TLS 1.2 HTTPS redirect, origin lockdown, private origin, SPA edge CDN, bot protection, geo filtering
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| AFW-001 | P1 | Public API/SPA served with no edge WAF (Front Door or App Gateway WAF policy) in front |
| AFW-002 | P1 | WAF policy left in `Detection` mode — never switched to `Prevention`, so nothing is blocked |
| AFW-003 | P2 | No managed OWASP / Microsoft default rule set attached to the WAF policy |
| AFW-004 | P2 | No per-client rate-limit rule at the edge — L7 flooding / scraping exposure |
| AFW-005 | P1 | Origin (ACA / App Service) reachable directly, bypassing the edge — the WAF is optional, not enforced |
| AFW-006 | P3 | TLS below 1.2 at the edge, or no HTTP→HTTPS redirect |

**Name collision, read this:** `azure-waf-review` is the **Well-Architected Framework**
(reliability/security/cost/ops/performance) review and emits `WAF-*` IDs. *This* skill is
the **Web Application Firewall** at the edge and emits `AFW-*` IDs. They are unrelated. Origin
lockdown (AFW-005) pairs with `azure-container-apps` ACA-001 ingress restriction; edge rate
limiting complements `dotnet-rate-limiting` at the app tier.

---

## Check A — No edge WAF in front of a public app (AFW-001)

### Detection

For a public-facing SPA/API, check that traffic enters through Azure Front Door or an
Application Gateway carrying an attached `Microsoft.Network/FrontDoorWebApplicationFirewallPolicies`
(or App Gateway `firewallPolicy`). A public origin with no WAF has no L7 filtering,
rate limiting, or managed rule coverage at all.

### BAD — App Service published straight to the internet, no WAF

```bicep
// The Angular SPA + API are reachable directly on *.azurewebsites.net.
// No Front Door, no Application Gateway, no WAF policy anywhere in the template.
```

### GOOD — Front Door with an attached WAF policy fronting the origin

```bicep
resource wafPolicy 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2024-02-01' = {
  name: 'afd-waf-prod'
  properties: {
    policySettings: { enabledState: 'Enabled', mode: 'Prevention' }
    managedRules: { managedRuleSets: [ { ruleSetType: 'Microsoft_DefaultRuleSet', ruleSetVersion: '2.1' } ] }
  }
}
// Front Door security policy associates wafPolicy with the endpoint fronting the app.
```

---

## Check B — WAF stuck in Detection mode (AFW-002)

### Detection

Check `policySettings.mode`. `Detection` only logs matches — it blocks nothing. A policy
that never graduates to `Prevention` gives the appearance of protection while every
malicious request still reaches the origin. Detection is a tuning phase, not a resting state.

### BAD — mode never changed from the safe-to-deploy default

```bicep
policySettings: { enabledState: 'Enabled', mode: 'Detection' }   // logs attacks, blocks none
```

### GOOD — Prevention after a bounded tuning window

```bicep
policySettings: { enabledState: 'Enabled', mode: 'Prevention' }  // matched rules actually block
```

---

## Check C — No managed rule set (AFW-003)

### Detection

Check `managedRules.managedRuleSets` for a Microsoft/OWASP managed rule set. A WAF policy
with only a handful of hand-written custom rules and no managed set has no coverage for the
OWASP Top 10 classes the managed rules maintain.

### GOOD — the current default managed rule set is attached

```bicep
managedRules: {
  managedRuleSets: [ { ruleSetType: 'Microsoft_DefaultRuleSet', ruleSetVersion: '2.1' } ]
}
```

---

## Check D — No per-client rate limiting at the edge (AFW-004)

### Detection

Check for a `RateLimitRule` in the WAF policy custom rules. The edge is where volumetric
L7 abuse (credential stuffing, scraping, cheap DDoS) should be shed before it ever reaches
the origin — the app-tier limiter (`dotnet-rate-limiting`) is the second line, not the first.

### GOOD — a rate-limit custom rule keyed by client IP

```bicep
customRules: [
  {
    name: 'perClientRateLimit'
    ruleType: 'RateLimitRule'
    rateLimitThreshold: 1000
    rateLimitDurationInMinutes: 1
    action: 'Block'
    matchConditions: [ /* client IP */ ]
  }
]
```

---

## Check E — Origin reachable bypassing the edge (AFW-005)

### Detection

A WAF is only enforced if the origin cannot be reached directly. Check that the origin
(ACA/App Service) restricts inbound to the Front Door / App Gateway — via the
`AzureFrontDoor.Backend` service tag plus the `X-Azure-FDID` header check, an
`ipSecurityRestrictions` allow-list, or Private Link. An origin on a public hostname with
no restriction lets an attacker skip the WAF entirely by hitting it directly.

### GOOD — origin locked to the edge

```bicep
// App Service / ACA ingress restricted to AzureFrontDoor.Backend and validating the
// Front Door id header, so *.azurewebsites.net direct hits are refused. See ACA-001.
```

---

## Check F — Weak TLS / no HTTPS redirect (AFW-006)

### Detection

Check `minimumTlsVersion` (>= 1.2) and that HTTP requests redirect to HTTPS at the edge
rather than being served or dropped. Plaintext HTTP at the edge exposes tokens and cookies
in transit.

### GOOD — TLS 1.2 minimum with an HTTP→HTTPS redirect route rule

```bicep
// Front Door route: httpsRedirect: 'Enabled'; custom domain TLS minimumTlsVersion: 'TLS12'.
```
