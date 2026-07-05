---
name: dotnet-saga-orchestration
description: Reviews distributed-transaction design once a business process spans multiple independently-owned services/databases. Flags an ambient/distributed DB transaction attempted across service boundaries with no true coordinator, a saga step that can fail after prior steps committed with no compensating action, saga state kept only in memory instead of persisted, and a choreography-based saga with no shared correlation ID across its event chain. Outputs findings with pilot-dotnet saga-orchestration standard IDs.
when_to_use: saga pattern, distributed transaction, compensating action, compensating transaction, orchestration-based saga, choreography-based saga, two-phase commit, 2PC, saga state machine, MassTransit saga, correlation ID, distributed business process, eventual consistency across services
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| SAGA-001 | P0 | Multi-service transaction attempted via ambient/distributed DB transaction across service boundaries |
| SAGA-002 | P0 | Saga step can fail after prior steps committed with no compensating action defined |
| SAGA-003 | P1 | Saga progress/state kept only in memory instead of persisted |
| SAGA-004 | P1 | Choreography-based saga with no shared correlation ID across its event chain |

---

## Check A — Ambient distributed transaction across service boundaries (SAGA-001)

### Detection

Grep for `TransactionScope`/`System.Transactions` enlisting two separate `DbContext`
instances backed by different, independently-owned databases in one ambient transaction.
This doesn't reliably work across service boundaries — there is no real 2PC coordinator,
cloud-hosted SQL often rejects MSDTC promotion, and even when it works it holds
cross-network locks for the whole call. The fix is a saga: each service commits its own
local transaction, with a coordinator driving compensating actions instead.

### BAD — TransactionScope spanning two independently-owned databases

```csharp
public async Task PlaceOrderAsync(Guid customerId, OrderRequest request)
{
    using var scope = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled);

    await _ordersDb.Orders.AddAsync(new Order(customerId, request.Items));
    await _ordersDb.SaveChangesAsync(); // Orders service's own database

    await _billingDb.Invoices.AddAsync(new Invoice(customerId, request.Total));
    await _billingDb.SaveChangesAsync(); // Billing service's database — different service, different DB

    scope.Complete(); // relies on MSDTC promotion; fails outright on many managed SQL offerings
                       // and holds cross-service locks for the whole request duration
}
```

### GOOD — orchestrated saga with independent local commits and compensation

```csharp
public class PlaceOrderSaga
{
    public async Task<SagaResult> RunAsync(Guid customerId, OrderRequest request)
    {
        var order = await _orderService.CreateOrderAsync(customerId, request.Items); // local commit #1
        try
        {
            await _billingService.CreateInvoiceAsync(customerId, request.Total); // local commit #2
        }
        catch (Exception)
        {
            await _orderService.CancelOrderAsync(order.Id); // compensating action for step #1
            return SagaResult.Failed("Billing step failed; order compensated");
        }
        return SagaResult.Succeeded(order.Id);
    }
}
// Each service commits its own local transaction; no cross-database ambient transaction exists.
```

---

## Check B — Missing compensating action (SAGA-002)

### Detection

Trace each step and ask: "if this fails, what undoes the steps that already committed?" A
step failing after prior steps committed, with no compensating action, leaves the process
permanently half-applied — stock reserved and payment charged, but shipping never
scheduled, with nothing releasing the stock or refunding the payment. Look for saga classes
implementing only the forward path with no `Compensate`/`Undo` handler per step.

### BAD — shipping step fails, but stock and payment are never rolled back

```csharp
public async Task<SagaResult> RunAsync(OrderRequest request)
{
    await _inventoryService.ReserveStockAsync(request.Items);   // step 1: committed
    await _paymentService.ChargeAsync(request.CustomerId, request.Total); // step 2: committed

    await _shippingService.ScheduleShipmentAsync(request.OrderId); // step 3: throws
    // no catch, no compensation — stock stays reserved forever, customer stays charged,
    // and no shipment is ever scheduled
    return SagaResult.Succeeded(request.OrderId);
}
```

### GOOD — every step paired with an explicit compensating action

```csharp
public async Task<SagaResult> RunAsync(OrderRequest request)
{
    var completed = new Stack<Func<Task>>();
    try
    {
        await _inventoryService.ReserveStockAsync(request.Items);
        completed.Push(() => _inventoryService.ReleaseStockAsync(request.Items));

        await _paymentService.ChargeAsync(request.CustomerId, request.Total);
        completed.Push(() => _paymentService.RefundAsync(request.CustomerId, request.Total));

        await _shippingService.ScheduleShipmentAsync(request.OrderId);
        return SagaResult.Succeeded(request.OrderId);
    }
    catch (Exception ex)
    {
        while (completed.TryPop(out var compensate))
            await compensate(); // undo already-committed steps in reverse order
        return SagaResult.Failed(ex.Message);
    }
}
```

---

## Check C — Saga state kept only in memory (SAGA-003)

### Detection

Grep for saga coordinators backed by a `static Dictionary<Guid, SagaState>` or any state
machine living purely on the heap with no database row behind it. A long-running saga
spanning multiple async steps must survive a restart or deployment — if state is only in
memory, a crash mid-saga loses track of which steps completed, and compensation can never
run because nothing remembers the saga existed.

### BAD — in-memory dictionary is the only record of in-flight sagas

```csharp
public class OrderSagaCoordinator
{
    private static readonly Dictionary<Guid, OrderSagaState> _inFlight = new(); // lost on restart/crash

    public void Start(Guid orderId) => _inFlight[orderId] = new OrderSagaState { Step = SagaStep.StockReserved };

    public void Advance(Guid orderId, SagaStep step) => _inFlight[orderId].Step = step;
}
```

### GOOD — saga state persisted in the database, survives restarts

```csharp
public class OrderSagaCoordinator
{
    private readonly SagaDbContext _db;

    public async Task StartAsync(Guid orderId)
    {
        _db.SagaInstances.Add(new SagaInstance
        {
            Id = orderId, CurrentStep = SagaStep.StockReserved, UpdatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(); // durable row survives process crash/restart
    }

    public async Task AdvanceAsync(Guid orderId, SagaStep step)
    {
        var instance = await _db.SagaInstances.FindAsync(orderId);
        instance!.CurrentStep = step;
        instance.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }
    // A recovery job on startup re-hydrates any SagaInstance not in a terminal state
    // and resumes/compensates it — see dotnet-outbox-pattern for the dispatcher this mirrors.
}
```

---

## Check D — No correlation ID across a choreography-based saga (SAGA-004)

### Detection

For choreography-based sagas (a chain of domain events, each service publishing the next —
no central orchestrator), check whether every event carries a shared correlation ID.
Without it, once `OrderPlaced` → `StockReserved` → `PaymentCharged` fan out across
independent services, there is no way to reconstruct which events belong to the same saga
instance — debugging a stuck process becomes manual cross-service log-grepping (see
dotnet-cqrs for the command/event split this builds on).

### BAD — each event carries only its own new ID, no shared correlation

```csharp
public record StockReservedEvent(Guid EventId, Guid OrderId, DateTime OccurredAt);

public async Task Handle(OrderPlacedEvent evt)
{
    await _inventoryService.ReserveStockAsync(evt.OrderId);
    // no field ties this event back to OrderPlaced or the overall saga instance
    await _bus.PublishAsync(new StockReservedEvent(Guid.NewGuid(), evt.OrderId, DateTime.UtcNow));
}
```

### GOOD — a shared correlation ID propagated through every event in the chain

```csharp
public record StockReservedEvent(Guid EventId, Guid CorrelationId, Guid OrderId, DateTime OccurredAt);

public async Task Handle(OrderPlacedEvent evt)
{
    await _inventoryService.ReserveStockAsync(evt.OrderId);
    await _bus.PublishAsync(new StockReservedEvent(
        Guid.NewGuid(), evt.CorrelationId, evt.OrderId, DateTime.UtcNow)); // CorrelationId propagated
}
// Every log line/trace span for this saga instance is tagged with CorrelationId, so
// `WHERE CorrelationId = @id` reconstructs the full end-to-end chain.
```
