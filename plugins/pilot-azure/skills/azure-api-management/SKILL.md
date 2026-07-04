---
name: azure-api-management
description: Reviews Azure API Management gateway-layer policies — a distinct layer from dotnet-rate-limiting's app-layer checks. Flags no rate-limit/quota policy at the gateway, JWT validation duplicated or missing at the gateway when the backend already validates tokens, backend health/circuit-breaker not configured for APIM's own backend pool, and request/response transformation logic that duplicates backend validation instead of being a thin pass-through. Outputs findings with pilot-azure api-management standard IDs.
when_to_use: API Management, APIM policy, rate-limit-by-key, validate-jwt policy, backend pool, APIM circuit breaker, request transformation, APIM named values, gateway policy XML
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| APIM-001 | P1 | No rate-limit/quota policy configured at the gateway |
| APIM-002 | P1 | JWT validation missing at the gateway, or duplicated inconsistently with the backend |
| APIM-003 | P2 | No backend health monitoring/circuit-breaker configured for the backend pool |
| APIM-004 | P2 | Gateway policy duplicates backend business validation instead of staying a thin pass-through |

APIM sits in front of the app-layer checks `dotnet-rate-limiting` already covers — this
skill governs the gateway policy layer, not a replacement for the app-layer defense-in-depth.

---

## Check A — No rate-limit/quota policy at the gateway (APIM-001)

### Detection

Check the API's policy XML for a `<rate-limit-by-key>`/`<quota-by-key>` element. Gateway-
level rate limiting protects the backend from traffic that never even reaches the app
layer's own `AddRateLimiter` baseline (`dotnet-rate-limiting` RL-003) — without it, a
traffic spike still fully lands on the backend before the app-layer limiter engages.

### BAD — no gateway-level throttling, everything reaches the backend first

```xml
<policies>
  <inbound>
    <base />
    <!-- No rate-limit-by-key — every request reaches the backend regardless of volume. -->
  </inbound>
</policies>
```

### GOOD — gateway-level rate limit per subscription key, backend's own limiter as defense-in-depth

```xml
<policies>
  <inbound>
    <base />
    <rate-limit-by-key calls="100" renewal-period="60"
      counter-key="@(context.Subscription.Id)" />
  </inbound>
</policies>
```

---

## Check B — JWT validation missing or inconsistent with the backend (APIM-002)

### Detection

Check whether the API's policy XML includes `<validate-jwt>` matching the same issuer/
audience the backend's `AddAuthentication().AddJwtBearer(...)` validates
(`dotnet-authorization`). Two independent, potentially drifting validation
configurations (gateway trusts one issuer, backend trusts another) is worse than a
single source of truth — pick one layer as authoritative and keep the other consistent
with it, or omit gateway-level validation and rely on the backend exclusively.

### BAD — gateway validates against a different/stale configuration than the backend

```xml
<validate-jwt header-name="Authorization">
  <openid-config url="https://login.microsoftonline.com/OLD-TENANT-ID/.well-known/openid-configuration" />
  <!-- Backend's Program.cs points at a different tenant/audience — these can silently drift apart. -->
</validate-jwt>
```

### GOOD — gateway and backend validate against the same, single source of configuration

```xml
<validate-jwt header-name="Authorization">
  <openid-config url="{{tenant-openid-config-url}}" /> <!-- named value, same source the backend's config references -->
  <audiences><audience>{{api-audience}}</audience></audiences>
</validate-jwt>
```

---

## Check C — No backend health monitoring/circuit-breaker (APIM-003)

### Detection

Check the backend pool configuration for `circuitBreaker`/health-probe settings. Without
one, APIM keeps routing traffic to an unhealthy backend instance instead of failing over
or shedding load — the gateway-layer equivalent of `dotnet-resilience`'s circuit-breaker
guidance, but for APIM's own view of the backend rather than the backend's own outbound calls.

### BAD — backend pool with no health monitoring

```json
{
  "properties": {
    "protocol": "http",
    "url": "https://orders-api.internal"
    // No circuitBreaker/healthCheck configuration.
  }
}
```

### GOOD — circuit breaker trips on sustained backend failures

```json
{
  "properties": {
    "protocol": "http",
    "url": "https://orders-api.internal",
    "circuitBreaker": {
      "rules": [{
        "failureCondition": { "count": 3, "interval": "PT1M", "statusCodeRanges": [{ "min": 500, "max": 599 }] },
        "tripDuration": "PT1M"
      }]
    }
  }
}
```

---

## Check D — Gateway policy duplicates backend business validation (APIM-004)

### Detection

Check policy XML for business-rule validation (checking a request body field against a
business constraint, not just shape/auth) that duplicates logic the backend's
`dotnet-validation` layer already owns. APIM policies should stay a thin
routing/auth/rate-limit layer — pushing business rules into policy XML means two places
implement the same rule with no shared source of truth and no unit-test coverage for the
policy-XML copy.

### BAD — business rule duplicated in policy XML

```xml
<choose>
  <when condition="@(int.Parse(context.Request.Body.As<JObject>()["quantity"].ToString()) > 100)">
    <return-response><set-status code="400" /></return-response>
    <!-- Same "max quantity 100" rule the backend's FluentValidation validator (dotnet-validation) already enforces. -->
  </when>
</choose>
```

### GOOD — gateway stays a thin pass-through, backend owns the one validation rule

```xml
<policies>
  <inbound>
    <base />
    <validate-jwt .../>
    <rate-limit-by-key .../>
    <!-- No business-rule validation here — that's dotnet-validation's job on the backend. -->
  </inbound>
</policies>
```
