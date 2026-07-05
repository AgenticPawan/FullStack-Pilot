---
name: dotnet-cqrs
description: Reviews CQRS/MediatR command-query separation as its own architectural discipline, distinct from dotnet-validation's pipeline-behavior focus. Flags query handlers that mutate state, commands that return large read models instead of an identifier/minimal result, fat handlers mixing orchestration with business logic that belongs in the domain layer, and commands/queries missing a consistent cross-cutting pipeline (logging, validation, transaction) applied uniformly. Outputs findings with pilot-dotnet cqrs standard IDs.
when_to_use: CQRS, MediatR, IRequest, IRequestHandler, command handler, query handler, command query separation, fat handler, pipeline behavior, read model, write model, thin controller
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| CQR-001 | P0 | Query handler mutates state (writes to the database, publishes events) |
| CQR-002 | P2 | Command returns a large read model instead of an identifier/minimal result |
| CQR-003 | P1 | Fat handler mixes orchestration with business logic that belongs in the domain layer |
| CQR-004 | P2 | Commands/queries don't share a consistent cross-cutting pipeline (logging, validation, transaction) |

---

## Check A — Query handler mutates state (CQR-001)

### Detection

Grep handlers implementing `IRequestHandler<TQuery, TResult>` where the query's name/intent
is read-only (`GetOrderQuery`, `SearchCustomersQuery`) for any `_db.SaveChangesAsync()`,
`Add`/`Update`/`Remove` call, or event publish inside the handler body. A "query" that
mutates breaks the core CQRS guarantee that reads are side-effect-free and safely
repeatable/cacheable — a caller (or a retry, or a prefetch) can trigger writes just by
reading.

### BAD — a query silently updates a "last viewed" timestamp

```csharp
public class GetOrderQueryHandler : IRequestHandler<GetOrderQuery, OrderDto>
{
    public async Task<OrderDto> Handle(GetOrderQuery request, CancellationToken ct)
    {
        var order = await _db.Orders.FindAsync(request.OrderId);
        order!.LastViewedAt = DateTime.UtcNow; // a write, hidden inside a "query"
        await _db.SaveChangesAsync(ct);
        return _mapper.Map<OrderDto>(order);
    }
}
```

### GOOD — the query only reads; the write is its own explicit command

```csharp
public class GetOrderQueryHandler : IRequestHandler<GetOrderQuery, OrderDto>
{
    public async Task<OrderDto> Handle(GetOrderQuery request, CancellationToken ct) =>
        await _mapper.ProjectTo<OrderDto>(_db.Orders.Where(o => o.Id == request.OrderId))
            .FirstOrDefaultAsync(ct) ?? throw new NotFoundException();
}

// tracking "last viewed" is an explicit, separately-dispatched command if the business actually needs it
public record RecordOrderViewedCommand(Guid OrderId) : IRequest;
```

---

## Check B — Command returns a large read model (CQR-002)

### Detection

Grep `IRequestHandler<TCommand, TResult>` where `TResult` is a full read DTO with nested
collections, rather than the created/affected identifier (or a minimal acknowledgment). A
command's job is to change state; if the caller needs the resulting read model, that's a
separate query dispatched right after — conflating the two makes the command's cost and
purpose unclear and couples the write path to read-side shaping concerns.

### BAD — command returns the full order graph, doing double duty as a query

```csharp
public class CreateOrderCommandHandler : IRequestHandler<CreateOrderCommand, OrderDetailDto>
{
    public async Task<OrderDetailDto> Handle(CreateOrderCommand request, CancellationToken ct)
    {
        var order = ...;
        await _db.SaveChangesAsync(ct);
        return await _mapper.ProjectTo<OrderDetailDto>(
            _db.Orders.Include(o => o.LineItems).Where(o => o.Id == order.Id)).FirstAsync(ct); // a query, wearing a command's clothes
    }
}
```

### GOOD — command returns the identifier; caller queries separately if it needs the read model

```csharp
public class CreateOrderCommandHandler : IRequestHandler<CreateOrderCommand, Guid>
{
    public async Task<Guid> Handle(CreateOrderCommand request, CancellationToken ct)
    {
        var order = Order.Create(request.CustomerId, request.LineItems);
        _db.Orders.Add(order);
        await _db.SaveChangesAsync(ct);
        return order.Id;
    }
}

// controller, if the client needs the detail view
var orderId = await _mediator.Send(new CreateOrderCommand(...));
var detail = await _mediator.Send(new GetOrderDetailQuery(orderId));
```

---

## Check C — Fat handler mixing orchestration with business logic (CQR-003)

### Detection

Grep command handlers for business-rule logic (discount calculation, state-transition
rules, eligibility checks) implemented inline in the handler body instead of delegated to
the domain entity/domain service, per `dotnet-clean-architecture`'s layering. The handler's
job is orchestration (load aggregate, call domain method, persist, publish); business rules
belong on the aggregate so they're enforced no matter which handler/caller touches it.

### BAD — discount and eligibility rules live inside the MediatR handler

```csharp
public async Task<Guid> Handle(ApplyDiscountCommand request, CancellationToken ct)
{
    var order = await _db.Orders.FindAsync(request.OrderId);
    if (order!.Total < 100) throw new InvalidOperationException("Order too small for a discount");
    if (order.Customer.LoyaltyTier == LoyaltyTier.Gold) order.Total *= 0.9m;
    else if (order.Customer.LoyaltyTier == LoyaltyTier.Silver) order.Total *= 0.95m;
    await _db.SaveChangesAsync(ct);
    return order.Id;
}
```

### GOOD — handler orchestrates; the domain entity owns the rule

```csharp
// Domain/Order.cs
public void ApplyLoyaltyDiscount()
{
    if (Total < 100) throw new OrderTooSmallForDiscountException(Id);
    Total *= Customer.LoyaltyTier switch { LoyaltyTier.Gold => 0.9m, LoyaltyTier.Silver => 0.95m, _ => 1m };
}

// Application/ApplyDiscountCommandHandler.cs
public async Task<Guid> Handle(ApplyDiscountCommand request, CancellationToken ct)
{
    var order = await _db.Orders.Include(o => o.Customer).FirstAsync(o => o.Id == request.OrderId, ct);
    order.ApplyLoyaltyDiscount(); // rule lives on the aggregate, reusable and independently testable
    await _db.SaveChangesAsync(ct);
    return order.Id;
}
```

---

## Check D — No consistent cross-cutting pipeline (CQR-004)

### Detection

Confirm every command/query flows through the same `IPipelineBehavior<,>` stack (logging,
`dotnet-validation`'s `ValidationBehavior`, transaction wrapping for commands) rather than
individual handlers manually logging or wrapping their own `TransactionScope`. An
inconsistent pipeline means some commands are transactional and some aren't, for no reason
a reviewer can see from the handler alone.

### BAD — one handler manually wraps a transaction, another doesn't, no shared behavior

```csharp
public async Task<Guid> Handle(CreateOrderCommand request, CancellationToken ct)
{
    using var tx = await _db.Database.BeginTransactionAsync(ct); // this handler remembers to do it
    ...
    await tx.CommitAsync(ct);
}

// a different command handler, same kind of multi-write operation, no transaction at all
public async Task<Guid> Handle(CancelOrderCommand request, CancellationToken ct)
{
    _db.Orders.Remove(order);
    await _refundService.IssueAsync(order.Id); // if this throws, the removal already committed
    return order.Id;
}
```

### GOOD — a shared behavior wraps every command in a transaction uniformly

```csharp
public class TransactionBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : ICommand<TResponse>  // marker interface distinguishes commands from queries
{
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken ct)
    {
        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        var response = await next();
        await tx.CommitAsync(ct);
        return response;
    }
}

builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>)); // dotnet-validation
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(TransactionBehavior<,>)); // every command, uniformly
```

---

## CQRS checklist

- [ ] No query handler writes to the database or publishes events
- [ ] Commands return an identifier/minimal result, not a full read DTO — read models come from a separate query
- [ ] Business rules live on the domain entity/domain service, not inline in the MediatR handler
- [ ] Every command/query passes through the same pipeline-behavior stack (logging, validation, transaction) — no handler manually reimplements cross-cutting concerns
- [ ] A marker interface (`ICommand<T>` vs `IQuery<T>`) makes the read/write distinction visible to pipeline behaviors and reviewers alike
