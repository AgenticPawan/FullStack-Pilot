---
name: dotnet-solid-dry
description: Reviews C# for SOLID/DRY violations: god services (SRP), type-switch chains (OCP), substitutability breaks via NotImplementedException (LSP), fat interfaces (ISP), high-level services constructing concrete dependencies (DIP), and duplicated logic/magic values (DRY). Outputs pilot-dotnet solid-dry standard IDs.
when_to_use: SOLID principles, single responsibility, SRP violation, open closed principle, OCP, switch on type, Liskov substitution, LSP violation, NotImplementedException, interface segregation, ISP, fat interface, dependency inversion, DIP, new concrete dependency, DRY, duplicated validation, magic string, magic number
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| SD-001 | P1 | SRP — class/service with multiple unrelated responsibilities |
| SD-002 | P2 | OCP — switch/if-else chain on a type discriminator edited per new case |
| SD-003 | P1 | LSP — derived class throws `NotImplementedException` or narrows/widens a contract |
| SD-004 | P2 | ISP — fat interface forces implementers to throw `NotSupportedException` |
| SD-005 | P0 | DIP — high-level service `new`-s up a concrete low-level dependency directly |
| SD-006 | P2 | DRY — duplicated validation logic or repeated magic strings/numbers |

---

## Check A — SRP: multi-responsibility service

### Detection

1. For each service/class, list its public methods and group them by concern (validation,
   persistence, notification, formatting, external I/O).
2. If a single class spans 3+ unrelated concerns, or its constructor injects dependencies from
   unrelated concerns (e.g. `IValidator`, `IDbContext`, `IEmailSender`, `IPdfGenerator` all in one
   class) → SD-001.

### BAD — one class validates, persists, and emails

```csharp
public class OrderProcessor
{
    private readonly AppDbContext _dbContext;
    private readonly ISmtpClient _smtpClient;

    public OrderProcessor(AppDbContext dbContext, ISmtpClient smtpClient)
    {
        _dbContext = dbContext;
        _smtpClient = smtpClient;
    }

    public async Task ProcessAsync(Order order)
    {
        // Responsibility 1: validation
        if (order.Items.Count == 0)
        {
            throw new InvalidOperationException("Order must have items.");
        }

        // Responsibility 2: persistence
        _dbContext.Orders.Add(order);
        await _dbContext.SaveChangesAsync();

        // Responsibility 3: notification
        await _smtpClient.SendAsync(new MailMessage
        {
            To = { order.CustomerEmail },
            Subject = "Order confirmed",
            Body = $"Your order {order.Id} was placed."
        });
    }
}
```

### GOOD — each responsibility in its own class, composed

```csharp
public class OrderValidator
{
    public void Validate(Order order)
    {
        if (order.Items.Count == 0)
        {
            throw new InvalidOperationException("Order must have items.");
        }
    }
}

public class OrderRepository
{
    private readonly AppDbContext _dbContext;
    public OrderRepository(AppDbContext dbContext) => _dbContext = dbContext;

    public async Task SaveAsync(Order order, CancellationToken ct)
    {
        _dbContext.Orders.Add(order);
        await _dbContext.SaveChangesAsync(ct);
    }
}

public class OrderProcessor
{
    private readonly OrderValidator _validator;
    private readonly OrderRepository _repository;
    private readonly IOrderConfirmationSender _confirmationSender;

    public OrderProcessor(
        OrderValidator validator, OrderRepository repository, IOrderConfirmationSender confirmationSender)
    {
        _validator = validator;
        _repository = repository;
        _confirmationSender = confirmationSender;
    }

    public async Task ProcessAsync(Order order, CancellationToken ct)
    {
        _validator.Validate(order);
        await _repository.SaveAsync(order, ct);
        await _confirmationSender.SendAsync(order, ct);
    }
}
```

---

## Check B — OCP: switch chain on a type discriminator

### Detection

1. Grep for `switch` statements or `if (type == "...")` / `if (obj is TypeA) ... else if (obj is TypeB)`
   chains keyed on a discriminator field or type check, where each branch implements different behavior.
2. If the same discriminator appears in multiple such switch chains across the codebase (a strong sign
   a new case requires touching N files), or a comment like `// add new case here when adding a type` → SD-002.

### BAD — switch requiring edits for every new payment method

```csharp
public class PaymentProcessor
{
    public decimal CalculateFee(PaymentMethod method, decimal amount)
    {
        switch (method)
        {
            case PaymentMethod.CreditCard:
                return amount * 0.029m + 0.30m;
            case PaymentMethod.Ach:
                return amount * 0.008m;
            case PaymentMethod.Wire:
                return 25.00m;
            // Every new payment method requires editing this method AND every other
            // switch on PaymentMethod scattered across the codebase.
            default:
                throw new NotSupportedException($"Unknown payment method: {method}");
        }
    }
}
```

### GOOD — strategy pattern, closed for modification

```csharp
public interface IPaymentFeeStrategy
{
    PaymentMethod Method { get; }
    decimal CalculateFee(decimal amount);
}

public class CreditCardFeeStrategy : IPaymentFeeStrategy
{
    public PaymentMethod Method => PaymentMethod.CreditCard;
    public decimal CalculateFee(decimal amount) => amount * 0.029m + 0.30m;
}

public class AchFeeStrategy : IPaymentFeeStrategy
{
    public PaymentMethod Method => PaymentMethod.Ach;
    public decimal CalculateFee(decimal amount) => amount * 0.008m;
}

public class PaymentProcessor
{
    private readonly IReadOnlyDictionary<PaymentMethod, IPaymentFeeStrategy> _strategies;

    public PaymentProcessor(IEnumerable<IPaymentFeeStrategy> strategies)
        => _strategies = strategies.ToDictionary(s => s.Method);

    public decimal CalculateFee(PaymentMethod method, decimal amount)
    {
        if (!_strategies.TryGetValue(method, out var strategy))
        {
            throw new NotSupportedException($"Unknown payment method: {method}");
        }

        return strategy.CalculateFee(amount);
    }
}

// A new payment method is added by registering a new IPaymentFeeStrategy —
// PaymentProcessor itself never changes.
```

---

## Check C — LSP: broken substitutability

### Detection

1. Grep derived classes for method overrides whose body is `throw new NotImplementedException()`
   or `throw new NotSupportedException()` for a member the base class/interface promises to support.
2. Grep for overrides that add stricter preconditions (extra validation the base didn't require) or
   weaker postconditions (returning null where the base guarantees non-null) than the base contract.
3. Either pattern → SD-003 — callers coded against the base type break when substituting the derived type.

### BAD — ReadOnlyList throws on a supported base operation

```csharp
public class ReadOnlyProductList : List<Product>
{
    public override void Add(Product item)
        // Violates LSP: any code using this as a List<Product> and calling Add breaks
        => throw new NotSupportedException("This list is read-only.");
}

public void Reprice(List<Product> products)
{
    foreach (var p in products)
    {
        products.Add(p.Clone()); // works for List<Product>, throws for ReadOnlyProductList
    }
}
```

### GOOD — model the constraint through composition/interface, not inheritance

```csharp
public interface IReadOnlyProductCatalog
{
    IReadOnlyList<Product> Products { get; }
}

public class ProductCatalog : IReadOnlyProductCatalog
{
    private readonly List<Product> _products;
    public ProductCatalog(IEnumerable<Product> products) => _products = products.ToList();

    public IReadOnlyList<Product> Products => _products.AsReadOnly();
}

// Callers that need mutation depend on List<Product> or an explicit IMutableCatalog —
// they can never be handed a type that silently rejects operations the base type promises.
```

---

## Check D — ISP: fat interface forcing unused methods

### Detection

1. Grep interface implementations for `throw new NotSupportedException()` or `throw new NotImplementedException()`
   in a method required only because the interface bundles unrelated capabilities.
2. If an interface has 5+ members and at least one implementer only implements a subset (stubbing the
   rest) → SD-004.

### BAD — one bloated IRepository forces read-only repos to implement writes

```csharp
public interface IRepository<T>
{
    Task<T?> GetByIdAsync(int id);
    Task<IReadOnlyList<T>> GetAllAsync();
    Task AddAsync(T entity);
    Task UpdateAsync(T entity);
    Task DeleteAsync(int id);
}

public class ReportingOrderRepository : IRepository<Order>
{
    public Task<Order?> GetByIdAsync(int id) => /* real implementation */ throw new NotImplementedException();
    public Task<IReadOnlyList<Order>> GetAllAsync() => /* real implementation */ throw new NotImplementedException();

    // Reporting is read-only — these are forced no-ops
    public Task AddAsync(Order entity) => throw new NotSupportedException("Reporting repository is read-only.");
    public Task UpdateAsync(Order entity) => throw new NotSupportedException("Reporting repository is read-only.");
    public Task DeleteAsync(int id) => throw new NotSupportedException("Reporting repository is read-only.");
}
```

### GOOD — segregated read/write interfaces

```csharp
public interface IReadOnlyRepository<T>
{
    Task<T?> GetByIdAsync(int id);
    Task<IReadOnlyList<T>> GetAllAsync();
}

public interface IWritableRepository<T> : IReadOnlyRepository<T>
{
    Task AddAsync(T entity);
    Task UpdateAsync(T entity);
    Task DeleteAsync(int id);
}

public class ReportingOrderRepository : IReadOnlyRepository<Order>
{
    public Task<Order?> GetByIdAsync(int id) => /* real implementation */ Task.FromResult<Order?>(null);
    public Task<IReadOnlyList<Order>> GetAllAsync() => Task.FromResult<IReadOnlyList<Order>>(Array.Empty<Order>());
    // No write members to stub out — the interface matches what this class can actually do.
}
```

---

## Check E — DIP: high-level service constructs a concrete low-level dependency

### Detection

1. Grep constructors and method bodies of "high-level" service classes for `new SomeConcreteClient(...)`,
   `new SqlConnection(...)`, `new HttpClient(...)`, or `new SmtpClient(...)` — direct instantiation of
   an infrastructure-facing dependency instead of receiving it via constructor injection.
2. Any such instantiation inside a business-logic class → SD-005 — it also usually means the dependency
   is untestable (cannot be mocked/faked).

### BAD — service new's up its own SqlConnection and HttpClient

```csharp
public class InventoryService
{
    public async Task<int> GetStockLevelAsync(int productId)
    {
        using var connection = new SqlConnection("Server=.;Database=Inventory;Trusted_Connection=True;");
        await connection.OpenAsync();

        using var command = new SqlCommand("SELECT Stock FROM Products WHERE Id = @Id", connection);
        command.Parameters.AddWithValue("@Id", productId);

        return (int)(await command.ExecuteScalarAsync() ?? 0);
    }

    public async Task NotifySupplierAsync(int productId)
    {
        using var httpClient = new HttpClient(); // new'd up directly — no pooling, no retry policy, untestable
        await httpClient.PostAsJsonAsync("https://supplier.example.com/reorder", new { productId });
    }
}
```

### GOOD — depends on injected abstractions

```csharp
public interface IInventoryRepository
{
    Task<int> GetStockLevelAsync(int productId, CancellationToken ct = default);
}

public interface ISupplierClient
{
    Task NotifyReorderAsync(int productId, CancellationToken ct = default);
}

public class InventoryService
{
    private readonly IInventoryRepository _inventoryRepository;
    private readonly ISupplierClient _supplierClient;

    public InventoryService(IInventoryRepository inventoryRepository, ISupplierClient supplierClient)
    {
        _inventoryRepository = inventoryRepository;
        _supplierClient = supplierClient;
    }

    public Task<int> GetStockLevelAsync(int productId, CancellationToken ct = default)
        => _inventoryRepository.GetStockLevelAsync(productId, ct);

    public Task NotifySupplierAsync(int productId, CancellationToken ct = default)
        => _supplierClient.NotifyReorderAsync(productId, ct);
}
```

`ISupplierClient` is implemented using a named/typed `HttpClient` registered via
`services.AddHttpClient<ISupplierClient, SupplierClient>()`, giving pooling, retry, and testability for free.

---

## Check F — DRY: duplicated validation / magic values

### Detection

1. Grep for the same validation expression (e.g. email regex, min/max length checks, `decimal` bounds
   checks) repeated near-verbatim across multiple files — a strong sign is identical regex literals or
   identical `if (x < 0 || x > 100)`-shaped conditions in 2+ places.
2. Grep for repeated numeric or string literals with business meaning (`"Admin"`, `0.0825m`, `30`
   as a day count) appearing in 3+ places instead of a named constant.
3. Either pattern → SD-006.

### BAD — same email validation and tax-rate magic number duplicated

```csharp
public class CustomerRegistrationHandler
{
    public bool IsValid(string email)
        => Regex.IsMatch(email, @"^[^@\s]+@[^@\s]+\.[^@\s]+$");

    public decimal CalculateTotal(decimal subtotal) => subtotal * 1.0825m; // magic tax rate
}

public class NewsletterSignupHandler
{
    public bool IsValid(string email)
        => Regex.IsMatch(email, @"^[^@\s]+@[^@\s]+\.[^@\s]+$"); // duplicated regex

    public decimal CalculateShippingTotal(decimal subtotal) => subtotal * 1.0825m; // duplicated magic number
}
```

### GOOD — shared validator and named constant

```csharp
public static class EmailValidator
{
    private static readonly Regex Pattern = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);

    public static bool IsValid(string email) => Pattern.IsMatch(email);
}

public static class TaxRates
{
    public const decimal StandardSalesTaxRate = 0.0825m;
}

public class CustomerRegistrationHandler
{
    public bool IsValid(string email) => EmailValidator.IsValid(email);

    public decimal CalculateTotal(decimal subtotal) => subtotal * (1 + TaxRates.StandardSalesTaxRate);
}

public class NewsletterSignupHandler
{
    public bool IsValid(string email) => EmailValidator.IsValid(email);
}
```
