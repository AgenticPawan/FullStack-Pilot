---
name: dotnet-financial-precision
description: Reviews numeric-type and rounding discipline for money/pricing/billing code. Flags double or float used for currency amounts instead of decimal, no documented rounding-mode convention (banker's vs away-from-zero) applied inconsistently across calculations, currency amounts compared with equality instead of a tolerance-free decimal comparison, and multi-currency amounts stored/summed without a currency-code alongside the numeric value. Outputs findings with pilot-dotnet financial-precision standard IDs.
when_to_use: decimal vs double, money type, currency precision, rounding mode, banker's rounding, MidpointRounding, floating point currency, financial calculation, multi-currency, currency code, decimal comparison
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| FP-001 | P0 | `double`/`float` used for a currency amount instead of `decimal` |
| FP-002 | P1 | No documented, consistently-applied rounding-mode convention |
| FP-003 | P1 | Currency amount compared with `==`/floating tolerance instead of exact `decimal` equality |
| FP-004 | P2 | Multi-currency amount stored/summed with no currency code alongside the numeric value |

---

## Check A — double/float used for currency (FP-001)

### Detection

Grep entity/DTO properties and calculation code for `double`/`float` typed fields
representing money (`Price`, `Total`, `AmountPaid`). `double`/`float` are binary
floating-point — they cannot represent most decimal fractions exactly (`0.1 + 0.2 !=
0.3` in IEEE 754), which silently accumulates rounding error across many transactions.
`decimal` is a base-10 floating-point type built for exactly this.

### BAD — double used for a monetary field

```csharp
public class Order
{
    public double Total { get; set; } // 19.99 + 0.01 might not equal exactly 20.00
}
```

### GOOD — decimal for every monetary value

```csharp
public class Order
{
    public decimal Total { get; set; }
}

// EF Core column precision explicitly configured — decimal defaults can silently truncate
modelBuilder.Entity<Order>()
    .Property(o => o.Total)
    .HasColumnType("decimal(18,2)");
```

---

## Check B — No documented rounding-mode convention (FP-002)

### Detection

Grep for `Math.Round(...)` calls across the codebase and check whether they consistently
specify the same `MidpointRounding` mode (`ToEven` — banker's rounding — vs
`AwayFromZero`), and whether that choice is documented as the house convention. Two
calculations that round the same intermediate value differently (one call site defaults
to `ToEven`, another explicitly uses `AwayFromZero`) can produce a currency amount that
differs by a cent depending on which code path computed it — small individually, but this
is exactly the kind of discrepancy an auditor or a customer complaint will surface.

### BAD — inconsistent rounding across the codebase

```csharp
var tax = Math.Round(subtotal * taxRate, 2); // implicit default: MidpointRounding.ToEven
...
var discount = Math.Round(subtotal * discountRate, 2, MidpointRounding.AwayFromZero); // different mode, different file
```

### GOOD — one documented convention, applied via a shared helper

```csharp
public static class Money
{
    // House convention: banker's rounding (ToEven) for all financial calculations —
    // matches most accounting standards' expectation and avoids systematic bias
    // from always rounding .5 up.
    public static decimal Round(decimal value, int decimals = 2) =>
        Math.Round(value, decimals, MidpointRounding.ToEven);
}

var tax = Money.Round(subtotal * taxRate);
var discount = Money.Round(subtotal * discountRate);
```

---

## Check C — Currency amount compared with floating tolerance (FP-003)

### Detection

Grep for currency comparisons using a floating-point epsilon pattern
(`Math.Abs(a - b) < 0.0001`) — a leftover habit from `double`/`float` comparisons that is
unnecessary and actively wrong for `decimal`, which supports exact equality.

### BAD — epsilon-tolerance comparison applied to decimal values

```csharp
if (Math.Abs((double)(order.Total - expectedTotal)) < 0.0001) // unnecessary cast + tolerance for a decimal
```

### GOOD — exact decimal comparison

```csharp
if (order.Total == expectedTotal)
```

---

## Check D — Multi-currency amount with no currency code (FP-004)

### Detection

For a system handling more than one currency, check whether a monetary value is ever
stored/summed/compared as a bare `decimal` with no accompanying ISO 4217 currency code —
summing `19.99` (USD) with `19.99` (EUR) produces a meaningless `39.98` with no unit.

### BAD — bare decimal, currency assumed implicitly

```csharp
public class Invoice
{
    public decimal Total { get; set; } // which currency? assumed USD everywhere until it isn't
}

var grandTotal = invoices.Sum(i => i.Total); // silently sums across different currencies
```

### GOOD — a Money value object pairing amount and currency

```csharp
public readonly record struct Money(decimal Amount, string CurrencyCode)
{
    public static Money operator +(Money a, Money b)
    {
        if (a.CurrencyCode != b.CurrencyCode)
            throw new InvalidOperationException($"Cannot add {a.CurrencyCode} and {b.CurrencyCode}");
        return new Money(a.Amount + b.Amount, a.CurrencyCode);
    }
}

public class Invoice
{
    public Money Total { get; set; } // currency travels with the amount everywhere
}
```
