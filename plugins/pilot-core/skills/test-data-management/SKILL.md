---
name: test-data-management
description: Reviews how lower environments (dev/test/staging) get realistic test data safely — closing a gap dotnet-data-protection's production PII controls leave open if a raw prod backup is restored into a less-protected environment. Flags no anonymization/masking step in a prod-to-lower-environment data refresh, no synthetic-data-seeding alternative for teams that don't need real data shapes, lower environments with weaker access control than production despite holding a copy of production data, and no documented policy for which data is safe to copy at all. Outputs findings with pilot-core test-data-management standard IDs.
when_to_use: test data, data anonymization, data masking, synthetic data seeding, prod data copy, database refresh, staging data refresh, PII in lower environments, test fixtures, data subsetting
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| TDM-001 | P0 | Prod-to-lower-environment data refresh has no anonymization/masking step |
| TDM-002 | P2 | No synthetic-data-seeding alternative offered for teams that don't need real data shapes |
| TDM-003 | P0 | Lower environment holds a copy of production data with weaker access control than production |
| TDM-004 | P1 | No documented policy for which data is safe to copy into lower environments |

`dotnet-data-protection` and `sql-data-protection` establish strong controls over
production PII (encryption, masking, access logging). Those controls are worthless if the
easiest way to get realistic test data is restoring a raw production backup into a
staging environment nobody locked down the same way — this skill closes that loop.

---

## Check A — No anonymization step in a prod-to-lower refresh (TDM-001)

### Detection

Check the process that populates dev/test/staging with data (a scheduled job, a manual
runbook, a CI step) for an anonymization/masking pass between the production source and
the lower-environment destination. A "restore prod backup into staging" script with no
anonymization step is the single most common way PII ends up somewhere it was never
supposed to be — often set up by someone trying to solve a legitimate problem (need
realistic data to reproduce a bug) the fastest way available.

### BAD — raw production backup restored directly into staging

```powershell
# refresh-staging.ps1
Restore-SqlDatabase -Database "OrdersStaging" -BackupFile "prod-backup.bak"
# Every customer's real name, email, and order history is now in staging,
# which has broader developer access than production.
```

### GOOD — anonymization pass between restore and availability

```powershell
Restore-SqlDatabase -Database "OrdersStaging" -BackupFile "prod-backup.bak"
Invoke-Sqlcmd -Database "OrdersStaging" -Query @"
UPDATE Customers SET
  Email = CONCAT('customer', Id, '@example-test.invalid'),
  FullName = CONCAT('Test Customer ', Id),
  Phone = NULL;
"@
# Row counts, data distributions, and relationships stay realistic; actual PII does not.
```

---

## Check B — No synthetic-data alternative (TDM-002, advisory)

### Detection

For teams that don't specifically need production-realistic data distributions (most
feature development, most UI work), check whether a synthetic-data seeding option exists
(Bogus/AutoFixture-generated fixtures) as a lighter-weight alternative to a full
anonymized prod-copy refresh — not every environment needs the full production dataset,
and defaulting to "just copy prod" when synthetic data would do is unnecessary exposure
even after anonymization (Check A).

### BAD — every environment refresh pulls from the anonymized prod copy, even for teams that just need a few realistic-looking rows

```
<!-- No lighter-weight seeding option exists — every developer environment requires
     the full anonymized-prod-copy pipeline just to get a handful of test orders to work with. -->
```

### GOOD — synthetic seed data available for the common case

```csharp
public class OrderSeedData
{
    public static List<Order> Generate(int count = 50) =>
        new Faker<Order>()
            .RuleFor(o => o.Id, f => Guid.CreateVersion7())
            .RuleFor(o => o.CustomerName, f => f.Name.FullName())
            .RuleFor(o => o.Total, f => f.Finance.Amount())
            .Generate(count);
}
// Realistic-looking data, zero exposure risk, available to any developer instantly —
// the anonymized prod-copy pipeline (Check A) is reserved for the cases that genuinely
// need production's actual data distributions/edge cases to reproduce a specific bug.
```

---

## Check C — Lower environment weaker access control than production (TDM-003)

### Detection

Once a lower environment holds any copy of production-derived data (even anonymized —
anonymization can be imperfect, and re-identification risk is real), check whether that
environment's access control matches the isolation `azure-landing-zone` LZ-002 already
requires between prod and non-prod subscriptions — a staging environment with broad
Contributor access for the whole engineering org, holding data derived from production,
undermines the very separation LZ-002 exists to enforce.

### BAD — staging holds prod-derived data but has org-wide broad access

```
sub-orders-nonprod (holds an anonymized copy of prod data)
├── RBAC: Contributor granted to the entire Engineering AAD group
<!-- Broad access was fine when staging only had synthetic data; it's a different
     risk calculus now that it holds anything derived from real customer records. -->
```

### GOOD — access scoped down once real-derived data enters the environment

```
sub-orders-nonprod
├── RBAC: Contributor scoped to the Orders team only, not org-wide
├── Same audit-logging expectations (dotnet-audit-trail) applied as production
  for any environment holding prod-derived data, even anonymized.
```

---

## Check D — No documented policy for what's safe to copy (TDM-004)

### Detection

Confirm a documented policy states which tables/columns are eligible for the anonymized
refresh (Check A) versus which must never leave production under any circumstances
(payment tokens, government IDs — the same "highly sensitive" tier `dotnet-data-protection`
DP-001 and `sql-data-protection` SDP-001 flag for encryption) regardless of anonymization
confidence.

### BAD — no stated boundary, anonymization applied inconsistently by whoever writes the refresh script

```
<!-- No policy — one engineer's refresh script anonymizes emails; another's, written
     for a different service, forgets to touch a table holding partial payment card data. -->
```

### GOOD — an explicit, reviewed list

```markdown
<!-- docs/TEST-DATA-POLICY.md -->
**Eligible for anonymized refresh:** Customers, Orders, OrderLines (see Check A's script)
**Never copied to lower environments, in any form:** PaymentTokens, GovernmentIds,
HealthRecords — these tables are excluded entirely from the refresh, not anonymized;
services needing to test against them use synthetic data (Check B) exclusively.
```
