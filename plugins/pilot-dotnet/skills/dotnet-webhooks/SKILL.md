---
name: dotnet-webhooks
description: Reviews outbound webhook delivery to third-party subscribers in ASP.NET Core — distinct from dotnet-outbox-pattern's internal domain-event messaging. Flags payloads sent with no HMAC signature, no retry/backoff policy for a failing subscriber endpoint, no delivery-attempt log or dead-letter handling for a permanently-down subscriber, no replay-attack protection, subscriber-provided callback URLs not validated against SSRF, and no way for a subscriber to rotate their signing secret without downtime. Outputs findings with pilot-dotnet webhooks standard IDs.
when_to_use: webhook, outbound webhook, HMAC signature, webhook signing secret, webhook retry, dead letter webhook, webhook delivery log, SSRF callback URL, subscriber endpoint, replay attack webhook, signing secret rotation, webhook subscriber
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| WH-001 | P0 | Webhook payload sent with no HMAC signature over the body |
| WH-002 | P0 | No retry/backoff policy — one failed delivery attempt loses the event |
| WH-003 | P1 | No delivery-attempt log / dead-letter handling for a permanently-down subscriber |
| WH-004 | P1 | No replay-attack protection (timestamp+nonce or delivery-ID uniqueness) |
| WH-005 | P0 | Subscriber-provided callback URL not validated against SSRF risk |
| WH-006 | P2 | No way for a subscriber to rotate their signing secret without downtime |

---

## Check A — Webhook payload sent with no signature (WH-001)

### Detection

Grep the outbound delivery code for whether a signature header (`X-Webhook-Signature` or
similar) is computed and attached before the HTTP call. Without an HMAC computed with a
per-subscriber secret, the receiving endpoint has no way to distinguish a genuine delivery
from this system from an attacker who simply POSTs a forged payload to the same URL.

### BAD — payload posted with no way for the receiver to verify authenticity

```csharp
public async Task DeliverAsync(WebhookSubscription subscription, OrderCreatedEvent evt)
{
    var json = JsonSerializer.Serialize(evt);
    await _httpClient.PostAsync(subscription.CallbackUrl,
        new StringContent(json, Encoding.UTF8, "application/json"));
    // Receiver has no signature to check — anyone who knows the URL can forge this event.
}
```

### GOOD — HMAC-SHA256 signature computed with the subscriber's own secret

```csharp
public async Task DeliverAsync(WebhookSubscription subscription, OrderCreatedEvent evt)
{
    var json = JsonSerializer.Serialize(evt);
    var signature = ComputeHmac(json, subscription.SigningSecret);

    var request = new HttpRequestMessage(HttpMethod.Post, subscription.CallbackUrl)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
    request.Headers.Add("X-Webhook-Signature", $"sha256={signature}");

    await _httpClient.SendAsync(request);
}

private static string ComputeHmac(string payload, string secret)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
}
```

---

## Check B — No retry/backoff policy for a failing subscriber (WH-002)

### Detection

Check the delivery call for whether a transient failure (timeout, 5xx, connection refused)
is retried at all, or whether one failed HTTP call simply drops the event permanently. A
subscriber's endpoint having a few minutes of downtime should not mean they silently miss
every event that occurred during that window.

### BAD — single delivery attempt, no retry on failure

```csharp
public async Task DeliverAsync(WebhookSubscription subscription, string signedPayload)
{
    var response = await _httpClient.PostAsync(subscription.CallbackUrl, BuildContent(signedPayload));
    // response.IsSuccessStatusCode is never checked — a 500 or timeout just loses the event.
}
```

### GOOD — exponential backoff retry via a resilience pipeline

```csharp
private static readonly ResiliencePipeline<HttpResponseMessage> RetryPipeline =
    new ResiliencePipelineBuilder<HttpResponseMessage>()
        .AddRetry(new RetryStrategyOptions<HttpResponseMessage>
        {
            MaxRetryAttempts = 5,
            BackoffType = DelayBackoffType.Exponential,
            Delay = TimeSpan.FromSeconds(30),
            ShouldHandle = args => ValueTask.FromResult(
                args.Outcome.Exception is not null ||
                (int)args.Outcome.Result!.StatusCode >= 500)
        })
        .Build();

public async Task DeliverAsync(WebhookSubscription subscription, string signedPayload)
{
    var response = await RetryPipeline.ExecuteAsync(async ct =>
        await _httpClient.PostAsync(subscription.CallbackUrl, BuildContent(signedPayload), ct));

    if (!response.IsSuccessStatusCode)
        await _deliveryQueue.ScheduleRetryAsync(subscription.Id, signedPayload); // ties into Check C
}
```

---

## Check C — No delivery-attempt log / dead-letter handling (WH-003)

### Detection

Check whether every delivery attempt (success or failure, with status code and timestamp)
is persisted somewhere queryable, and whether a subscriber whose endpoint stays down past the
retry budget gets moved to a dead-letter state instead of being retried forever or dropped
silently. Without a log, there is no way to answer "did subscriber X receive event Y" when
they report a discrepancy; without dead-lettering, a permanently-broken subscriber either
consumes retry capacity indefinitely or the failure is never surfaced to anyone.

### BAD — no record of attempts, exhausted retries vanish with no trace

```csharp
public async Task DeliverAsync(WebhookSubscription subscription, string signedPayload)
{
    var response = await RetryPipeline.ExecuteAsync(async ct =>
        await _httpClient.PostAsync(subscription.CallbackUrl, BuildContent(signedPayload), ct));
    // No row written anywhere — if all retries fail, the event is gone with no record it ever existed.
}
```

### GOOD — every attempt logged; exhausted subscribers dead-lettered and surfaced

```csharp
public async Task DeliverAsync(WebhookSubscription subscription, WebhookDelivery delivery)
{
    var attempt = new DeliveryAttempt { DeliveryId = delivery.Id, AttemptedAt = DateTime.UtcNow };

    try
    {
        var response = await RetryPipeline.ExecuteAsync(async ct =>
            await _httpClient.PostAsync(subscription.CallbackUrl, BuildContent(delivery.SignedPayload), ct));

        attempt.StatusCode = (int)response.StatusCode;
        attempt.Succeeded = response.IsSuccessStatusCode;
    }
    catch (Exception ex)
    {
        attempt.Succeeded = false;
        attempt.Error = ex.Message;
    }

    await _db.DeliveryAttempts.AddAsync(attempt);

    if (!attempt.Succeeded && delivery.AttemptCount >= MaxAttempts)
    {
        delivery.Status = DeliveryStatus.DeadLettered; // surfaced to an ops dashboard / alert
    }

    await _db.SaveChangesAsync();
}
```

---

## Check D — No replay-attack protection (WH-004)

### Detection

Check the delivered payload/headers for a timestamp and nonce (or a unique delivery ID the
receiver is expected to de-duplicate on), and check the signature computation for whether it
covers that timestamp. Without either, a captured request (from a compromised log, a proxy,
or a man-in-the-middle before TLS termination) can be replayed to the subscriber's endpoint
at any later time and will still pass signature verification.

### BAD — signature covers only the body; a captured request is replayable forever

```csharp
var signature = ComputeHmac(json, subscription.SigningSecret); // no timestamp or nonce included
request.Headers.Add("X-Webhook-Signature", $"sha256={signature}");
// A copy of this exact request, replayed a year later, produces an identical valid signature.
```

### GOOD — timestamp + delivery ID included in the signed payload

```csharp
var deliveryId = Guid.NewGuid();
var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
var signedContent = $"{timestamp}.{deliveryId}.{json}";
var signature = ComputeHmac(signedContent, subscription.SigningSecret);

request.Headers.Add("X-Webhook-Timestamp", timestamp.ToString());
request.Headers.Add("X-Webhook-Delivery-Id", deliveryId.ToString());
request.Headers.Add("X-Webhook-Signature", $"sha256={signature}");

// Receiver-side contract (documented for subscribers): reject if timestamp is older than
// 5 minutes, and reject if delivery-id has already been processed (dedup store).
```

---

## Check E — Subscriber callback URL not validated against SSRF (WH-005)

### Detection

Grep the subscription-registration endpoint for whether a client-supplied `callbackUrl` is
validated against internal/link-local address ranges before being persisted, and whether the
delivery code re-resolves and re-checks the DNS result at send time (to prevent DNS-rebinding
between registration and delivery). Accepting any URL a subscriber provides turns this
system's own outbound delivery worker into an SSRF proxy against internal infrastructure.

### BAD — any URL accepted at registration and dialed at delivery time with no checks

```csharp
[HttpPost("webhook-subscriptions")]
public async Task<IActionResult> Subscribe(SubscribeDto dto)
{
    await _db.WebhookSubscriptions.AddAsync(new WebhookSubscription { CallbackUrl = dto.CallbackUrl });
    await _db.SaveChangesAsync();
    return Ok();
    // dto.CallbackUrl could be http://169.254.169.254/latest/meta-data or an internal admin host.
}
```

### GOOD — validated at registration, re-validated at delivery time

```csharp
[HttpPost("webhook-subscriptions")]
public async Task<IActionResult> Subscribe(SubscribeDto dto)
{
    if (!await IsSafeCallbackUrlAsync(dto.CallbackUrl))
        return BadRequest("Callback URL must be a public HTTPS host.");

    await _db.WebhookSubscriptions.AddAsync(new WebhookSubscription { CallbackUrl = dto.CallbackUrl });
    await _db.SaveChangesAsync();
    return Ok();
}

private async Task<bool> IsSafeCallbackUrlAsync(string url)
{
    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https")
        return false;

    var addresses = await Dns.GetHostAddressesAsync(uri.Host);
    return addresses.All(addr => !IsPrivateOrLinkLocal(addr)); // re-check DNS again at send time, not just here
}
```

---

## Check F — No secret rotation without downtime (WH-006)

### Detection

Check the subscription schema and signing code for whether only a single active secret per
subscriber is supported. A subscriber that wants to rotate a leaked secret then has to
choose between an outage (old secret pulled before the new one is deployed on their side) or
staying on a known-compromised secret while they coordinate the swap.

### BAD — one secret column, no overlap window during rotation

```csharp
public class WebhookSubscription
{
    public string SigningSecret { get; set; } // rotating this immediately invalidates in-flight deliveries the subscriber hasn't redeployed to verify yet
}
```

### GOOD — dual-secret overlap window during rotation

```csharp
public class WebhookSubscription
{
    public string PrimarySecret { get; set; } = default!;
    public string? SecondarySecret { get; set; } // set during rotation, removed once subscriber confirms
}

private bool VerifyEitherSecret(string payload, string signature, WebhookSubscription sub)
{
    return signature == ComputeHmac(payload, sub.PrimarySecret) ||
           (sub.SecondarySecret is not null && signature == ComputeHmac(payload, sub.SecondarySecret));
}

// Rotation flow: set SecondarySecret to the new value, sign new deliveries with the new
// secret as PrimarySecret only once the subscriber confirms verification works, then null out
// SecondarySecret. Deliveries during the overlap window verify against either secret.
```

This delivery pipeline is entirely separate from `dotnet-outbox-pattern`'s internal
domain-event dispatch — the outbox guarantees at-least-once handoff to *this system's own*
consumers, while webhook delivery here is a best-effort, retried, logged handoff to
*third-party* subscribers who each hold their own signing secret.
