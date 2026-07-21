---
id: azure-no-floating-image-tags
title: Container Images Must Use Explicit Version Tags or Digests
appliesTo: azure
severity: block
standard: supply-chain
---
Every container image reference in Bicep templates, Azure Container Apps manifests,
GitHub Actions workflow files, Docker Compose files, and Kubernetes manifests MUST
use an explicit version tag (e.g. `redis:7.2.4`) or an image digest
(`redis@sha256:abc…`). **Never use `:latest` or omit the tag entirely.**

**Why:** `:latest` and untagged images are rebuilt by the upstream registry at any
time. A deployment that re-pulls `:latest` will silently run a different binary than
the version that passed your test suite — the canonical supply-chain attack vector
for containerised services. This rule operationalises the `dependency-supply-chain`
skill as an enforcement gate.

**BAD**
```bicep
// azure-container-app.bicep — floating tag
properties: {
  template: {
    containers: [{
      image: 'redis:latest'          // BAD — floats
    }]
  }
}
```

```yaml
# docker-compose.yml — no tag at all
services:
  cache:
    image: redis                     # BAD — implicitly :latest
```

**GOOD**
```bicep
properties: {
  template: {
    containers: [{
      image: 'redis:7.2.4'          // GOOD — pinned version
    }]
  }
}
```

```yaml
services:
  cache:
    image: redis:7.2.4              # GOOD — pinned
    # or pin to digest for maximum reproducibility:
    # image: redis@sha256:abc123…
```

**Scope:** Bicep (`.bicep`), YAML (`.yml`, `.yaml`), and JSON container definitions.
Migration scripts and `.cs` files that name image strings should be reviewed manually
but are not covered by the automated hook pattern.

**Dependency:** hook enforcement is provided by `pilot-core`'s `dangerous-patterns.json`
(`AZURE_FLOATING_IMAGE_TAG` — `deny` action). Stack plugins inherit this via the
`pilot-core` dependency.

Cross-reference: `dependency-supply-chain`, `azure-container-apps-governance`,
`dotnet-aspire-governance` (ASP-006, ASP-007).
