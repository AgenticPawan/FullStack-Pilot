---
name: dotnet-email-service
description: Reviews transactional email sending in ASP.NET Core APIs. Flags email logic scattered inline instead of behind an IEmailSender abstraction, synchronous send-in-request-path blocking on external providers, duplicated HTML template branding instead of a shared layout, missing retry/backoff around transient provider failures, missing plain-text fallback parts, and unencoded user data interpolated into HTML templates (injection risk). Outputs findings with pilot-dotnet email-service standard IDs.
when_to_use: transactional email, email sender, SMTP, SendGrid, IEmailSender, email queue, background email, email retry, Polly email, HTML email template, email layout, multipart alternative, plain text fallback, email injection, email templating
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| EM-001 | P2 | Email-sending logic inline in controllers/handlers instead of behind `IEmailSender` |
| EM-002 | P1 | Email sent synchronously in the request path instead of queued/backgrounded |
| EM-003 | P2 | HTML template duplicates header/footer/branding instead of a shared layout |
| EM-004 | P1 | No retry/backoff policy around transient email-provider failures |
| EM-005 | P2 | Missing plain-text fallback (multipart/alternative) alongside HTML body |
| EM-006 | P0 | User-supplied data interpolated into HTML email template without encoding |

---

## Check A — `IEmailSender` abstraction instead of inline provider calls

### Detection

1. Grep controllers/handlers for direct instantiation of `SmtpClient`, `SendGridClient`,
   or similar provider SDK types.
2. If provider-specific types appear outside an `IEmailSender` implementation → EM-001.

### BAD — SendGrid called directly from a controller

```csharp
[ApiController]
[Route("api/orders")]
public class OrdersController(SendGridClient sendGrid) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> CreateOrder(CreateOrderRequest request)
    {
        var order = await _orderService.CreateAsync(request);

        var msg = MailHelper.CreateSingleEmail(
            new EmailAddress("orders@acme.com"),
            new EmailAddress(order.CustomerEmail),
            "Order confirmed",
            plainTextContent: null,
            htmlContent: $"<p>Your order {order.Id} is confirmed.</p>");
        await sendGrid.SendEmailAsync(msg); // provider detail leaks into controller

        return Ok(order);
    }
}
```

### GOOD — behind an `IEmailSender` abstraction

```csharp
public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken ct = default);
}

public record EmailMessage(string To, string Subject, string HtmlBody, string? PlainTextBody = null);

public class SendGridEmailSender(SendGridClient client) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var msg = MailHelper.CreateSingleEmail(
            new EmailAddress("orders@acme.com"),
            new EmailAddress(message.To),
            message.Subject,
            message.PlainTextBody,
            message.HtmlBody);
        await client.SendEmailAsync(msg, ct);
    }
}

[ApiController]
[Route("api/orders")]
public class OrdersController(IOrderService orderService, IEmailQueue emailQueue) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> CreateOrder(CreateOrderRequest request)
    {
        var order = await orderService.CreateAsync(request);
        await emailQueue.EnqueueOrderConfirmationAsync(order); // see Check B
        return Ok(order);
    }
}
```

---

## Check B — Queuing email sends instead of blocking the request path

### Detection

1. Find request handlers that `await` an `IEmailSender.SendAsync` (or provider SDK call)
   directly in the HTTP request path, with no queue/background dispatch in between.
2. Flag EM-002 — a slow or failing provider call delays or fails the caller's response
   for something that doesn't need to be synchronous.

### BAD — email send blocks the HTTP response

```csharp
[HttpPost]
public async Task<IActionResult> CreateOrder(CreateOrderRequest request)
{
    var order = await _orderService.CreateAsync(request);
    await _emailSender.SendAsync(new EmailMessage(
        order.CustomerEmail, "Order confirmed", $"<p>Order {order.Id} confirmed.</p>"));
    // If the SMTP/API call is slow or times out, the client waits or the request fails
    // even though the order itself was created successfully.
    return Ok(order);
}
```

### GOOD — enqueued to a background channel, processed by a hosted service

```csharp
public interface IEmailQueue
{
    Task EnqueueOrderConfirmationAsync(Order order, CancellationToken ct = default);
}

public class ChannelEmailQueue(Channel<EmailMessage> channel) : IEmailQueue
{
    public async Task EnqueueOrderConfirmationAsync(Order order, CancellationToken ct = default)
    {
        var message = new EmailMessage(
            order.CustomerEmail, "Order confirmed", $"<p>Order {order.Id} confirmed.</p>");
        await channel.Writer.WriteAsync(message, ct);
    }
}

public class EmailDispatchBackgroundService(
    Channel<EmailMessage> channel,
    IEmailSender sender,
    ILogger<EmailDispatchBackgroundService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var message in channel.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await sender.SendAsync(message, stoppingToken); // retry policy applied inside sender, see Check D
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to send email to {Recipient}", message.To);
            }
        }
    }
}
```

---

## Check C — Shared layout instead of duplicated branding markup

### Detection

1. Compare HTML template files under `EmailTemplates/` (or similar) for repeated
   header/footer/logo/color markup copy-pasted across templates.
2. Flag EM-003 when two or more templates duplicate the same branding block instead of
   rendering through a shared layout with a body placeholder.

### BAD — every template repeats the full branding chrome

```html
<!-- OrderConfirmation.cshtml -->
<html><body style="font-family: Arial;">
  <div style="background:#0033A0;color:#fff;padding:16px;">
    <img src="cid:logo" height="32" /> <span>Acme Corp</span>
  </div>
  <div style="padding:24px;">
    <p>Your order @Model.OrderId is confirmed.</p>
  </div>
  <div style="color:#888;font-size:12px;padding:16px;">© Acme Corp. All rights reserved.</div>
</body></html>

<!-- PasswordReset.cshtml -->
<html><body style="font-family: Arial;">
  <div style="background:#0033A0;color:#fff;padding:16px;">
    <img src="cid:logo" height="32" /> <span>Acme Corp</span>
  </div>
  <div style="padding:24px;">
    <p>Click <a href="@Model.ResetLink">here</a> to reset your password.</p>
  </div>
  <div style="color:#888;font-size:12px;padding:16px;">© Acme Corp. All rights reserved.</div>
</body></html>
```

### GOOD — shared Razor layout with a body placeholder

```html
<!-- _EmailLayout.cshtml -->
<html><body style="font-family: Arial;">
  <div style="background:#0033A0;color:#fff;padding:16px;">
    <img src="cid:logo" height="32" /> <span>Acme Corp</span>
  </div>
  <div style="padding:24px;">
    @RenderBody()
  </div>
  <div style="color:#888;font-size:12px;padding:16px;">© Acme Corp. All rights reserved.</div>
</body></html>
```

```html
<!-- OrderConfirmation.cshtml -->
@{ Layout = "_EmailLayout"; }
<p>Your order @Model.OrderId is confirmed.</p>
```

```html
<!-- PasswordReset.cshtml -->
@{ Layout = "_EmailLayout"; }
<p>Click <a href="@Model.ResetLink">here</a> to reset your password.</p>
```

---

## Check D — Retry/backoff policy for transient provider failures

### Detection

1. Look at `IEmailSender` implementations for direct provider calls with no surrounding
   resilience pipeline (e.g., `Polly`, `Microsoft.Extensions.Resilience`).
2. Flag EM-004 when a transient failure (timeout, 429/5xx, network blip) results in an
   unhandled exception or silent drop rather than a bounded retry with backoff and a
   final failure log/dead-letter path.

### BAD — no retry, transient failure silently swallowed or unhandled

```csharp
public class SendGridEmailSender(SendGridClient client) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var msg = MailHelper.CreateSingleEmail(
            new EmailAddress("orders@acme.com"), new EmailAddress(message.To),
            message.Subject, message.PlainTextBody, message.HtmlBody);
        await client.SendEmailAsync(msg, ct); // one shot — a 429 or transient timeout is fatal
    }
}
```

### GOOD — Polly resilience pipeline with exponential backoff and dead-letter logging

```csharp
public class ResilientEmailSender(
    SendGridClient client,
    ResiliencePipeline pipeline, // registered via AddResiliencePipeline with retry + backoff
    IEmailDeadLetterStore deadLetterStore,
    ILogger<ResilientEmailSender> logger) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        try
        {
            await pipeline.ExecuteAsync(async token =>
            {
                var msg = MailHelper.CreateSingleEmail(
                    new EmailAddress("orders@acme.com"), new EmailAddress(message.To),
                    message.Subject, message.PlainTextBody, message.HtmlBody);
                var response = await client.SendEmailAsync(msg, token);
                if ((int)response.StatusCode >= 500 || (int)response.StatusCode == 429)
                    throw new TransientEmailException($"Provider returned {response.StatusCode}");
            }, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Email to {Recipient} failed after retries", message.To);
            await deadLetterStore.SaveAsync(message, ex.Message, ct);
        }
    }
}

// Registration:
// services.AddResiliencePipeline("email", builder => builder
//     .AddRetry(new RetryStrategyOptions
//     {
//         ShouldHandle = new PredicateBuilder().Handle<TransientEmailException>(),
//         BackoffType = DelayBackoffType.Exponential,
//         MaxRetryAttempts = 3,
//         Delay = TimeSpan.FromSeconds(2)
//     }));
```

---

## Check E — Plain-text fallback alongside HTML body

### Detection

1. Check every call site constructing an `EmailMessage`/provider mail object for whether
   a plain-text part is supplied alongside the HTML body.
2. Flag EM-005 when only an HTML body is set (`plainTextContent: null` or omitted) —
   some clients and spam filters penalize HTML-only, no-plain-text emails.

### BAD — HTML-only, no plain-text alternative

```csharp
var message = new EmailMessage(
    To: order.CustomerEmail,
    Subject: "Order confirmed",
    HtmlBody: $"<p>Your order {order.Id} is confirmed.</p>",
    PlainTextBody: null); // spam filters and text-only clients get nothing
```

### GOOD — both parts supplied, generated from one source template

```csharp
public static class EmailTextExtractor
{
    // Strips tags to derive a reasonable plain-text fallback from the rendered HTML.
    public static string ToPlainText(string html) =>
        Regex.Replace(WebUtility.HtmlDecode(Regex.Replace(html, "<[^>]+>", " ")), @"\s+", " ").Trim();
}

var html = $"<p>Your order {order.Id} is confirmed.</p>";
var message = new EmailMessage(
    To: order.CustomerEmail,
    Subject: "Order confirmed",
    HtmlBody: html,
    PlainTextBody: EmailTextExtractor.ToPlainText(html));
```

---

## Check F — Encoding user-supplied data in HTML email templates

### Detection

1. Grep email templates/builders for string interpolation of user-controlled fields
   (names, addresses, free-text notes, subject lines) directly into raw HTML without
   `HtmlEncoder`/Razor's automatic encoding.
2. Flag EM-006 (P0) — an attacker-controlled name or note field could inject markup or
   script that renders in the recipient's or an internal reviewer's mail client/webmail.

### BAD — raw string concatenation of user input into HTML

```csharp
public string BuildWelcomeEmail(string customerName)
{
    // customerName comes straight from a signup form
    return $"<html><body><h1>Welcome, {customerName}!</h1></body></html>";
    // customerName = "<img src=x onerror=alert(1)>" renders as live markup in some clients
}
```

### GOOD — encoded before interpolation (or rendered via Razor, which encodes by default)

```csharp
using System.Text.Encodings.Web;

public string BuildWelcomeEmail(string customerName)
{
    var safeName = HtmlEncoder.Default.Encode(customerName);
    return $"<html><body><h1>Welcome, {safeName}!</h1></body></html>";
}
```

```html
<!-- Welcome.cshtml — Razor HTML-encodes @Model.CustomerName automatically -->
@{ Layout = "_EmailLayout"; }
<h1>Welcome, @Model.CustomerName!</h1>
```
