---
name: dotnet-data-protection
description: Reviews ASP.NET Core / EF Core data protection for PII. Flags PII columns stored in plaintext with no column-level encryption where the data is highly sensitive, soft-delete that never scrubs PII on a GDPR-style erasure request, PII logged in plaintext via structured logging, and entities/columns with no documented data-classification tagging. Ties to dotnet-audit-fields and dotnet-authorization's earlier PII hardening. Outputs findings with pilot-dotnet data-protection standard IDs.
when_to_use: PII, data protection, column encryption, EF Core value converter, Always Encrypted, GDPR, right to erasure, data classification, PII logging, sensitive data masking, encrypt at rest
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| DP-001 | P0 | PII column stored in plaintext with no column-level encryption |
| DP-002 | P1 | Soft-delete never scrubs PII on an erasure request |
| DP-003 | P1 | PII logged in plaintext via structured logging |
| DP-004 | P2 | No documented data-classification tagging on PII columns |

---

## Check A — PII column stored in plaintext (DP-001)

### Detection

1. Grep entity classes for columns named/typed like PII (`Ssn`, `NationalId`,
   `DateOfBirth`, `CreditCardNumber`) with no `HasConversion` to an encrypting value
   converter, and no SQL Server Always Encrypted column configuration.
2. Ordinary PII (email, name) used for day-to-day queries is not automatically a finding —
   flag the *highly sensitive* subset (government IDs, payment data, health data) where
   plaintext-at-rest is a real compliance exposure.

### BAD — SSN stored as plain text

```csharp
public class Employee
{
    public Guid Id { get; set; }
    public string Ssn { get; set; } = ""; // plaintext in the database, in every backup, in every restore
}
```

### GOOD — column-level encryption via an EF Core value converter

```csharp
public class EncryptedStringConverter : ValueConverter<string, string>
{
    public EncryptedStringConverter(IDataProtector protector)
        : base(v => protector.Protect(v), v => protector.Unprotect(v)) { }
}

modelBuilder.Entity<Employee>()
    .Property(e => e.Ssn)
    .HasConversion(new EncryptedStringConverter(dataProtector));
```

---

## Check B — Soft-delete never scrubs PII (DP-002)

### Detection

Check whether a "deleted" record under `dotnet-soft-delete`'s `IsDeleted`/global-query-filter
model retains PII indefinitely, queryable forever via `IgnoreQueryFilters()`. A GDPR-style
erasure request needs the PII fields actually overwritten/nulled, not just hidden behind a
flag — the row can stay for referential/audit integrity, but the PII columns must not.

### BAD — soft-delete flips a flag, PII lives forever

```csharp
public async Task DeleteAsync(Guid customerId)
{
    var customer = await _db.Customers.FindAsync(customerId);
    customer!.IsDeleted = true; // PII (name, email, phone) still sits in the row untouched
    await _db.SaveChangesAsync();
}
```

### GOOD — soft-delete plus PII erasure

```csharp
public async Task EraseAsync(Guid customerId)
{
    var customer = await _db.Customers.FindAsync(customerId);
    customer!.IsDeleted = true;
    customer.Name = "[erased]";
    customer.Email = $"erased-{customer.Id}@deleted.invalid";
    customer.Phone = null;
    // Non-PII columns (Id, OrderHistory foreign keys) stay intact for referential integrity.
    await _db.SaveChangesAsync();
}
```

---

## Check C — PII logged in plaintext (DP-003)

### Detection

Grep `ILogger` calls (see `dotnet-coding-standards` CS-004 for the structured-logging
baseline) for message templates that interpolate PII fields directly
(`_logger.LogInformation("User {Email} logged in", user.Email)`). Structured logs are
commonly shipped to a long-retention log store outside the application's own data-retention
policy — PII there is invisible to the erasure flow in Check B.

### BAD — email logged on every login

```csharp
_logger.LogInformation("User {Email} logged in from {Ip}", user.Email, ipAddress);
```

### GOOD — log a non-PII identifier, not the PII value itself

```csharp
_logger.LogInformation("User {UserId} logged in from {Ip}", user.Id, ipAddress);
// user.Id is a Guid (dotnet-entity-keys) — traceable in support tooling without exposing PII in logs.
```

---

## Check D — No documented data-classification tagging (DP-004, advisory)

### Detection

Confirm PII-bearing columns/entities carry some marker a reviewer can grep for without
reading business logic — a custom `[PersonalData]` attribute, a naming convention, or a
central `docs/DATA-CLASSIFICATION.md` listing every PII column and its handling
requirement (encrypted? erasure-eligible? excluded from logs?). Flag a codebase where the
only way to know a column is PII is tribal knowledge.

### GOOD — a marker attribute making PII columns machine-discoverable

```csharp
public class Customer
{
    public Guid Id { get; set; }

    [PersonalData]
    public string Email { get; set; } = "";

    [PersonalData, HighlySensitive] // also triggers DP-001's encryption requirement
    public string? Ssn { get; set; }
}
```

A static analyzer or CI check can then grep for `[PersonalData]` to generate the data
map required by most privacy regulations, instead of maintaining it by hand.
