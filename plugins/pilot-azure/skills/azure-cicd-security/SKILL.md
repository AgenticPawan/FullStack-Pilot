---
name: azure-cicd-security
description: Reviews GitHub Actions deployment workflow security beyond azure-bicep-patterns' what-if check. Flags long-lived service-principal secrets used instead of OIDC federated credentials, missing environment protection rules/approval gates on production deploys, deployment identities granted broader roles than the resources they touch, and secrets referenced directly in workflow YAML instead of GitHub encrypted secrets or Key Vault. Outputs findings with pilot-azure cicd-security standard IDs.
when_to_use: GitHub Actions Azure login, OIDC federated credential, azure/login action, service principal secret, environment protection rules, deployment approval gate, least-privilege deployment identity, workflow secrets, GITHUB_TOKEN permissions
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| CICD-001 | P0 | Long-lived service-principal secret used instead of OIDC federated credentials |
| CICD-002 | P1 | No environment protection rules/approval gate on a production deployment |
| CICD-003 | P1 | Deployment identity granted broader roles than the resources it actually touches |
| CICD-004 | P1 | Secret referenced directly in workflow YAML instead of via GitHub encrypted secrets |

---

## Check A — Long-lived secret instead of OIDC federation (CICD-001)

### Detection

Grep `.github/workflows/*.yml` for `azure/login@v*` using `creds:`/`client-secret:` inputs
sourced from a stored secret, instead of `client-id`/`tenant-id`/`subscription-id` with no
secret at all (OIDC federated credential trust between GitHub and Entra ID). A long-lived
service-principal secret sitting in GitHub Secrets is a standing credential that doesn't
expire on its own and is a high-value target if the repo or an action dependency is
compromised.

### BAD — long-lived client secret

```yaml
- uses: azure/login@v2
  with:
    creds: ${{ secrets.AZURE_CREDENTIALS }} # a JSON blob containing a client secret that never rotates automatically
```

### GOOD — OIDC federated credential, no stored secret

```yaml
permissions:
  id-token: write # required for OIDC
  contents: read

- uses: azure/login@v2
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
    # No client-secret — GitHub's OIDC token is exchanged for a short-lived Azure token per run.
```

---

## Check B — No environment protection/approval gate (CICD-002)

### Detection

Check whether the production deployment job targets a GitHub `environment:` with
protection rules (required reviewers, wait timer) configured, versus deploying to
production on every push to `main` with no human gate.

### BAD — production deploy fires automatically, no approval

```yaml
deploy-prod:
  runs-on: ubuntu-latest
  steps:
    - run: az deployment group create ... # runs on every merge to main, no review step
```

### GOOD — production environment requires approval

```yaml
deploy-prod:
  runs-on: ubuntu-latest
  environment:
    name: production # configured in repo settings with required reviewers
  steps:
    - run: az deployment group create ...
```

---

## Check C — Deployment identity broader than necessary (CICD-003)

### Detection

Check the role assignment given to the deployment service principal/managed identity —
flag `Owner`/`Contributor` at subscription scope when the workflow only deploys to one or
two resource groups. This mirrors `azure-security-baseline` ASB-PA-1 but specifically for
the CI/CD identity, which is an especially attractive target since compromising it grants
deploy-time control over everything it can touch.

### BAD — deployment SP has Owner at subscription scope

```bicep
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  properties: {
    roleDefinitionId: ownerRoleId // far broader than "deploy to these two resource groups"
    principalId: deploymentIdentity.properties.principalId
  }
}
```

### GOOD — Contributor scoped to only the resource groups the pipeline deploys to

```bicep
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: resourceGroup('rg-orders-prod')
  properties: {
    roleDefinitionId: contributorRoleId
    principalId: deploymentIdentity.properties.principalId
  }
}
```

---

## Check D — Secret referenced directly in workflow YAML (CICD-004)

### Detection

Grep workflow files for a literal credential value (not `${{ secrets.* }}`) or a secret
piped through `echo`/`print` steps that would leak it into build logs. Every secret must
be a GitHub encrypted secret (or pulled from Key Vault at runtime), never a plaintext
value committed to the workflow file itself.

### BAD — API key value hardcoded directly in the workflow

```yaml
env:
  PAYMENT_GATEWAY_KEY: sk_live_hardcoded_example_value # visible to anyone who can read the repo
```

### GOOD — sourced from GitHub Secrets, never echoed

```yaml
env:
  PAYMENT_GATEWAY_KEY: ${{ secrets.PAYMENT_GATEWAY_KEY }}
```
