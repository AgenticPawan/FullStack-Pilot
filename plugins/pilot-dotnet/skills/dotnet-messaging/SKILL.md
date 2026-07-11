---
name: dotnet-messaging
description: Reviews Service Bus/Event Grid topology and consumer design beyond dotnet-outbox-pattern's atomic publish. Flags no message schema versioning, competing-consumer concurrency breaking required ordering, payloads embedding full domain entities instead of minimal versioned contracts, queue-vs-topic mismatched to fan-out, and no correlation/trace context in envelopes. Outputs pilot-dotnet messaging standard IDs.
when_to_use: Service Bus topology, Event Grid, message schema versioning, message contract, competing consumers, session-enabled queue, partition key ordering, topic vs queue, fan-out, message envelope, correlation ID, trace context, pub/sub design, ServiceBusProcessor prefetch
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| MSG-001 | P1 | No message schema versioning/compatibility contract between publisher and consumers |
| MSG-002 | P0 | Competing-consumers concurrency/prefetch breaks required message ordering |
| MSG-003 | P2 | Message payload embeds a full domain entity instead of a minimal versioned event contract |
| MSG-004 | P2 | Queue vs. topic choice mismatched to the actual fan-out need |
| MSG-005 | P1 | No correlation ID/W3C trace-context propagated in the message envelope |

---

## Check A — No message schema versioning contract (MSG-001)

### Detection

Grep event/message contract classes for any versioning convention (a `Version` field, a
type-name suffix like `V2`, or a documented additive-only-changes policy). Without one, a
publisher renaming or removing a field on a shared contract silently breaks every deployed
consumer that deserializes it — there's no compiler or CI signal, only a runtime
`JsonException` or a silently-null field in production, often discovered only after the
publisher has already redeployed and consumers start failing.

### BAD — contract changed with no compatibility discipline

```csharp
// v1, deployed and consumed by three services
public record OrderPlacedEvent(Guid OrderId, string CustomerEmail, decimal Total);

// Publisher renames CustomerEmail -> ContactEmail in the same type, redeploys.
// Every consumer still deserializing "CustomerEmail" gets null with no build-time warning.
public record OrderPlacedEvent(Guid OrderId, string ContactEmail, decimal Total);
```

### GOOD — additive-only changes plus an explicit contract version

```csharp
public record OrderPlacedEventV1(Guid OrderId, string CustomerEmail, decimal Total);

// New field added additively; old field kept for one deprecation window instead of renamed/removed
public record OrderPlacedEventV2(Guid OrderId, string CustomerEmail, string? ContactEmail, decimal Total)
{
    public const string SchemaVersion = "2.0";
}

// Consumers read a version header from the message envelope and select the matching
// deserialization path; breaking changes ship as a new subscription, not a silent field swap.
```

---

## Check B — Concurrency/prefetch settings break required ordering (MSG-002)

### Detection

Check `ServiceBusProcessor` configuration (`MaxConcurrentCalls`, `PrefetchCount`) against
whether the business process actually requires strict per-entity ordering (e.g. all events
for one order must be processed in sequence). Plain competing-consumers with concurrency > 1
processes messages for the *same* entity on different threads in parallel — there is no
guarantee `StockReserved` is handled before `PaymentCharged` if both arrive close together.
Azure Service Bus sessions (or a partition key discipline) are required to serialize
processing per logical entity while still allowing concurrency across different entities.

### BAD — high concurrency on a queue whose messages must be processed in order

```csharp
var processor = client.CreateProcessor("order-events-queue", new ServiceBusProcessorOptions
{
    MaxConcurrentCalls = 16, // 16 threads can pick up different events for the SAME order
    PrefetchCount = 50
});
processor.ProcessMessageAsync += async args => await Handle(args.Message); // no ordering guarantee
```

### GOOD — session-enabled queue serializes per-order, parallelizes across orders

```csharp
var processor = client.CreateSessionProcessor("order-events-queue", new ServiceBusSessionProcessorOptions
{
    MaxConcurrentSessions = 16,     // up to 16 different orders processed in parallel...
    MaxConcurrentCallsPerSession = 1 // ...but exactly one message at a time within one order's session
});
processor.ProcessMessageAsync += async args => await Handle(args.Message);

// Publisher sets SessionId = orderId.ToString() on every message for that order,
// guaranteeing FIFO delivery within the session.
```

---

## Check C — Payload embeds a full domain entity (MSG-003)

### Detection

Grep message contracts for direct reuse of an EF Core entity class or a type that carries
navigation properties, internal-only fields, or anything beyond what the consumer actually
needs. Publishing the internal domain model directly means every consumer is now coupled to
the publisher's internal schema — any refactor of the entity (renamed column, added
navigation property, EF proxy serialization quirks) can break every subscriber, even ones
that only needed one field.

### BAD — the EF Core entity itself is serialized onto the bus

```csharp
public class Order // EF Core entity: navigation properties, internal audit fields, etc.
{
    public Guid Id { get; set; }
    public Customer Customer { get; set; }      // navigation property — pulls in unrelated schema
    public List<OrderLine> Lines { get; set; }
    public string InternalWarehouseNotes { get; set; }
}

await _sender.SendMessageAsync(new ServiceBusMessage(
    BinaryData.FromObjectAsJson(order))); // consumers now depend on the full internal shape
```

### GOOD — a minimal, explicitly-versioned event contract

```csharp
public record OrderPlacedEvent(
    string SchemaVersion,
    Guid OrderId,
    Guid CustomerId,
    decimal Total,
    DateTime OccurredAt);

var evt = new OrderPlacedEvent("1.0", order.Id, order.CustomerId, order.Total, DateTime.UtcNow);
await _sender.SendMessageAsync(new ServiceBusMessage(BinaryData.FromObjectAsJson(evt)));
// Consumers depend only on this small public contract, not the publisher's internal entity graph.
```

---

## Check D — Queue vs. topic mismatched to fan-out need (MSG-004)

### Detection

Check how many independent consumers process the same logical event. A plain Service Bus
*queue* delivers each message to exactly one competing consumer — if multiple unrelated
consumers (e.g. Billing, Notifications, Analytics) all need every `OrderPlaced` event, they
end up fighting over the same queue and stealing each other's messages. A Service Bus
*topic* with one subscription per consumer (or Event Grid with multiple event subscriptions)
delivers an independent copy of every message to each subscriber — the correct shape for
one-event-many-consumers fan-out.

### BAD — three unrelated consumers all competing on one queue

```csharp
// Billing, Notifications, and Analytics services all created processors against the SAME queue,
// so each OrderPlaced message is delivered to whichever one happens to receive it first —
// the other two never see it at all.
var billingProcessor = client.CreateProcessor("order-placed-queue");
var notifyProcessor = client.CreateProcessor("order-placed-queue");
var analyticsProcessor = client.CreateProcessor("order-placed-queue");
```

### GOOD — topic with one subscription per independent consumer

```csharp
// Publisher sends once to the topic:
await _sender.SendMessageAsync(new ServiceBusMessage(payload)); // topic: "order-placed"

// Each consumer owns its own subscription and gets a full independent copy of every message:
var billingProcessor = client.CreateProcessor("order-placed", "billing-subscription");
var notifyProcessor = client.CreateProcessor("order-placed", "notifications-subscription");
var analyticsProcessor = client.CreateProcessor("order-placed", "analytics-subscription");
```

---

## Check E — No correlation ID/trace-context in the message envelope (MSG-005)

### Detection

Grep message-sending code for whether `ServiceBusMessage.ApplicationProperties` (or the
Event Grid event's `traceparent` extension attribute) carries a correlation ID or W3C
`traceparent`. Without it, the moment a call crosses from synchronous HTTP (which
`Activity`/`DiagnosticSource` traces automatically via `traceparent` headers) into async
messaging, the distributed trace breaks — Application Insights shows the HTTP request and
the eventual message-triggered work as two unrelated, un-correlated operations.

### BAD — message sent with no correlation/trace metadata

```csharp
var message = new ServiceBusMessage(BinaryData.FromObjectAsJson(evt));
await _sender.SendMessageAsync(message);
// The consumer's Application Insights operation has no link back to the HTTP request that caused it.
```

### GOOD — correlation ID and W3C trace-context propagated on the envelope

```csharp
var message = new ServiceBusMessage(BinaryData.FromObjectAsJson(evt))
{
    CorrelationId = Activity.Current?.RootId ?? Guid.NewGuid().ToString()
};
message.ApplicationProperties["traceparent"] = Activity.Current?.Id;

await _sender.SendMessageAsync(message);

// Consumer starts its own Activity as a child, linked via the propagated traceparent,
// so App Insights (see azure-observability) stitches the HTTP request and message handling together.
```
