---
id: always-idempotent-consumers
title: Message / Event Consumers Must Be Idempotent
appliesTo: dotnet
severity: block
standard: reliability
---
Every consumer of a message bus (Azure Service Bus, Event Grid, MassTransit, NServiceBus)
or webhook MUST tolerate receiving the same message more than once without corrupting
application state. At-least-once delivery is the contract — exactly-once is never guaranteed.

**Idempotency patterns (choose one per consumer):**

### 1. Deduplication by message ID (preferred)
```csharp
public async Task Consume(ConsumeContext<OrderPlaced> ctx)
{
    if (await _db.ProcessedMessages.AnyAsync(m => m.MessageId == ctx.MessageId, ctx.CancellationToken))
        return;  // already handled

    // ... process order ...

    _db.ProcessedMessages.Add(new ProcessedMessage { MessageId = ctx.MessageId });
    await _db.SaveChangesAsync(ctx.CancellationToken);
}
```

Store `ProcessedMessage` in the same DbContext transaction as the domain mutation so
commit-without-processing and process-without-commit are both impossible.

### 2. Upsert on natural key
```csharp
// INSERT INTO ... WHERE NOT EXISTS is idempotent by design
await _db.Database.ExecuteSqlRawAsync(
    "IF NOT EXISTS (SELECT 1 FROM Orders WHERE ExternalId = {0}) INSERT INTO Orders (...) VALUES (...)",
    order.ExternalId, ...);
```

### 3. State-machine guard
```csharp
if (order.Status != OrderStatus.Pending)
    return;  // idempotent — only allowed state transition
```

**Anti-patterns that break idempotency:**
- Inserting a row without a unique constraint (produces duplicates on retry)
- Sending an outbound notification inside the consumer without a deduplication check
  (user receives the same email twice)
- Incrementing a counter without atomic deduplication

**Detection hints (for reviewers):**
- Consumer class has no deduplication check near the entry point
- `_db.Add()` without a prior existence check or a `UNIQUE` constraint on the inserted
  entity's natural key
- Email/SMS send inside a consumer without an idempotency guard

Cross-reference: `dotnet-transactional-outbox`, `dotnet-service-bus-messaging`,
`dotnet-event-grid-messaging`.
