---
name: dotnet-grpc
description: Reviews gRPC service-to-service communication in ASP.NET Core (Grpc.AspNetCore, Grpc.Net.Client) — contract versioning via .proto, streaming, interceptors, deadlines, and transport security. Flags missing client deadlines, breaking .proto field-number changes, no retry/resilience policy for transient failures, unredacted sensitive data logged via interceptors, plaintext internal traffic with no mTLS, and streaming calls with no cancellation wired to client disconnect. Outputs findings with pilot-dotnet grpc standard IDs.
when_to_use: gRPC, Grpc.AspNetCore, Grpc.Net.Client, proto file, protobuf, gRPC deadline, gRPC interceptor, server streaming, client streaming, gRPC retry policy, gRPC mTLS, CallOptions, field number breaking change
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| GRPC-001 | P0 | No deadline/timeout on a gRPC client call |
| GRPC-002 | P0 | Breaking .proto field-number change silently breaks wire compatibility |
| GRPC-003 | P1 | No retry/resilience policy for transient gRPC failures |
| GRPC-004 | P1 | Sensitive data logged via an interceptor with no redaction |
| GRPC-005 | P1 | Internal gRPC traffic runs in plaintext with no mTLS |
| GRPC-006 | P2 | Server-streaming call has no CancellationToken tied to client disconnect |

---

## Check A — No deadline on client call (GRPC-001)

### Detection

Grep gRPC client call sites for `CallOptions`/`grpcCall` invocations with no `deadline` set
and no `CancellationToken` derived from a bounded timeout. Without a deadline, a stuck or
slow downstream service (a deadlocked thread, a network partition) hangs the calling
request indefinitely — the caller's own thread pool/connection pool exhausts as more
requests pile up waiting on a service that will never respond, turning one slow dependency
into a caller-side outage.

### BAD — unbounded client call with no deadline

```csharp
var client = new OrderService.OrderServiceClient(channel);
var response = await client.GetOrderAsync(new GetOrderRequest { OrderId = orderId });
// no deadline — if the downstream service hangs, this await never returns
```

### GOOD — explicit deadline propagated on every call

```csharp
var client = new OrderService.OrderServiceClient(channel);
var deadline = DateTime.UtcNow.AddSeconds(3);

var response = await client.GetOrderAsync(
    new GetOrderRequest { OrderId = orderId },
    deadline: deadline); // call is aborted with DeadlineExceeded status after 3s

// Or centrally, via a CallCredentials/interceptor default so every call site inherits it:
services.AddGrpcClient<OrderService.OrderServiceClient>(o =>
{
    o.Address = new Uri("https://order-service.internal");
}).ConfigureChannel(c => c.Credentials = ChannelCredentials.Insecure)
  .AddInterceptor<DeadlineInterceptor>(); // injects a default deadline if the caller didn't set one
```

---

## Check B — Breaking .proto field-number change (GRPC-002)

### Detection

Diff `.proto` files between commits for a message whose field number is reused or
renumbered on an existing field, rather than reserved and a new number allocated. Protobuf
wire format identifies fields by number, not name — reusing number `2` for a different
field silently deserializes garbage on any client still running the old contract, with no
compile error and no obvious runtime exception until the data looks wrong.

### BAD — field renumbered/reused, breaking old clients silently

```protobuf
// v1 (deployed to clients already in production)
message OrderResponse {
  string order_id = 1;
  string customer_email = 2;
}

// v2 — field 2 repurposed instead of reserved
message OrderResponse {
  string order_id = 1;
  int32 line_item_count = 2; // old clients now decode this int32 as a string — silent corruption
}
```

### GOOD — old field reserved, new field gets a fresh number

```protobuf
message OrderResponse {
  string order_id = 1;
  reserved 2;
  reserved "customer_email"; // number and name permanently retired, never reused
  int32 line_item_count = 3; // new field gets its own number
}
```

---

## Check C — No retry/resilience policy (GRPC-003)

### Detection

Grep for `GrpcChannelOptions`/`ServiceConfig` with no `MethodConfig` retry policy, and no
gRPC-specific interceptor equivalent to the Polly patterns used elsewhere (see
`dotnet-resilience`). A transient failure — a brief network blip, a pod restart behind a
load balancer — surfaces directly to the caller as an unhandled `RpcException` instead of
being absorbed by a bounded retry with backoff.

### BAD — single attempt, transient failures bubble straight up

```csharp
var channel = GrpcChannel.ForAddress("https://order-service.internal");
var client = new OrderService.OrderServiceClient(channel);
var response = await client.GetOrderAsync(request); // one UNAVAILABLE and the caller fails
```

### GOOD — gRPC built-in retry policy configured on the channel

```csharp
var defaultMethodConfig = new MethodConfig
{
    Names = { MethodName.Default },
    RetryPolicy = new RetryPolicy
    {
        MaxAttempts = 3,
        InitialBackoff = TimeSpan.FromMilliseconds(200),
        MaxBackoff = TimeSpan.FromSeconds(2),
        BackoffMultiplier = 2,
        RetryableStatusCodes = { StatusCode.Unavailable, StatusCode.DeadlineExceeded }
    }
};

var channel = GrpcChannel.ForAddress("https://order-service.internal", new GrpcChannelOptions
{
    ServiceConfig = new ServiceConfig { MethodConfigs = { defaultMethodConfig } }
});
```

---

## Check D — Sensitive data logged unredacted via interceptor (GRPC-004)

### Detection

Grep custom `Interceptor` implementations that log `request.ToString()`/full message
payloads for requests carrying PII, tokens, or payment data (e.g. `AuthenticateRequest`,
`ProcessPaymentRequest`). Full-payload logging routes secrets into log aggregation systems
with far weaker access control than the service itself, the same class of leak
`dotnet-observability`/`dotnet-data-protection` flag for HTTP middleware.

### BAD — interceptor logs full request/response bodies

```csharp
public class LoggingInterceptor : Interceptor
{
    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request, ServerCallContext context, UnaryServerMethod<TRequest, TResponse> continuation)
    {
        _logger.LogInformation("gRPC call {Method}: {Request}", context.Method, request); // logs SSN, card numbers, tokens verbatim
        return await continuation(request, context);
    }
}
```

### GOOD — structured logging with an explicit redaction allow-list

```csharp
public class LoggingInterceptor : Interceptor
{
    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request, ServerCallContext context, UnaryServerMethod<TRequest, TResponse> continuation)
    {
        _logger.LogInformation("gRPC call {Method} started", context.Method); // no payload logged
        var sw = Stopwatch.StartNew();
        try
        {
            return await continuation(request, context);
        }
        finally
        {
            _logger.LogInformation("gRPC call {Method} finished in {ElapsedMs}ms", context.Method, sw.ElapsedMilliseconds);
        }
    }
}
```

---

## Check E — Internal traffic in plaintext, no mTLS (GRPC-005)

### Detection

Grep `GrpcChannel.ForAddress` calls and server Kestrel endpoint config for `http://` (not
`https://`) between internal services, or `ChannelCredentials.Insecure` used outside local
development. Plaintext internal gRPC traffic in production means any compromised host on
the same network segment can read or tamper with service-to-service calls carrying
internal tokens and data — mTLS should authenticate both ends and encrypt the channel.

### BAD — plaintext internal channel in production config

```csharp
// appsettings.Production.json points at http://order-service.internal:5000
var channel = GrpcChannel.ForAddress(configuration["OrderServiceUrl"], new GrpcChannelOptions
{
    Credentials = ChannelCredentials.Insecure // no TLS, no client cert — production traffic
});
```

### GOOD — mTLS with client certificate authentication

```csharp
var clientCert = new X509Certificate2("client.pfx", clientCertPassword);
var handler = new HttpClientHandler();
handler.ClientCertificates.Add(clientCert);

var channel = GrpcChannel.ForAddress("https://order-service.internal", new GrpcChannelOptions
{
    HttpHandler = handler // mutual TLS: server validates client cert, client validates server cert
});

// Kestrel server side (Program.cs):
builder.WebHost.ConfigureKestrel(options =>
{
    options.ConfigureHttpsDefaults(o => o.ClientCertificateMode = ClientCertificateMode.RequireCertificate);
});
```

---

## Check F — Server-streaming call with no cancellation on disconnect (GRPC-006)

### Detection

Grep server-streaming method implementations (`IServerStreamWriter<T>`) for a loop that
never checks `context.CancellationToken`. If the client disconnects (browser tab closed,
Angular component destroyed) but the server keeps pushing to the abandoned stream, the
per-call resources (DB cursor, background loop, buffered writer) leak for the lifetime of
the server process.

### BAD — streaming loop ignores the call's cancellation token

```csharp
public override async Task StreamOrderUpdates(
    StreamRequest request, IServerStreamWriter<OrderUpdate> responseStream, ServerCallContext context)
{
    while (true) // never checks context.CancellationToken — keeps running after client disconnects
    {
        var update = await _orderUpdates.NextAsync();
        await responseStream.WriteAsync(update);
    }
}
```

### GOOD — loop honors the client-disconnect cancellation token

```csharp
public override async Task StreamOrderUpdates(
    StreamRequest request, IServerStreamWriter<OrderUpdate> responseStream, ServerCallContext context)
{
    var ct = context.CancellationToken; // fires when the client disconnects or cancels
    while (!ct.IsCancellationRequested)
    {
        var update = await _orderUpdates.NextAsync(ct);
        await responseStream.WriteAsync(update, ct);
    }
}
```
