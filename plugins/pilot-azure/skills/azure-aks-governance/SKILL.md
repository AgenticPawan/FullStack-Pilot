---
name: azure-aks-governance
description: Reviews AKS-specific governance for shops running Azure Kubernetes Service instead of Container Apps. Flags pods with no Pod Security Standards enforcement, containers with no resource requests/limits (noisy-neighbor and OOM-kill risk), no NetworkPolicy restricting pod-to-pod traffic, and workload identity not used for pod-to-Azure-resource authentication. Outputs findings with pilot-azure aks-governance standard IDs.
when_to_use: AKS, Azure Kubernetes Service, Pod Security Standards, resource requests limits, NetworkPolicy, workload identity, pod security admission, Kubernetes governance, noisy neighbor, OOM kill, namespace isolation
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| AKS-001 | P0 | Namespace/pod has no Pod Security Standards enforcement |
| AKS-002 | P1 | Container has no resource requests/limits configured |
| AKS-003 | P0 | No `NetworkPolicy` restricting pod-to-pod traffic |
| AKS-004 | P0 | Pod uses a client-secret/connection-string instead of Azure Workload Identity |

This skill only applies when `stack-detection` identifies AKS as the compute target;
shops on Azure Container Apps are governed by `azure-bicep-patterns`/`azure-security-baseline`
instead — AKS introduces a distinct cluster-level governance surface those skills don't cover.

---

## Check A — No Pod Security Standards enforcement (AKS-001)

### Detection

Check the namespace manifest for Pod Security Admission labels
(`pod-security.kubernetes.io/enforce`). Without at least the `baseline` standard, a pod
spec can request privileged mode, host networking, or host path mounts — any of which
gives a compromised container a path to the underlying node.

### BAD — namespace with no Pod Security Standard set

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: orders-prod
  # No pod-security.kubernetes.io/enforce label — any pod spec is admitted as-is.
```

### GOOD — restricted standard enforced at the namespace level

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: orders-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
```

---

## Check B — No resource requests/limits (AKS-002)

### Detection

Grep pod/deployment specs for containers with no `resources.requests`/`resources.limits`.
Without requests, the scheduler can't bin-pack nodes sensibly (noisy-neighbor risk);
without limits, one runaway container can consume all node memory and get OOM-killed
alongside every other pod on that node.

### BAD — no resource requests/limits set

```yaml
containers:
  - name: orders-api
    image: acr.azurecr.io/orders-api:latest
    # No resources block — this container can consume unbounded CPU/memory on its node.
```

### GOOD — requests and limits set based on observed usage

```yaml
containers:
  - name: orders-api
    image: acr.azurecr.io/orders-api:1.4.2 # also: pin a version, not `latest`
    resources:
      requests: { cpu: "250m", memory: "256Mi" }
      limits: { cpu: "500m", memory: "512Mi" }
```

---

## Check C — No NetworkPolicy restricting pod traffic (AKS-003)

### Detection

Check whether a `NetworkPolicy` resource exists for the namespace. Without one, every pod
can reach every other pod across the entire cluster by default — a compromised pod in a
low-trust namespace (e.g., a public-facing ingress) can freely reach the database-adjacent
pods in a different namespace with no network-layer barrier.

### BAD — no NetworkPolicy, flat network across the whole cluster

```
# No NetworkPolicy resource anywhere — default-allow-all pod-to-pod traffic.
```

### GOOD — default-deny with explicit allow rules

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: orders-prod
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-orders-api-to-db
  namespace: orders-prod
spec:
  podSelector: { matchLabels: { app: orders-api } }
  policyTypes: [Egress]
  egress:
    - to: [{ podSelector: { matchLabels: { app: orders-db-proxy } } }]
      ports: [{ port: 1433 }]
```

---

## Check D — Client secret instead of Workload Identity (AKS-004)

### Detection

Grep pod specs/Kubernetes secrets for a connection string or service-principal client
secret mounted as an environment variable for authenticating to Azure resources (Key
Vault, SQL, Storage) instead of Azure AD Workload Identity — the same managed-identity
principle `azure-security-baseline` ASB-IM-1 requires elsewhere, applied to AKS pods
specifically.

### BAD — service-principal secret mounted into the pod

```yaml
env:
  - name: AZURE_CLIENT_SECRET
    valueFrom:
      secretKeyRef: { name: sp-credentials, key: client-secret } # a standing credential inside the cluster
```

### GOOD — Workload Identity federates the pod's service account to an Azure AD identity

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-api-sa
  namespace: orders-prod
  annotations:
    azure.workload.identity/client-id: "<managed-identity-client-id>"
---
# Pod spec references the service account; no client secret exists anywhere in the cluster.
spec:
  serviceAccountName: orders-api-sa
  containers:
    - name: orders-api
      env:
        - { name: AZURE_CLIENT_ID, value: "<managed-identity-client-id>" }
```
