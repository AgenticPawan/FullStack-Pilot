---
name: azure-container-image-security
description: Reviews container image security for AKS/ACA workloads — the image-build-time layer above azure-aks-governance's pod-spec runtime checks. Flags no base-image vulnerability scanning in the build pipeline, images running as root with no non-root user configured, a full OS base image used where a distroless/minimal image would shrink the attack surface, and no image-signing/provenance verification before deployment. Outputs findings with pilot-azure container-image-security standard IDs.
when_to_use: container image scanning, Trivy, Defender for Containers, non-root container, distroless image, USER instruction Dockerfile, image signing, Notary, cosign, image provenance, ACR vulnerability scan
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| IMG-001 | P0 | No base-image vulnerability scanning in the build pipeline |
| IMG-002 | P0 | Image runs as root with no non-root `USER` configured |
| IMG-003 | P2 | Full OS base image used where distroless/minimal would shrink the attack surface |
| IMG-004 | P1 | No image-signing/provenance verification before deployment |

`azure-aks-governance` reviews the *pod spec* running a container (resource limits,
NetworkPolicy, Workload Identity). This skill reviews the *image itself* — a perfectly
governed pod spec still inherits every vulnerability baked into an unscanned, root-running
base image.

---

## Check A — No base-image vulnerability scanning (IMG-001)

### Detection

Check the CI/CD pipeline (or ACR's built-in scanning, or a dedicated tool like Trivy/
Microsoft Defender for Containers) for an image-scan step that runs before an image is
pushed to the registry or deployed. Without one, a known-vulnerable base image (an old
Alpine/Debian version with a disclosed CVE) ships to production with nobody having looked.

### BAD — image built and pushed with no vulnerability scan

```yaml
# .github/workflows/build.yml
- run: docker build -t acr.azurecr.io/orders-api:${{ github.sha }} .
- run: docker push acr.azurecr.io/orders-api:${{ github.sha }}
# No scan step — a base image with known CVEs ships straight to the registry.
```

### GOOD — scan gate before push, findings routed the same way as other vulnerability findings

```yaml
- run: docker build -t acr.azurecr.io/orders-api:${{ github.sha }} .
- name: Scan image
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: acr.azurecr.io/orders-api:${{ github.sha }}
    severity: 'CRITICAL,HIGH'
    exit-code: '1' # fails the build on critical/high findings — same severity bar as dependency-supply-chain
- run: docker push acr.azurecr.io/orders-api:${{ github.sha }} # only reached if the scan passed
```

Or, if ACR is the registry, enable Microsoft Defender for Containers' continuous
registry scanning as a defense-in-depth complement to the build-time gate.

---

## Check B — Image runs as root (IMG-002)

### Detection

Grep the `Dockerfile` for a `USER` instruction switching away from root before the
container's entrypoint runs. A container escape vulnerability is far more dangerous
against a process running as root inside the container — many container-breakout CVEs
specifically require root privileges inside the container to exploit.

### BAD — no USER instruction, container runs as root by default

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:9.0
COPY . /app
WORKDIR /app
ENTRYPOINT ["dotnet", "OrdersApi.dll"]
# No USER instruction — the process runs as root inside the container.
```

### GOOD — explicit non-root user

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:9.0
RUN adduser --disabled-password --gecos '' appuser
COPY --chown=appuser:appuser . /app
WORKDIR /app
USER appuser
ENTRYPOINT ["dotnet", "OrdersApi.dll"]
```

---

## Check C — Full OS image where distroless/minimal would do (IMG-003)

### Detection

For the final runtime stage of a multi-stage build, check whether a full OS base image
(`debian`, `ubuntu`, the non-`-alpine`/non-chiseled .NET runtime image) is used where a
minimal/distroless equivalent would work — every extra OS package (a shell, package
manager, unrelated utilities) is additional attack surface and additional CVE exposure
with no runtime benefit for a container that only needs to run one process.

### BAD — full Debian-based runtime image for a self-contained app

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
# Full Debian base — includes a shell, package manager, and dozens of packages
# the application never uses, all still subject to CVE scanning and patching.
```

### GOOD — chiseled/distroless runtime image

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:9.0-noble-chiseled AS final
# Chiseled images strip everything except what the .NET runtime needs to run —
# no shell, no package manager, dramatically smaller CVE surface.
```

---

## Check D — No image-signing/provenance verification (IMG-004)

### Detection

Check whether images are signed at build time (cosign, Notary v2 / ACR content trust)
and whether the deployment target (AKS admission controller, ACA) verifies the signature
before running an image — without this, nothing prevents an image from being tampered
with between the scan (Check A) and the deployment, or a compromised registry credential
from pushing an unreviewed image that still gets deployed.

### BAD — no signing, any image in the registry can be deployed regardless of provenance

```yaml
- run: docker push acr.azurecr.io/orders-api:${{ github.sha }}
# Nothing signs this image — a compromised push credential could push an unreviewed
# image under the same tag pattern with no way to distinguish it from a legitimate build.
```

### GOOD — image signed at build time, signature verified at deploy time

```yaml
- run: cosign sign --key azurekms://keyvault-uri/signing-key acr.azurecr.io/orders-api:${{ github.sha }}
```

```yaml
# AKS admission policy (Azure Policy / Gatekeeper) rejects unsigned images
resource imageSigningPolicy 'Microsoft.Authorization/policyAssignments@2022-06-01' = {
  name: 'require-signed-images'
  properties: { policyDefinitionId: requireSignedImagesPolicyId }
}
```
