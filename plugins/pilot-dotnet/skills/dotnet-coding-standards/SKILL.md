---
name: dotnet-coding-standards
description: Reviews ASP.NET Core / C# code for baseline coding-standard violations. Flags disabled or suppressed nullable reference types, sync-over-async blocking calls, exceptions used for control flow or broad swallowed catches, unstructured string-interpolated logging, and scattered IConfiguration reads instead of the Options pattern. Outputs findings with pilot-dotnet coding-standards standard IDs.
when_to_use: coding standards, nullable reference types, NRT, sync over async, .Result, .Wait(), GetAwaiter().GetResult(), exception control flow, catch Exception, swallowed exception, structured logging, ILogger, message template, Options pattern, IOptions, IConfiguration, file-scoped namespace, ImplicitUsings
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| CS-001 | P1 | Nullable reference types disabled or warnings suppressed project-wide |
| CS-002 | P0 | Blocking async code via `.Result`/`.Wait()`/`.GetAwaiter().GetResult()` |
| CS-003 | P1 | Exceptions used for control flow, or `catch (Exception)` swallowed silently |
| CS-004 | P2 | Unstructured logging — string interpolation into `ILogger` calls |
| CS-005 | P2 | Hardcoded config reads via `IConfiguration["Key"]` instead of Options pattern |
| CS-006 | P4 | Not using file-scoped namespaces / `ImplicitUsings` disabled (advisory) |

---

## Check A — Nullable reference types

### Detection

1. Open every `.csproj` in the solution and check for `<Nullable>enable</Nullable>`.
2. If `<Nullable>disable</Nullable>`, missing entirely, or set to `annotations` only (warnings not enforced) → CS-001.
3. Also grep for `#nullable disable` at the top of `.cs` files that re-disable it locally without a comment explaining why (e.g. generated code).

### BAD — nullable disabled project-wide

```xml
<PropertyGroup>
  <TargetFramework>net8.0</TargetFramework>
  <Nullable>disable</Nullable>
  <ImplicitUsings>enable</ImplicitUsings>
</PropertyGroup>
```

```csharp
public class CustomerService
{
    // No compiler help — this silently accepts null and blows up at runtime
    public string GetDisplayName(Customer customer)
    {
        return customer.FirstName + " " + customer.LastName;
    }
}
```

### GOOD — nullable enabled, nullability made explicit

```xml
<PropertyGroup>
  <TargetFramework>net8.0</TargetFramework>
  <Nullable>enable</Nullable>
  <ImplicitUsings>enable</ImplicitUsings>
</PropertyGroup>
```

```csharp
public class CustomerService
{
    public string GetDisplayName(Customer customer)
    {
        ArgumentNullException.ThrowIfNull(customer);

        // Compiler flags this at build time if FirstName/LastName can be null
        return $"{customer.FirstName} {customer.LastName}".Trim();
    }
}

public class Customer
{
    public required string FirstName { get; init; }
    public string? MiddleName { get; init; }
    public required string LastName { get; init; }
}
```

---

## Check B — Sync-over-async blocking

### Detection

1. Grep for `.Result`, `.Wait()`, and `.GetAwaiter().GetResult()` across `**/*.cs`.
2. Exclude usages inside `Main(string[] args)` synchronous entry points that have no async alternative and test helper `Setup`/`TearDown` methods where the framework mandates sync signatures.
3. Any remaining hit inside a request-handling path (controller, minimal API handler, service consumed by ASP.NET Core) → CS-002. This pattern can deadlock under a synchronization context and starves the thread pool.

### BAD — blocking on async work

```csharp
[HttpGet("{id:int}")]
public IActionResult GetOrder(int id)
{
    // Blocks the request thread; can deadlock under load
    var order = _orderService.GetOrderAsync(id).Result;
    if (order is null)
    {
        return NotFound();
    }

    return Ok(order);
}
```

### GOOD — async all the way

```csharp
[HttpGet("{id:int}")]
public async Task<IActionResult> GetOrder(int id, CancellationToken cancellationToken)
{
    var order = await _orderService.GetOrderAsync(id, cancellationToken);
    if (order is null)
    {
        return NotFound();
    }

    return Ok(order);
}
```

---

## Check C — Exceptions for control flow / swallowed catches

### Detection

1. Grep for `catch (Exception` (or `catch (Exception ex)`) blocks whose body is empty, contains only a `// TODO`, or only logs at `Debug`/`Trace` level without rethrow.
2. Grep for `throw new` inside logic that is reachable via a normal, expected code path (e.g., validating user input) rather than truly exceptional conditions — a strong signal is a `try { … } catch (SomeException) { return SomeDefault; }` pattern used to implement branching instead of `TryParse`/`if` checks.
3. Both patterns → CS-003.

### BAD — exception used for control flow, and swallowed catch

```csharp
public decimal ParseDiscount(string input)
{
    try
    {
        return decimal.Parse(input);
    }
    catch (Exception)
    {
        // Swallowed — caller has no idea parsing failed, and this is expected input, not exceptional
        return 0m;
    }
}

public async Task ProcessBatchAsync(IEnumerable<Order> orders)
{
    foreach (var order in orders)
    {
        try
        {
            await _paymentGateway.ChargeAsync(order);
        }
        catch (Exception)
        {
            // Silently continues — a failed charge is now invisible
        }
    }
}
```

### GOOD — expected outcomes modeled explicitly, unexpected ones surfaced

```csharp
public bool TryParseDiscount(string input, out decimal discount)
{
    return decimal.TryParse(input, NumberStyles.Number, CultureInfo.InvariantCulture, out discount);
}

public async Task ProcessBatchAsync(IEnumerable<Order> orders)
{
    foreach (var order in orders)
    {
        try
        {
            await _paymentGateway.ChargeAsync(order);
        }
        catch (PaymentGatewayException ex)
        {
            _logger.LogError(ex, "Charge failed for order {OrderId}", order.Id);
            await _failedChargeQueue.EnqueueAsync(order.Id);
        }
    }
}
```

---

## Check D — Unstructured logging

### Detection

1. Grep for `_logger.Log(Information|Warning|Error|Debug|Trace)\(\$"` — interpolated string literals (`$"..."`) passed directly to `ILogger` calls.
2. Also flag `string.Format` or `+` concatenation used to build the log message.
3. Any match → CS-004. Structured logging providers (e.g. Application Insights, Seq) cannot query/aggregate on interpolated text.

### BAD — string interpolation destroys structure

```csharp
_logger.LogInformation($"Order {order.Id} shipped to {order.Address} at {DateTime.UtcNow}");

_logger.LogError("Payment failed for customer " + customerId + " amount " + amount);
```

### GOOD — message template with named parameters

```csharp
_logger.LogInformation(
    "Order {OrderId} shipped to {ShippingAddress} at {ShippedAtUtc}",
    order.Id, order.Address, DateTime.UtcNow);

_logger.LogError(
    "Payment failed for customer {CustomerId} amount {Amount:C}",
    customerId, amount);
```

---

## Check E — Missing Options pattern

### Detection

1. Grep for `IConfiguration` injected into non-`Program.cs`/non-startup classes (services, controllers, handlers).
2. Grep for `_configuration["..."]` or `_configuration.GetValue<T>("...")` used more than once for the same logical setting across different files — a sign settings are duplicated instead of bound once.
3. Either pattern in business-logic classes → CS-005.

### BAD — raw IConfiguration reads scattered through business logic

```csharp
public class EmailSenderService
{
    private readonly IConfiguration _configuration;

    public EmailSenderService(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public async Task SendWelcomeEmailAsync(string toAddress)
    {
        var smtpHost = _configuration["Email:SmtpHost"];
        var smtpPort = int.Parse(_configuration["Email:SmtpPort"]!);
        var fromAddress = _configuration["Email:FromAddress"];

        using var client = new SmtpClient(smtpHost, smtpPort);
        await client.SendMailAsync(new MailMessage(fromAddress!, toAddress, "Welcome", "Hello!"));
    }
}
```

### GOOD — strongly-typed Options bound once at startup

```csharp
public sealed class EmailOptions
{
    public const string SectionName = "Email";

    public required string SmtpHost { get; init; }
    public required int SmtpPort { get; init; }
    public required string FromAddress { get; init; }
}

// Program.cs
builder.Services
    .AddOptions<EmailOptions>()
    .Bind(builder.Configuration.GetSection(EmailOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

public class EmailSenderService
{
    private readonly EmailOptions _options;

    public EmailSenderService(IOptions<EmailOptions> options)
    {
        _options = options.Value;
    }

    public async Task SendWelcomeEmailAsync(string toAddress)
    {
        using var client = new SmtpClient(_options.SmtpHost, _options.SmtpPort);
        await client.SendMailAsync(
            new MailMessage(_options.FromAddress, toAddress, "Welcome", "Hello!"));
    }
}
```

---

## Check F — File-scoped namespaces / ImplicitUsings (advisory)

### Detection

1. Grep new/modern (net8+) `.cs` files for block-scoped `namespace Foo.Bar { ... }` instead of `namespace Foo.Bar;`.
2. Check `.csproj` for missing `<ImplicitUsings>enable</ImplicitUsings>`.
3. Emit as CS-006, P4 advisory — style-only, no functional risk.

### BAD — block-scoped namespace, extra indentation noise

```csharp
using System;

namespace FullStack.Pilot.Services
{
    public class OrderNumberGenerator
    {
        public string Generate()
        {
            return $"ORD-{DateTime.UtcNow:yyyyMMdd}-{Guid.NewGuid():N}";
        }
    }
}
```

### GOOD — file-scoped namespace, implicit usings enabled

```csharp
namespace FullStack.Pilot.Services;

public class OrderNumberGenerator
{
    public string Generate()
        => $"ORD-{DateTime.UtcNow:yyyyMMdd}-{Guid.NewGuid():N}";
}
```
