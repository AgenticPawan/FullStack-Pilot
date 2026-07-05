---
name: dotnet-notifications
description: Reviews SMS and push notification delivery in ASP.NET Core, distinct from dotnet-email-service's email-only scope. Flags provider SDKs called directly instead of behind an INotificationSender abstraction, synchronous send-in-request-path calls blocking on external providers instead of queuing, no retry/backoff for transient failures, per-channel opt-out logic bolted on with no shared preference store, no delivery-status tracking for compliance/debugging, and PII exposed in visible push payloads instead of a minimal fetch-on-open pattern. Outputs findings with pilot-dotnet notifications standard IDs.
when_to_use: SMS notification, push notification, Twilio, Firebase Cloud Messaging, APNs, notification preference, opt out, delivery status, notification queue, INotificationSender, notification retry, transactional SMS, push payload PII
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| NOTIF-001 | P1 | SMS/push logic calls a provider SDK directly instead of behind an `INotificationSender` abstraction |
| NOTIF-002 | P1 | Notification send happens synchronously in the request path instead of being queued |
| NOTIF-003 | P1 | No retry/backoff for transient provider failures |
| NOTIF-004 | P2 | No unified notification-preference model — each channel implements opt-out independently with no shared store |
| NOTIF-005 | P2 | No delivery-status tracking (sent/delivered/failed/opted-out) surfaced for compliance or debugging |
| NOTIF-006 | P1 | Push payload carries PII/sensitive content in the visible banner instead of a minimal notification + fetch-on-open pattern |

---

## Check A — Provider SDK called directly instead of an abstraction (NOTIF-001)

### Detection

1. Grep controllers, command handlers, and background jobs for direct references to
   `TwilioClient`, `FirebaseMessaging`, `SnsClient`, or similar provider SDK types outside of
   a single dedicated infrastructure implementation.
2. This mirrors dotnet-email-service's `IEmailSender` guidance: the application layer should
   depend on an `INotificationSender` (or per-channel `ISmsSender` / `IPushSender`) interface,
   with the concrete provider swapped behind DI. Flag NOTIF-001 when a handler new's up or
   calls a provider client directly.

### BAD — Twilio SDK called straight from a command handler

```csharp
public class ApproveOrderCommandHandler : IRequestHandler<ApproveOrderCommand, Result>
{
    public async Task<Result> Handle(ApproveOrderCommand cmd, CancellationToken ct)
    {
        // ...approval logic...

        var twilio = new TwilioRestClient(_accountSid, _authToken); // provider SDK, no abstraction
        await MessageResource.CreateAsync(
            body: $"Order {cmd.OrderId} approved",
            from: new PhoneNumber(_fromNumber),
            to: new PhoneNumber(customer.PhoneNumber));

        return Result.Success();
    }
}
```

### GOOD — abstraction hides the provider, mirrors IEmailSender

```csharp
public interface INotificationSender
{
    Task SendAsync(NotificationMessage message, CancellationToken ct);
}

public class TwilioSmsSender : INotificationSender
{
    private readonly ITwilioRestClient _client;

    public async Task SendAsync(NotificationMessage message, CancellationToken ct)
    {
        await MessageResource.CreateAsync(
            body: message.Body,
            from: new PhoneNumber(_fromNumber),
            to: new PhoneNumber(message.Recipient),
            client: _client);
    }
}

public class ApproveOrderCommandHandler : IRequestHandler<ApproveOrderCommand, Result>
{
    private readonly INotificationSender _notificationSender;

    public async Task<Result> Handle(ApproveOrderCommand cmd, CancellationToken ct)
    {
        // ...approval logic...
        await _notificationSender.SendAsync(
            new NotificationMessage(customer.PhoneNumber, $"Order {cmd.OrderId} approved"), ct);
        return Result.Success();
    }
}
```

---

## Check B — Synchronous send blocks the request path (NOTIF-002)

### Detection

1. Check whether a controller/handler `await`s a notification send directly in the same
   request that performs the primary business operation, versus enqueuing a job for a
   background worker to pick up (ties to dotnet-background-jobs / dotnet-outbox-pattern).
2. A provider outage or slow API call under this pattern makes the primary operation's
   response latency dependent on an unrelated third party, or fails the whole request when
   only the notification leg failed. Flag NOTIF-002.

### BAD — request thread blocks on the SMS provider

```csharp
[HttpPost("{id:int}/ship")]
public async Task<IActionResult> Ship(int id)
{
    await _orderService.MarkShippedAsync(id);
    await _notificationSender.SendAsync(new NotificationMessage(customerPhone, "Your order shipped!"));
    // If the SMS provider is slow or down, this endpoint hangs or 500s for an unrelated reason.
    return NoContent();
}
```

### GOOD — notification enqueued, sent out-of-band

```csharp
[HttpPost("{id:int}/ship")]
public async Task<IActionResult> Ship(int id)
{
    await _orderService.MarkShippedAsync(id);
    await _outbox.EnqueueAsync(new SendNotificationMessage(customerPhone, "Your order shipped!"));
    // Background worker (Hangfire/Quartz/outbox dispatcher) sends it independently of this request.
    return NoContent();
}
```

---

## Check C — No retry/backoff for transient provider failures (NOTIF-003)

### Detection

1. Check the notification sender's HTTP client / SDK call for a resilience pipeline
   (Polly retry with exponential backoff, or the built-in `HttpClient` resilience handler)
   around transient errors (5xx, timeouts, rate-limit 429s).
2. If a single failed attempt is treated as a permanent failure with no retry, flag NOTIF-003
   — ties to dotnet-resilience for the shared retry-policy pattern.

### BAD — one attempt, no retry

```csharp
public async Task SendAsync(NotificationMessage message, CancellationToken ct)
{
    var response = await _httpClient.PostAsJsonAsync("/v1/messages", message, ct);
    response.EnsureSuccessStatusCode(); // a single 503 from the provider drops the notification
}
```

### GOOD — Polly retry with exponential backoff around transient failures

```csharp
builder.Services.AddHttpClient<INotificationSender, ProviderNotificationSender>()
    .AddResilienceHandler("notifications-retry", pipeline =>
    {
        pipeline.AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 3,
            BackoffType = DelayBackoffType.Exponential,
            ShouldHandle = args => ValueTask.FromResult(
                args.Outcome.Result?.StatusCode is HttpStatusCode.ServiceUnavailable
                    or HttpStatusCode.TooManyRequests
                    or HttpStatusCode.GatewayTimeout)
        });
    });
```

---

## Check D — No unified notification-preference model (NOTIF-004)

### Detection

1. Check whether SMS, push, and email opt-out/opt-in state live in one shared preference
   store keyed by (user, notification type, channel), versus each channel maintaining its
   own bolt-on flag (`user.SmsOptOut`, a separate `PushSubscription.Enabled`, and email
   handled by a third mechanism entirely).
2. Flag NOTIF-004 when a user cannot see or manage all channel preferences for a given
   notification type (e.g., "order shipped") in one place, or when adding a new channel
   requires a new ad-hoc column/table instead of a new row in the shared model.

### BAD — each channel bolts on its own opt-out flag

```csharp
public class User
{
    public bool SmsOptOut { get; set; }        // SMS-specific, bolted on
    public bool PushDisabled { get; set; }     // push-specific, different naming, bolted on
    // Email opt-out lives in a totally separate EmailSubscription table with its own shape.
}
```

### GOOD — shared preference model across channels and notification types

```csharp
public class NotificationPreference
{
    public Guid UserId { get; set; }
    public string NotificationType { get; set; } = default!; // e.g. "order.shipped"
    public NotificationChannel Channel { get; set; }          // Sms | Push | Email
    public bool IsEnabled { get; set; }
}

public class NotificationDispatcher
{
    public async Task DispatchAsync(string notificationType, Guid userId, NotificationContent content)
    {
        var enabledChannels = await _preferenceStore.GetEnabledChannelsAsync(userId, notificationType);
        foreach (var channel in enabledChannels)
        {
            await _senders[channel].SendAsync(content, CancellationToken.None);
        }
    }
}
```

---

## Check E — No delivery-status tracking (NOTIF-005)

### Detection

1. Check whether a sent notification's outcome (accepted-by-provider, delivered, failed,
   or skipped-due-to-opt-out) is persisted anywhere queryable, versus fire-and-forget with
   no record beyond an application log line.
2. Flag NOTIF-005 when support/compliance has no way to answer "did this user receive the
   fraud alert SMS on this date" without grepping logs, and when provider delivery-receipt
   webhooks (Twilio status callbacks, FCM delivery receipts) are not wired to update a
   persisted status.

### BAD — send-and-forget, no persisted outcome

```csharp
public async Task SendAsync(NotificationMessage message, CancellationToken ct)
{
    await _client.PostAsJsonAsync("/v1/messages", message, ct);
    // No record of whether this succeeded, failed, or was even attempted — only an app log line.
}
```

### GOOD — outcome persisted, provider delivery callback updates status

```csharp
public async Task SendAsync(NotificationMessage message, CancellationToken ct)
{
    var record = new NotificationDeliveryRecord
    {
        Id = Guid.NewGuid(),
        UserId = message.UserId,
        NotificationType = message.NotificationType,
        Channel = message.Channel,
        Status = NotificationDeliveryStatus.Sending
    };
    await _deliveryStore.SaveAsync(record, ct);

    var response = await _client.PostAsJsonAsync("/v1/messages", message, ct);
    record.Status = response.IsSuccessStatusCode
        ? NotificationDeliveryStatus.Sent
        : NotificationDeliveryStatus.Failed;
    record.ProviderMessageId = await response.Content.ReadFromJsonAsync<SendResult>()
        is { } result ? result.MessageId : null;
    await _deliveryStore.UpdateAsync(record, ct);
}

// Provider webhook updates the same record to Delivered/Undelivered when the callback arrives.
[HttpPost("webhooks/twilio/status")]
public async Task<IActionResult> TwilioStatusCallback([FromForm] TwilioStatusPayload payload)
{
    await _deliveryStore.UpdateStatusByProviderIdAsync(payload.MessageSid, payload.MessageStatus);
    return Ok();
}
```

---

## Check F — PII in visible push payload instead of fetch-on-open (NOTIF-006)

### Detection

1. Grep push-notification payload construction for sensitive content placed directly in the
   `title`/`body` fields shown in the OS notification banner — account balances, full names
   paired with medical/financial detail, one-time passcodes, or order contents.
2. A push banner is visible on a locked screen and often synced to other devices; flag
   NOTIF-006 when sensitive detail is in the banner instead of a generic notification that
   triggers the app to fetch the real content once opened and authenticated.

### BAD — sensitive account detail sent straight into the push banner

```csharp
var message = new Message
{
    Notification = new Notification
    {
        Title = "Payment received",
        Body = $"${payment.Amount} deposited into account ...{account.LastFour}. New balance: ${account.Balance}"
        // Visible on a locked screen, synced to notification history on every device.
    },
    Token = deviceToken
};
await _fcm.SendAsync(message);
```

### GOOD — minimal banner, real content fetched in-app after unlock

```csharp
var message = new Message
{
    Notification = new Notification
    {
        Title = "New activity on your account",
        Body = "Tap to view details"
    },
    Data = new Dictionary<string, string>
    {
        ["type"] = "payment.received",
        ["referenceId"] = payment.Id.ToString() // opaque reference only, no amount/balance
    },
    Token = deviceToken
};
await _fcm.SendAsync(message);

// App opens, authenticates, then calls GET /api/payments/{referenceId} to fetch the real detail.
```
