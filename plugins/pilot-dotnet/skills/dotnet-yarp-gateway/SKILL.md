---
name: dotnet-yarp-gateway
description: Governs self-hosted reverse-proxy gateways built with YARP (Yet Another Reverse Proxy). Covers tenant routing, header propagation, rate limits at the edge, observability wiring, and the decision boundary between YARP and Azure API Management or the Backend-for-Frontend pattern.
when_to_use: YARP, reverse proxy, gateway, proxy middleware, route config, cluster config, tenant routing, header forwarding, X-Forwarded-For, rate limit at edge, YARP transform, backend-for-frontend proxy, API aggregation gateway, load balancer, YARP health check
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| YARP-001 | P0 | YARP gateway forwards `Authorization` header verbatim to downstream services that perform their own authZ — token audience mismatch |
| YARP-002 | P0 | YARP is configured without authentication on an internet-facing route (anonymous pass-through) |
| YARP-003 | P1 | `X-Forwarded-For` / `X-Real-IP` not propagated or overridden before forwarding — downstream services see gateway IP |
| YARP-004 | P1 | No rate limiting configured on the YARP pipeline for user-facing routes |
| YARP-005 | P1 | No per-tenant routing logic — all tenants share the same downstream cluster without isolation |
| YARP-006 | P2 | YARP health checks not wired for downstream clusters — dead backends receive traffic |
| YARP-007 | P2 | YARP observability not wired (`AddOpenTelemetryMetrics`/`AddProxyTelemetry` absent) — latency and error rate not visible |
| YARP-008 | P2 | Gateway used for logic that belongs in a BFF — aggregating responses from multiple backends into one JSON response |

---

## Check A — Authentication and header forwarding

YARP can authenticate at the edge (validate the token, then forward) OR pass-through
(let downstream validate). Never do both inconsistently.

**Choose one model and enforce it project-wide:**

### Edge-validates (preferred for external callers)

```csharp
// Program.cs
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o => { o.Authority = "https://login.microsoftonline.com/<tenant>"; });

app.UseAuthentication();
app.UseAuthorization();
app.MapReverseProxy(proxyPipeline => {
    proxyPipeline.UseProxyErrorHandler();
    // Do NOT forward the raw Bearer token to downstream services that re-validate it
    // with a different audience. Strip it and inject a service-to-service token instead.
});
```

YARP-001 fires when the YARP config forwards `Authorization` to a downstream service
whose `appsettings.json` also has a `JwtBearerOptions` block with a different `Audience`.

### Pass-through (internal mesh only)

Acceptable when all services are behind a private VNet and mutual TLS handles
authentication at the network layer. Document the choice in an ADR.

---

## Check B — Tenant routing

For multi-tenant applications, route at the edge so tenants never reach each other's
downstream clusters.

```json
// yarp.json — route per tenant subdomain
{
  "Routes": {
    "tenant-a-route": {
      "ClusterId": "tenant-a-cluster",
      "Match": { "Hosts": ["tenant-a.example.com"] }
    },
    "tenant-b-route": {
      "ClusterId": "tenant-b-cluster",
      "Match": { "Hosts": ["tenant-b.example.com"] }
    }
  }
}
```

Alternative (header-based): use a custom YARP transform to read a `X-Tenant-Id` header
and select the downstream cluster dynamically.

YARP-005 fires when all routes share a single cluster and there is no tenant-scoping
transform in the pipeline.

---

## Check C — Rate limiting at the edge

Wire ASP.NET Core rate limiting **before** YARP's proxy middleware:

```csharp
builder.Services.AddRateLimiter(o =>
    o.AddFixedWindowLimiter("api", w => {
        w.PermitLimit = 200;
        w.Window = TimeSpan.FromMinutes(1);
        w.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        w.QueueLimit = 0;
    }));

app.UseRateLimiter();
app.MapReverseProxy().RequireRateLimiting("api");
```

For per-caller rate limiting, partition by JWT `sub` or `X-Tenant-Id` claim.
Cross-reference: `dotnet-rate-limiting`.

---

## Check D — Observability

```csharp
builder.Services.AddOpenTelemetry()
    .WithMetrics(m => m.AddAspNetCoreInstrumentation()
                        .AddHttpClientInstrumentation()
                        .AddProxyTelemetry());   // YARP-specific metric
```

Key YARP metrics: `yarp_proxy_requests_duration`, `yarp_proxy_requests_failures`.
Alert on: P99 > 500ms, failure rate > 1%.

Cross-reference: `dotnet-observability`, `azure-observability`.

---

## Check E — YARP vs APIM vs BFF decision boundary

| Concern | YARP | Azure API Management | Backend-for-Frontend |
|---------|------|---------------------|----------------------|
| Self-hosted, code-controlled routing | ✅ | ❌ | ✅ |
| Enterprise API catalogue / developer portal | ❌ | ✅ | ❌ |
| Response aggregation (multiple backends → one response) | ❌ (YARP-008) | ⚠️ policy templates | ✅ purpose |
| External rate limiting SLA / monetisation | ❌ | ✅ | ❌ |
| Simple TLS termination + tenant routing | ✅ | overkill | overkill |

YARP-008 fires when a YARP transform accumulates data from more than one cluster and
merges it into the response — that is BFF work; move it to `dotnet-backend-for-frontend`.

Cross-reference: `azure-api-management`, `dotnet-backend-for-frontend`.
