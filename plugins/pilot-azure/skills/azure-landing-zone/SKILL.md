---
name: azure-landing-zone
description: Reviews enterprise-scale subscription/management-group topology — one level above azure-caf-naming's resource-name-string scope. Flags no management-group hierarchy separating platform from landing-zone subscriptions, a single subscription hosting both production and non-production workloads with no isolation boundary, no Azure Policy initiative assigned at the management-group level for tenant-wide guardrails, and no documented subscription-vending process for onboarding new workload teams. Outputs findings with pilot-azure landing-zone standard IDs.
when_to_use: management group, subscription vending, landing zone, enterprise-scale, subscription topology, Azure Policy initiative, platform subscription, connectivity subscription, tenant-wide guardrail
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| LZ-001 | P1 | No management-group hierarchy separating platform from landing-zone subscriptions |
| LZ-002 | P0 | Single subscription hosts both production and non-production workloads |
| LZ-003 | P1 | No Azure Policy initiative assigned at the management-group level for tenant-wide guardrails |
| LZ-004 | P2 | No documented subscription-vending process for onboarding new workload teams |

`azure-caf-naming` governs how an individual resource is *named*; this skill governs the
subscription/management-group *topology* those resources live inside — a shop with
pristine resource naming can still have zero isolation between prod and dev subscriptions.

---

## Check A — No management-group hierarchy (LZ-001)

### Detection

Check the tenant's management-group structure for a hierarchy separating platform
concerns (connectivity, identity, management) from landing-zone (workload) subscriptions
— the Cloud Adoption Framework's enterprise-scale reference architecture. A flat
structure with every subscription directly under the tenant root means there's no natural
place to apply a policy/RBAC boundary that differs between "platform" and "workload"
subscriptions.

### BAD — flat structure, every subscription under the tenant root with no grouping

```
Tenant Root
├── sub-orders-prod
├── sub-orders-dev
├── sub-invoicing-prod
├── sub-shared-connectivity
<!-- No management groups — no natural place to apply differentiated policy by function. -->
```

### GOOD — a management-group hierarchy separating platform from landing zones

```
Tenant Root
├── mg-platform
│   ├── mg-connectivity (sub-hub-network)
│   ├── mg-identity (sub-identity)
│   └── mg-management (sub-log-analytics, sub-automation)
└── mg-landing-zones
    ├── mg-corp (sub-orders-prod, sub-invoicing-prod)
    └── mg-online (sub-public-api-prod)
```

---

## Check B — Single subscription hosts prod and non-prod (LZ-002)

### Detection

Check whether production and non-production (dev/test/staging) resources for a workload
share one Azure subscription. A subscription is the strongest RBAC/policy/quota boundary
Azure offers — sharing one across environments means a developer with Contributor access
to iterate quickly in dev also has Contributor access to production by construction, and
a runaway dev-environment cost or quota exhaustion directly threatens production capacity.

### BAD — one subscription for both prod and dev

```
sub-orders (single subscription)
├── rg-orders-prod
└── rg-orders-dev
<!-- Same subscription-level RBAC and quotas apply to both — a dev-environment mistake
     can exhaust the shared subscription's quota that production also depends on. -->
```

### GOOD — separate subscriptions per environment tier, matching CAF's landing-zone pattern

```
sub-orders-prod   (production RBAC — tightly scoped, matches dotnet-authorization's
                    permissions-only model applied at the infrastructure layer)
sub-orders-nonprod (dev/test/staging — broader Contributor access for the team,
                     isolated blast radius from production)
```

---

## Check C — No Azure Policy initiative at management-group scope (LZ-003)

### Detection

Check whether tenant-wide guardrails (require CAF naming conventions per
`azure-caf-naming`, require Defender for Cloud enablement per `azure-security-baseline`
ASB-LT-1, deny public storage per ASB-NS-1) are enforced via an Azure Policy initiative
assigned at a management-group scope, or only documented as conventions each team is
expected to follow voluntarily. A convention with no enforcement mechanism is only as
strong as the least careful team's Bicep review.

### BAD — guardrails exist only as documentation, no policy enforcement

```markdown
<!-- docs/AZURE-CONVENTIONS.md says "don't allow public blob access" — but nothing
     technically prevents a new subscription's Bicep template from doing it anyway. -->
```

### GOOD — a policy initiative assigned once at the management-group level, inherited by every subscription underneath

```bicep
resource guardrailInitiative 'Microsoft.Authorization/policySetDefinitions@2023-04-01' = {
  name: 'platform-guardrails'
  properties: {
    policyDefinitions: [
      { policyDefinitionId: denyPublicBlobPolicyId }
      { policyDefinitionId: requireDefenderPolicyId }
      { policyDefinitionId: requireCafTagsPolicyId }
    ]
  }
}

resource assignment 'Microsoft.Authorization/policyAssignments@2022-06-01' = {
  name: 'platform-guardrails-assignment'
  scope: managementGroup('mg-landing-zones') // inherited by every subscription underneath
  properties: { policyDefinitionId: guardrailInitiative.id }
}
```

---

## Check D — No subscription-vending process (LZ-004)

### Detection

Check for a documented, repeatable process for onboarding a new workload team's
subscription (naming, initial RBAC, budget per `azure-cost-finops`, policy assignment
inheritance) versus an ad-hoc manual process that produces a slightly different setup
each time depending on who provisioned it.

### BAD — every new subscription is manually provisioned, slightly differently each time

```
# No template/checklist — subscription #14 is missing the budget alert that
# subscription #13 has, because whoever set it up forgot that step this time.
```

### GOOD — a subscription-vending Bicep/deployment-stack template, applied consistently

```bicep
// subscription-vending.bicep — deployed once per new workload onboarding
module budget 'modules/budget.bicep' = { params: { amount: defaultMonthlyBudget } } // azure-cost-finops FIN-001
module rbac 'modules/rbac.bicep' = { params: { teamGroupId: teamGroupId } }
// Policy inheritance from Check C's management-group assignment applies automatically —
// no manual step required for the new subscription to inherit tenant-wide guardrails.
```
