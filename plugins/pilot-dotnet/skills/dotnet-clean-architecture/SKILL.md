---
name: dotnet-clean-architecture
description: Audits layering in a Domain/Application/Infrastructure/Api Clean Architecture solution. Flags Domain projects referencing infrastructure packages, business logic living in controllers instead of Application handlers, Domain entities leaking through API responses, Application code depending on concrete Infrastructure types, and missing dependency-inversion registration at the composition root. Outputs findings with pilot-dotnet clean-architecture standard IDs.
when_to_use: clean architecture, layering violation, dependency direction, domain layer, application layer, infrastructure layer, fat controller, business logic in controller, DTO mapping, entity leaking, dependency inversion, composition root, Program.cs registration, onion architecture
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| CA-001 | P0 | Domain project references EF Core / ASP.NET Core / infrastructure NuGet packages |
| CA-002 | P1 | Controller/endpoint contains business logic instead of delegating to Application layer |
| CA-003 | P1 | Domain entity returned directly from an API endpoint instead of a DTO |
| CA-004 | P1 | Application layer references a concrete Infrastructure implementation directly |
| CA-005 | P2 | Interface defined in inner layer has no corresponding DI registration in the composition root |

---

## Check A — Domain layer dependency-direction violation

### Detection

1. Open the `Domain` project's `.csproj` and list every `<PackageReference>` and `<ProjectReference>`.
2. Flag any reference to `Microsoft.EntityFrameworkCore*`, `Microsoft.AspNetCore.*`, `System.Data.SqlClient`, `Microsoft.Data.SqlClient`, or a `ProjectReference` pointing at the `Infrastructure` or `Api` project.
3. The Domain layer must depend on nothing but the base class library (and possibly a tiny "SharedKernel" project).

### BAD — Domain.csproj referencing EF Core

```xml
<!-- src/Domain/Domain.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore" Version="8.0.0" />
  </ItemGroup>
</Project>
```

```csharp
// src/Domain/Entities/Order.cs
using Microsoft.EntityFrameworkCore; // Domain now knows about EF Core

public class Order
{
    public int Id { get; private set; }
    public decimal Total { get; private set; }

    [NotMapped] // EF attribute leaking into the domain model
    public bool IsDirty { get; set; }
}
```

### GOOD — Domain has zero infrastructure references

```xml
<!-- src/Domain/Domain.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <!-- No PackageReference to EF Core, ASP.NET Core, or any infrastructure package -->
</Project>
```

```csharp
// src/Domain/Entities/Order.cs
namespace FullStack.Pilot.Domain.Entities;

public class Order
{
    public int Id { get; private set; }
    public decimal Total { get; private set; }

    public void ApplyDiscount(decimal percentage)
    {
        if (percentage is < 0 or > 100)
        {
            throw new ArgumentOutOfRangeException(nameof(percentage));
        }

        Total -= Total * (percentage / 100m);
    }
}
```

Entity configuration (`EntityTypeConfiguration`, `HasQueryFilter`, `[NotMapped]`, etc.) belongs in
the `Infrastructure` project's `IEntityTypeConfiguration<Order>` implementation, not on the entity itself.

---

## Check B — Business logic in controllers/endpoints

### Detection

1. Grep controller action bodies and minimal API lambda handlers for direct `DbContext` usage,
   multi-step branching/validation logic, or calls chaining more than 2-3 repository/service methods.
2. A controller action should be a thin translator: bind request → invoke one Application-layer
   call → map result to an `IActionResult`/`Results<T>`. Anything more → CA-002.

### BAD — controller doing validation, calculation, and persistence

```csharp
[HttpPost]
public async Task<IActionResult> CreateOrder(CreateOrderRequest request)
{
    if (request.Items.Count == 0)
    {
        return BadRequest("Order must have at least one item.");
    }

    var total = request.Items.Sum(i => i.Price * i.Quantity);
    if (total > 10_000m)
    {
        total *= 0.95m; // bulk discount business rule, buried in the controller
    }

    var order = new Order { Total = total, CreatedAtUtc = DateTime.UtcNow };
    _dbContext.Orders.Add(order);
    await _dbContext.SaveChangesAsync();

    return Ok(order);
}
```

### GOOD — controller delegates to an Application-layer handler

```csharp
[HttpPost]
public async Task<IActionResult> CreateOrder(
    CreateOrderRequest request,
    [FromServices] ICommandHandler<CreateOrderCommand, OrderDto> handler,
    CancellationToken cancellationToken)
{
    var command = new CreateOrderCommand(request.Items);
    var result = await handler.HandleAsync(command, cancellationToken);

    return result.IsSuccess
        ? CreatedAtAction(nameof(GetOrder), new { id = result.Value.Id }, result.Value)
        : BadRequest(result.Error);
}
```

```csharp
// Application/Orders/CreateOrderCommandHandler.cs
public class CreateOrderCommandHandler : ICommandHandler<CreateOrderCommand, OrderDto>
{
    private readonly IOrderRepository _orderRepository;

    public CreateOrderCommandHandler(IOrderRepository orderRepository)
        => _orderRepository = orderRepository;

    public async Task<Result<OrderDto>> HandleAsync(CreateOrderCommand command, CancellationToken ct)
    {
        if (command.Items.Count == 0)
        {
            return Result<OrderDto>.Failure("Order must have at least one item.");
        }

        var order = Order.Create(command.Items); // business rule lives on/near the domain model
        await _orderRepository.AddAsync(order, ct);

        return Result<OrderDto>.Success(OrderDto.FromDomain(order));
    }
}
```

---

## Check C — Domain entities leaking through API responses

### Detection

1. Grep controller/minimal API return statements for `return Ok(entity)` or `Results.Ok(entity)`
   where `entity` is a type declared in the `Domain` namespace/project.
2. Any Domain type appearing as the generic argument of `ActionResult<T>`, or as the object passed
   to `Ok(...)`/`Results.Ok(...)`, without an intermediate DTO mapping → CA-003.

### BAD — EF-tracked domain entity serialized directly to the client

```csharp
[HttpGet("{id:int}")]
public async Task<ActionResult<Order>> GetOrder(int id)
{
    var order = await _dbContext.Orders
        .Include(o => o.Customer)
        .FirstOrDefaultAsync(o => o.Id == id);

    return order is null ? NotFound() : Ok(order); // leaks navigation props, EF shadow state
}
```

### GOOD — mapped to a response DTO

```csharp
public sealed record OrderResponse(int Id, decimal Total, string CustomerName);

[HttpGet("{id:int}")]
public async Task<ActionResult<OrderResponse>> GetOrder(int id, CancellationToken ct)
{
    var order = await _orderQueryService.GetByIdAsync(id, ct);
    if (order is null)
    {
        return NotFound();
    }

    return Ok(new OrderResponse(order.Id, order.Total, order.CustomerName));
}
```

---

## Check D — Application layer depending on concrete Infrastructure types

### Detection

1. In the `Application` project, grep `using` directives and constructor parameters for
   `Infrastructure.*` concrete class names (e.g. `SqlOrderRepository`, `SendGridEmailSender`)
   instead of interfaces (`IOrderRepository`, `IEmailSender`).
2. Any constructor/method parameter typed as a concrete Infrastructure class → CA-004.

### BAD — Application handler new's up / depends on a concrete Infrastructure class

```csharp
// Application project referencing Infrastructure concrete type directly
using FullStack.Pilot.Infrastructure.Persistence;

public class GetOrderQueryHandler
{
    private readonly SqlOrderRepository _repository; // concrete Infrastructure type

    public GetOrderQueryHandler()
    {
        _repository = new SqlOrderRepository(new AppDbContext()); // manual construction
    }

    public Task<OrderDto?> HandleAsync(int orderId)
        => _repository.GetByIdAsync(orderId);
}
```

### GOOD — Application depends only on an abstraction it owns

```csharp
// Application/Orders/IOrderRepository.cs
namespace FullStack.Pilot.Application.Orders;

public interface IOrderRepository
{
    Task<Order?> GetByIdAsync(int id, CancellationToken ct = default);
    Task AddAsync(Order order, CancellationToken ct = default);
}

// Application/Orders/GetOrderQueryHandler.cs
public class GetOrderQueryHandler
{
    private readonly IOrderRepository _repository;

    public GetOrderQueryHandler(IOrderRepository repository)
        => _repository = repository;

    public async Task<OrderDto?> HandleAsync(int orderId, CancellationToken ct)
    {
        var order = await _repository.GetByIdAsync(orderId, ct);
        return order is null ? null : OrderDto.FromDomain(order);
    }
}
```

---

## Check E — Missing dependency-inversion registration

### Detection

1. For every interface defined in `Domain` or `Application` (grep `public interface I\w+`),
   search the composition root (`Program.cs`, or a `DependencyInjection.cs` extension method
   called from it) for a matching `services.AddScoped<IX, X>()` / `AddSingleton`/`AddTransient` registration.
2. If an interface has no registration found anywhere in the solution → CA-005 (it will fail at
   runtime with a DI resolution error, or worse, silently resolve to the wrong lifetime if
   registered ad hoc elsewhere).

### BAD — interface defined, never registered

```csharp
// Application/Orders/IOrderRepository.cs — defined, but...
public interface IOrderRepository
{
    Task<Order?> GetByIdAsync(int id, CancellationToken ct = default);
}
```

```csharp
// Program.cs — no registration exists anywhere; DI throws at first resolution
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlServer(connectionString));
// Missing: builder.Services.AddScoped<IOrderRepository, SqlOrderRepository>();
var app = builder.Build();
```

### GOOD — explicit registration at the composition root

```csharp
// Infrastructure/DependencyInjection.cs
public static class InfrastructureServiceCollectionExtensions
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<AppDbContext>(o =>
            o.UseSqlServer(configuration.GetConnectionString("Default")));

        services.AddScoped<IOrderRepository, SqlOrderRepository>();
        services.AddScoped<IEmailSender, SendGridEmailSender>();

        return services;
    }
}
```

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddApplication(); // registers handlers, validators, etc.
var app = builder.Build();
```
