---
name: azure-container-apps
description: Reviews the ACA / App Service compute host a .NET API lands on — the target azure-aks-governance's Kubernetes checks don't cover. Flags external ingress with no auth/IP restriction, secrets as plaintext env vars instead of secretRef/Key Vault references, minReplicas 0 on a latency-sensitive API or no maxReplicas cap, no liveness/readiness probe, no managed identity for registry pulls/backing calls, and containers with no CPU/memory limits. Outputs pilot-azure azure-container-apps standard IDs.
when_to_use: Azure Container Apps, ACA, App Service, container app ingress, external ingress, scale rules, minReplicas maxReplicas, KEDA scaling, revision mode, liveness readiness probe, containerapp managed identity, ACA secrets secretRef, scale to zero cold start, compute host governance, resource limits
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ACA-001 | P1 | External ingress (`external: true`) with no authentication (Easy Auth / JWT) or IP restriction |
| ACA-002 | P1 | Secrets injected as plaintext env `value` instead of `secretRef` / Key Vault references |
| ACA-003 | P2 | `minReplicas: 0` on a latency-sensitive API (cold start), or no `maxReplicas` cap (unbounded scale/cost) |
| ACA-004 | P2 | No liveness/readiness probe on the container — unhealthy revisions still take traffic |
| ACA-005 | P1 | No managed identity — registry pulls / backing-service calls use passwords or connection strings |
| ACA-006 | P3 | Container has no CPU/memory limits, or runs as root |

`azure-aks-governance` governs the Kubernetes compute target; this skill governs the
serverless-container target most .NET APIs in this stack actually deploy to (ACA / App
Service). Secret references resolve to `azure-keyvault-appconfig`; identity ties to
`azure-security-baseline` (ASB-IM-1); scale/probe reliability feeds `azure-slo-error-budget`.

---

## Check A — External ingress with no auth or IP restriction (ACA-001)

### Detection

For any Container App with `ingress.external: true`, check that access is constrained —
either platform authentication (Easy Auth / the app's own JWT validation per
`dotnet-authentication`) or an `ipSecurityRestrictions` allow-list. An externally-reachable
revision with neither is an open endpoint on the public internet.

### BAD — external ingress, anonymous, open to the world

```bicep
ingress: {
  external: true
  targetPort: 8080
  // No ipSecurityRestrictions, no auth in front — the API is publicly reachable by anyone.
}
```

### GOOD — external only behind the edge, or internal with restrictions

```bicep
ingress: {
  external: true
  targetPort: 8080
  ipSecurityRestrictions: [
    { name: 'front-door-only', ipAddressRange: 'AzureFrontDoor.Backend', action: 'Allow' }
  ]
  // Public traffic must arrive via the edge WAF (azure-edge-waf); direct hits are denied.
}
```

---

## Check B — Secrets as plaintext env vars (ACA-002)

### Detection

Scan container `env` entries for a literal `value` holding a connection string, key, or
token. Secrets belong in the app's `secrets` array (ideally a Key Vault reference) and are
surfaced to the container via `secretRef`, never as an inline environment value.

### BAD — connection string inlined as an env value

```bicep
env: [
  // Secret sits in plaintext in the template and in every deployment log.
  { name: 'ConnectionStrings__Sql', value: 'Server=sql;User Id=app;Password=<inline-plaintext>' }
]
```

### GOOD — Key Vault-backed secret surfaced via secretRef

```bicep
secrets: [
  { name: 'sql-conn', keyVaultUrl: kv.properties.vaultUri, identity: uami.id }
]
env: [
  { name: 'ConnectionStrings__Sql', secretRef: 'sql-conn' }
]
```

---

## Check C — Scale rules: cold-start floor / unbounded ceiling (ACA-003)

### Detection

Check `scale.minReplicas` and `scale.maxReplicas`. `minReplicas: 0` scales a
latency-sensitive API to zero, so the next request pays a cold start (the SLI
`azure-slo-error-budget` tracks). A missing/very high `maxReplicas` lets a traffic spike
scale cost without bound. Background/queue workers may legitimately scale to zero.

### BAD — a customer-facing API that cold-starts, with no ceiling

```bicep
scale: { minReplicas: 0 }   // p95 latency spikes on every scale-from-zero; no maxReplicas cap
```

### GOOD — a warm floor and an explicit ceiling

```bicep
scale: {
  minReplicas: 1
  maxReplicas: 10
  rules: [ { name: 'http', http: { metadata: { concurrentRequests: '50' } } } ]
}
```

---

## Check D — No health probe (ACA-004)

### Detection

Check the container for `probes` of type `Liveness` and `Readiness`. Without a readiness
probe, a revision receives traffic before it can serve it (and during shutdown); without
liveness, a wedged container is never restarted. Wire them to the endpoints
`dotnet-health-checks` exposes.

### GOOD — readiness and liveness wired to the health endpoints

```bicep
probes: [
  { type: 'Readiness', httpGet: { path: '/health/ready', port: 8080 } }
  { type: 'Liveness',  httpGet: { path: '/health/live',  port: 8080 } }
]
```

---

## Check E — No managed identity (ACA-005)

### Detection

Check that the app authenticates to ACR (image pulls) and to backing services (SQL,
Storage, Key Vault) via a managed identity, not registry passwords or connection-string
keys. A user-assigned identity with `AcrPull` + the data-plane roles it needs is the target.

### BAD — registry password in the template

```bicep
registries: [ { server: acr, username: 'admin', passwordSecretRef: 'acr-pw' } ]
```

### GOOD — managed identity for the pull and for data-plane access

```bicep
identity: { type: 'UserAssigned', userAssignedIdentities: { '${uami.id}': {} } }
registries: [ { server: acr, identity: uami.id } ]   // AcrPull granted to uami via RBAC
```

---

## Check F — No resource limits / root user (ACA-006)

### Detection

Check each container for CPU/memory `resources` and that the image does not run as root
(paired with `azure-container-image-security` IMG-002). Missing limits let one revision
starve the others on the shared environment; a root container widens blast radius.

### GOOD — explicit CPU/memory bounds

```bicep
resources: { cpu: json('0.5'), memory: '1Gi' }   // container image sets a non-root USER (IMG-002)
```
