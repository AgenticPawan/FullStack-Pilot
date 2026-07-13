---
name: azure-signalr-scaleout
description: Reviews the Azure infrastructure that scales real-time SignalR — the provisioning side dotnet-realtime RT-002 assumes. Flags a multi-replica app hosting SignalR with no Azure SignalR Service or Redis backplane resource, Default/Serverless service-mode mismatch, the service wired by access key instead of managed identity, fixed capacity with no autoscale (or a free-tier SKU in production), and a SignalR Service reachable publicly with no private endpoint. Outputs pilot-azure standard IDs (SRS-*).
when_to_use: Azure SignalR Service, SignalR scale-out, real-time backplane Bicep, signalr serverless mode, upstream endpoint, Web PubSub, Redis backplane ACA, SignalR unit capacity autoscale, SignalR managed identity, SignalR private endpoint, WebSocket scaling Azure, multi-replica SignalR broadcast
---

## Purpose

`dotnet-realtime` (RT-002) checks the **application** calls `.AddAzureSignalR(...)` or a Redis
backplane. This skill checks the **infrastructure** that call depends on actually exists, is
sized, secured, and reachable. A SignalR app scaled to `minReplicas > 1` with no backplane
resource provisioned drops a fraction of every broadcast — the failure is invisible in a
single-instance dev environment and only appears under production scale-out. Review the Bicep
and the Container Apps / AKS scaling config together.

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| SRS-001 | P1 | App scaled to >1 replica hosts SignalR but no Azure SignalR Service (or Redis) backplane resource is provisioned in the infra |
| SRS-002 | P2 | Service-mode mismatch — `Serverless` mode with no upstream endpoints, or `Default` mode expected by a persistent-hub app but provisioned as `Serverless` |
| SRS-003 | P2 | SignalR Service connected via connection string / access key instead of managed identity + RBAC |
| SRS-004 | P2 | Fixed `capacity` (unit count) with no autoscale, or a `Free_F1` SKU on a production workload (20-connection cap) |
| SRS-005 | P3 | SignalR Service `publicNetworkAccess: 'Enabled'` with no private endpoint / network ACL |

---

## Check A — No backplane resource for a scaled-out app (SRS-001)

### Detection

If the compute resource sets `scale: { minReplicas: >1 }` (Container Apps) or a Deployment
`replicas: >1` (AKS) **and** the app registers SignalR, there must be a
`Microsoft.SignalRService/signalR` resource (or a provisioned Azure Cache for Redis used as the
backplane) in the same deployment. Absent both, cross-instance broadcasts are lost.

### BAD — three replicas, no backplane provisioned

```bicep
resource api 'Microsoft.App/containerApps@2024-03-01' = {
  properties: {
    template: { scale: { minReplicas: 3, maxReplicas: 10 } } // scaled out...
  }
}
// ...but no Microsoft.SignalRService/signalR and no Redis backplane anywhere in the template.
```

### GOOD — Azure SignalR Service provisioned and referenced

```bicep
resource signalr 'Microsoft.SignalRService/signalR@2024-03-01' = {
  name: 'signalr-${appName}-${env}-001'
  location: location
  sku: { name: 'Standard_S1', capacity: 1 }
  properties: { features: [ { flag: 'ServiceMode', value: 'Default' } ] }
}
// api container app references signalr.id via managed-identity RBAC (see SRS-003)
```

---

## Check B — Service-mode mismatch (SRS-002)

`Default` mode = the SignalR Service proxies persistent hub connections for an always-on app
(Container Apps / AKS). `Serverless` mode = no persistent server; clients connect to the service
and the backend pushes via the management API / **upstream** endpoints (Azure Functions). Flag:

- `Serverless` mode with **no** `upstream` endpoint configured — server-to-client push has no path.
- `Default` mode provisioned for a Functions-only backend that has no persistent hub host.

```bicep
// BAD — Serverless mode, but nothing tells the service where to send client messages
properties: { features: [ { flag: 'ServiceMode', value: 'Serverless' } ] }
// no upstream.templates configured

// GOOD — Serverless with an upstream endpoint back to the Functions app
properties: {
  features: [ { flag: 'ServiceMode', value: 'Serverless' } ]
  upstream: { templates: [ { urlTemplate: 'https://${func}.azurewebsites.net/runtime/webhooks/signalr', categoryPattern: '*', eventPattern: '*', hubPattern: '*' } ] }
}
```

---

## Check C — Access key instead of managed identity (SRS-003)

The default `AddAzureSignalR(connectionString)` uses an access key. Prefer managed identity —
the app authenticates to the service with its own identity and an RBAC role assignment, and no
key is stored or rotated. Mirrors `azure-security-baseline` ASB-IM-1.

```bicep
// GOOD — role assignment granting the app's identity the SignalR App Server role
resource signalrRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: signalr
  name: guid(signalr.id, api.id, 'SignalR App Server')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '420fcaa2-552c-430f-98ca-3264be4806c7')
    principalId: api.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

App side: `.AddAzureSignalR(o => o.Endpoints = [ new ServiceEndpoint(new Uri(endpoint), new ManagedIdentityCredential()) ])`.

---

## Check D — Capacity / SKU (SRS-004)

- `Free_F1` caps at 20 concurrent connections and 20k messages/day — flag on any production
  environment tag.
- A fixed `capacity` with no autoscale review means a connection spike is silently throttled at
  the unit ceiling (1 unit ≈ 1,000 connections). Flag production `Standard`/`Premium` with a
  single hard-coded unit count and no documented scaling plan. `Premium_P1` supports autoscale.

---

## Check E — Public network exposure (SRS-005)

```bicep
// FINDING SRS-005 — service reachable from the public internet
properties: { publicNetworkAccess: 'Enabled' }
// Fix: 'Disabled' + a Microsoft.Network/privateEndpoints resource targeting the signalR id,
// or a networkACLs default-deny with an explicit allow for the app subnet.
```

---

## Read budget

≤ 8 files: the Bicep that provisions compute + SignalR/Redis, the Container Apps/AKS scaling
config, and the app's SignalR registration (to confirm the infra matches the code). Reference
`dotnet-realtime` for the app-side backplane call and `azure-security-baseline` for the
managed-identity/private-endpoint patterns rather than re-deriving them. Budgets bound
exploration, not quality — if confirming a finding needs the app's DI setup, read it and say why.
