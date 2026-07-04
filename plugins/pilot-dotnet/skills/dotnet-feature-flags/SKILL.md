---
name: dotnet-feature-flags
description: Reviews ASP.NET Core feature-flag usage via Microsoft.FeatureManagement — the rollout-specific extension of dotnet-dynamic-configuration's generic DB-backed settings model. Flags feature branching done with ad-hoc if/config checks instead of IFeatureManager, no targeting-filter support for percentage rollout or user/tenant allow-lists, flags left in code long after a rollout completed, and flag evaluation results not exposed to the Angular frontend consistently. Outputs findings with pilot-dotnet feature-flags standard IDs.
when_to_use: feature flag, IFeatureManager, Microsoft.FeatureManagement, percentage rollout, targeting filter, feature gate, stale feature flag, flag cleanup, canary release, A/B rollout, beta feature toggle
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| FF-001 | P1 | Feature branching done with ad-hoc `if(config[...])` instead of `IFeatureManager` |
| FF-002 | P1 | No targeting-filter support for percentage rollout or user/tenant allow-lists |
| FF-003 | P2 | Feature flag left in code long after its rollout completed |
| FF-004 | P2 | Flag evaluation not exposed to the Angular frontend consistently |

Builds on `dotnet-dynamic-configuration`'s DB-backed settings model — a feature flag is a
specific *kind* of dynamic configuration value with its own evaluation semantics
(percentage/targeting), not just an on/off boolean read from the settings table.

---

## Check A — Ad-hoc config checks instead of IFeatureManager (FF-001)

### Detection

Grep for `_configuration["Features:X"] == "true"` or a hand-rolled boolean read used to
gate a code path, instead of `IFeatureManager.IsEnabledAsync(...)`. The hand-rolled
version has no targeting/percentage support and no consistent evaluation contract across
the codebase — every feature check reinvents its own on/off logic.

### BAD — ad-hoc config-driven branching

```csharp
public async Task<IActionResult> Checkout(CheckoutDto dto)
{
    if (_configuration["Features:NewCheckoutFlow"] == "true") // string comparison, no targeting
    {
        return await _newCheckoutService.ProcessAsync(dto);
    }
    return await _legacyCheckoutService.ProcessAsync(dto);
}
```

### GOOD — IFeatureManager, backed by the DB-backed configuration source

```csharp
builder.Services.AddFeatureManagement()
    .AddFeatureFilter<PercentageFilter>()
    .AddFeatureFilter<TargetingFilter>();

public async Task<IActionResult> Checkout(CheckoutDto dto, IFeatureManager featureManager)
{
    if (await featureManager.IsEnabledAsync("NewCheckoutFlow"))
        return await _newCheckoutService.ProcessAsync(dto);
    return await _legacyCheckoutService.ProcessAsync(dto);
}
```

---

## Check B — No targeting-filter support (FF-002)

### Detection

For a flag intended to roll out gradually (not just be a static on/off switch), check
whether `TargetingFilter`/`PercentageFilter` is actually configured with targeting
criteria (specific users, tenants, or a percentage of traffic), versus a flag that's
either 0% or 100% enabled everywhere with no gradual-rollout mechanism.

### BAD — flag is a blunt global switch with no rollout control

```json
{
  "FeatureManagement": {
    "NewCheckoutFlow": true
  }
}
```

### GOOD — percentage rollout + beta-tenant allow-list

```json
{
  "FeatureManagement": {
    "NewCheckoutFlow": {
      "EnabledFor": [
        { "Name": "Percentage", "Parameters": { "Value": 10 } },
        { "Name": "Targeting", "Parameters": { "Audience": {
          "Groups": [{ "Name": "BetaTenants", "RolloutPercentage": 100 }],
          "DefaultRolloutPercentage": 0
        }}}
      ]
    }
  }
}
```

```csharp
public class TenantTargetingContextAccessor : ITargetingContextAccessor
{
    private readonly ICurrentUserService _currentUser;

    public ValueTask<TargetingContext> GetContextAsync() =>
        new(new TargetingContext
        {
            UserId = _currentUser.UserId.ToString(),
            Groups = new[] { _currentUser.TenantGroup }
        });
}
```

---

## Check C — Stale flag never cleaned up (FF-003)

### Detection

Check whether a flag that has been at 100% rollout (or 0%, permanently killed) for an
extended period still has both code branches present, plus the flag definition itself.
Every stale flag is dead-code risk and cognitive overhead — the "old" branch usually
stops being tested once the rollout completes but stays in the codebase indefinitely.

### BAD — flag fully rolled out months ago, both branches still exist

```csharp
// NewCheckoutFlow has been at 100% for 6 months; legacy path is untested dead code
// that still gets *compiled* and *reviewed* in every unrelated PR that touches this file.
if (await featureManager.IsEnabledAsync("NewCheckoutFlow"))
    return await _newCheckoutService.ProcessAsync(dto);
return await _legacyCheckoutService.ProcessAsync(dto);
```

### GOOD — flag removed once rollout is confirmed complete, only the winning path remains

```csharp
// NewCheckoutFlow flag removed 2026-01-15 after 100% rollout confirmed stable for 30 days.
return await _newCheckoutService.ProcessAsync(dto);
```

Track flag age/rollout percentage in the same DB-backed settings admin surface
`dotnet-dynamic-configuration` CFG-005 recommends, and flag any feature at 100%/0% for
longer than a documented threshold (e.g., 60 days) for cleanup.

---

## Check D — Flag evaluation not exposed to the frontend consistently (FF-004)

### Detection

For a flag that also changes Angular UI behavior (not just backend logic), check whether
the frontend re-implements its own copy of the same targeting logic instead of querying a
single `/api/features` endpoint that evaluates via the same `IFeatureManager` the backend
uses — two independent evaluations of "is this user in the 10% rollout" can disagree.

### BAD — Angular re-derives its own flag logic

```typescript
// Angular guesses at rollout eligibility independently of the backend's IFeatureManager
const isBeta = localStorage.getItem('betaUser') === 'true';
```

### GOOD — one evaluation source, exposed via an endpoint

```csharp
[HttpGet("api/features")]
public async Task<IActionResult> GetFeatures(IFeatureManager featureManager)
{
    var flags = new Dictionary<string, bool>();
    await foreach (var name in featureManager.GetFeatureNamesAsync())
        flags[name] = await featureManager.IsEnabledAsync(name);
    return Ok(flags);
}
```

```typescript
// FeatureFlagService fetches once per session from the same evaluation the backend uses
this.flags = await this.http.get<Record<string, boolean>>('/api/features').toPromise();
```
