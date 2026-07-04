---
name: dotnet-outbox-pattern
description: Reviews distributed-messaging conventions once a Clean Architecture solution starts publishing domain events to Service Bus/Event Grid. Flags a message published directly inside the same transaction as the business write with no transactional outbox, message consumers that aren't idempotent despite at-least-once delivery, no dead-letter handling for poison messages, and outbox rows never cleaned up after successful publish. Outputs findings with pilot-dotnet outbox-pattern standard IDs.
when_to_use: outbox pattern, transactional outbox, domain event publishing, Service Bus, Event Grid, idempotent consumer, dead letter queue, message deduplication, at-least-once delivery, distributed transaction, eventual consistency
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| OUT-001 | P0 | Message published directly inside the business transaction with no transactional outbox |
| OUT-002 | P1 | Consumer not idempotent despite at-least-once delivery |
| OUT-003 | P1 | No dead-letter handling for poison messages |
| OUT-004 | P2 | Outbox rows never cleaned up after successful publish |

---

## Check A — Message published without a transactional outbox (OUT-001)

### Detection

Grep code that calls `_db.SaveChangesAsync()` and then, in a separate step, publishes a
message to Service Bus/Event Grid. If the process crashes between the two calls, the DB
commit succeeds but the message never sends (or vice versa if publish happens first) — a
classic dual-write inconsistency. The fix is the transactional outbox pattern: write the
message to an `OutboxMessages` table in the *same* database transaction as the business
change, then a separate dispatcher publishes it and marks it sent.

### BAD — dual write with no atomicity guarantee

```csharp
public async Task ApproveOrderAsync(Guid orderId)
{
    var order = await _db.Orders.FindAsync(orderId);
    order!.Status = OrderStatus.Approved;
    await _db.SaveChangesAsync();               // commit succeeds...

    await _serviceBusSender.SendMessageAsync(    // ...but the process crashes here, and no
        new ServiceBusMessage(new OrderApprovedEvent(orderId))); // OrderApproved event is ever sent
}
```

### GOOD — outbox row written in the same transaction, dispatched separately

```csharp
public async Task ApproveOrderAsync(Guid orderId)
{
    await using var transaction = await _db.Database.BeginTransactionAsync();

    var order = await _db.Orders.FindAsync(orderId);
    order!.Status = OrderStatus.Approved;

    _db.OutboxMessages.Add(new OutboxMessage
    {
        Id = Guid.NewGuid(),
        Type = nameof(OrderApprovedEvent),
        Payload = JsonSerializer.Serialize(new OrderApprovedEvent(orderId)),
        CreatedAt = DateTime.UtcNow
    });

    await _db.SaveChangesAsync();
    await transaction.CommitAsync(); // order status change and outbox row commit atomically
}

// A separate background dispatcher (Hangfire recurring job — see dotnet-background-jobs)
// polls OutboxMessages for unsent rows, publishes them, and marks PublishedAt.
```

---

## Check B — Consumer not idempotent (OUT-002)

### Detection

Service Bus/Event Grid guarantee at-least-once delivery — the same message can be
delivered twice (after a lock-renewal timeout, a retry after a transient failure). Check
whether the message handler is safe to process twice (a dedupe check against a processed-
message-ID table) or performs a non-idempotent side effect unconditionally.

### BAD — handler re-applies the event on redelivery

```csharp
public async Task Handle(OrderApprovedEvent evt)
{
    await _inventoryService.ReserveStockAsync(evt.OrderId); // redelivery = stock reserved twice
}
```

### GOOD — dedupe against a processed-message-ID ledger

```csharp
public async Task Handle(OrderApprovedEvent evt, string messageId)
{
    if (await _db.ProcessedMessages.AnyAsync(m => m.MessageId == messageId))
        return; // already handled this exact delivery

    await _inventoryService.ReserveStockAsync(evt.OrderId);
    _db.ProcessedMessages.Add(new ProcessedMessage { MessageId = messageId, ProcessedAt = DateTime.UtcNow });
    await _db.SaveChangesAsync();
}
```

---

## Check C — No dead-letter handling (OUT-003)

### Detection

Check whether the Service Bus subscription/queue has `MaxDeliveryCount` configured and
whether the consumer (or a separate monitor) actually inspects the dead-letter sub-queue.
A poison message (one that always throws, e.g. due to a schema mismatch) without
dead-lettering retries forever, burning throughput and hiding the fact that a message is
permanently stuck.

### BAD — no dead-letter monitoring, poison messages retry silently forever

```csharp
var processor = client.CreateProcessor("order-approved-queue");
processor.ProcessMessageAsync += async args =>
{
    await Handle(args.Message); // if this always throws, MaxDeliveryCount default (10) dead-letters it,
    await args.CompleteMessageAsync(args.Message); // but nothing ever looks at the dead-letter queue
};
```

### GOOD — dead-letter queue actively monitored/alerted

```csharp
var deadLetterReceiver = client.CreateReceiver("order-approved-queue", new ServiceBusReceiverOptions
{
    SubQueue = SubQueue.DeadLetter
});

// A recurring job (dotnet-background-jobs) checks the dead-letter queue depth and alerts
// (ties to azure-observability AOBS-003) if messages accumulate there.
```

---

## Check D — Outbox rows never cleaned up (OUT-004)

### Detection

Check whether the outbox dispatcher deletes/archives rows after successful publish, or
whether `OutboxMessages` grows unbounded — an ever-growing table both slows the dispatcher's
polling query and defeats using the same table for audit/replay purposes if it's never
pruned to a manageable retention window.

### BAD — outbox table grows forever

```csharp
public async Task DispatchPendingAsync()
{
    var pending = await _db.OutboxMessages.Where(m => m.PublishedAt == null).ToListAsync();
    foreach (var msg in pending)
    {
        await _sender.SendMessageAsync(new ServiceBusMessage(msg.Payload));
        msg.PublishedAt = DateTime.UtcNow; // row stays in the table forever
    }
    await _db.SaveChangesAsync();
}
```

### GOOD — published rows pruned after a retention window

```csharp
public async Task DispatchPendingAsync()
{
    var pending = await _db.OutboxMessages.Where(m => m.PublishedAt == null).ToListAsync();
    foreach (var msg in pending)
    {
        await _sender.SendMessageAsync(new ServiceBusMessage(msg.Payload));
        msg.PublishedAt = DateTime.UtcNow;
    }
    await _db.SaveChangesAsync();
}

// Separate recurring job (dotnet-background-jobs), scheduled nightly:
public async Task PruneOldOutboxRowsAsync()
{
    var cutoff = DateTime.UtcNow.AddDays(-7);
    await _db.OutboxMessages.Where(m => m.PublishedAt < cutoff).ExecuteDeleteAsync();
}
```
