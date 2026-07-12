---
name: distributed-tracing-correlation
description: Reviews W3C traceparent correlation — the seam the per-layer observability skills each cover on one side only. Flags no traceparent from the SPA, a bespoke correlation-ID header instead of traceparent, context dropped at async boundaries, SQL/downstream calls not in the request trace, and no trace id in errors or logs. Outputs distributed-tracing-correlation standard IDs.
when_to_use: distributed tracing, trace correlation, W3C trace context, traceparent, tracestate, correlation id header, Activity ActivitySource, OpenTelemetry, Application Insights operation_Id, end to end trace, span parent child, trace propagation, async boundary trace, Service Bus trace context, Hangfire background job trace, EF Core query span, TraceId SpanId log enrichment, trace id in ProblemDetails, one user action one trace
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| DTC-001 | P1 | Angular SPA does not propagate W3C `traceparent` — backend trace has no user-origin parent |
| DTC-002 | P1 | Bespoke `X-Correlation-Id` used instead of W3C `traceparent`, so nothing auto-joins the trace |
| DTC-003 | P0 | Trace context dropped at an async boundary (messaging, background jobs) — consumer starts a new root |
| DTC-004 | P1 | SQL / downstream calls not instrumented as child spans of the request trace |
| DTC-005 | P1 | Trace id neither surfaced to the user (error response) nor enriched into logs |

Three skills each own one side of observability in isolation: `angular-telemetry` (frontend
spans/RUM), `dotnet-observability` (backend `ActivitySource`/OpenTelemetry), and
`azure-observability` (App Insights/Log Analytics). None checks that a single user action
produces **one correlated trace** flowing Angular → .NET → SQL → Azure. That seam is this
skill's job. The rule of thumb: use the **W3C standard `traceparent`** everywhere so the
platform correlates automatically — never a hand-rolled id nobody joins on.

---

## Check A — Angular SPA drops the trace origin (DTC-001)

### Detection

Check whether the Angular `HttpClient` (or its interceptor, `angular-http-resilience`) emits a
W3C `traceparent` header on outbound API calls. Without it, every backend trace starts at the
API with no parent, so you can never tie a slow/failed request back to the user action that
triggered it. `angular-telemetry` may record frontend spans, but they live in a separate trace
from the backend's.

### BAD — no trace context leaves the browser

```typescript
// api.interceptor.ts — resilience/correlation, but no distributed trace context
return next(req.clone({ setHeaders: { 'X-App-Version': version } }));
// Backend sees no traceparent → its root span has no parent → trace starts at the API.
```

### GOOD — propagate W3C traceparent (via OTel web SDK or an explicit header)

```typescript
// Emit a W3C traceparent so the .NET side continues the SAME trace.
const traceparent = `00-${traceId}-${spanId}-01`;
return next(req.clone({ setHeaders: { traceparent } }));
// .NET's ASP.NET Core instrumentation reads traceparent automatically and parents its span.
```

---

## Check B — Bespoke correlation id instead of W3C traceparent (DTC-002)

### Detection

Look for a hand-rolled `X-Correlation-Id`/`X-Request-Id` that the backend logs but that the
tracing backend (App Insights / OTel) never joins on. You end up with two identifiers — the
bespoke one in logs and the real trace id in the tracing store — and neither gives a complete
picture. Standardize on `traceparent`; if a human-friendly id is also wanted, derive it from
the trace id, don't invent a parallel one.

### BAD — parallel identifiers that never meet

```csharp
var correlationId = Request.Headers["X-Correlation-Id"].FirstOrDefault() ?? Guid.NewGuid().ToString();
_logger.LogInformation("Handling {CorrelationId}", correlationId);
// App Insights correlates by operation_Id (from traceparent), NOT by this header.
// Searching by CorrelationId finds logs; searching the trace finds spans; they don't join.
```

### GOOD — one identity: the W3C trace id

```csharp
// ASP.NET Core already created an Activity from the inbound traceparent.
var traceId = Activity.Current?.TraceId.ToString();
_logger.LogInformation("Handling request");   // enriched with TraceId/SpanId (see DTC-005)
// Logs, spans, and App Insights operation_Id all key off the same trace id.
```

---

## Check C — Trace context dropped at an async boundary (DTC-003)

### Detection

The most common break: work handed to a queue (`dotnet-messaging`, `dotnet-outbox-pattern`,
Service Bus/Event Grid) or a background job (`dotnet-background-jobs`, Hangfire) does **not**
carry the `traceparent`, so the consumer starts a brand-new root trace. The publish side and
the processing side become two unrelated traces, and you can't follow one business operation
across the async hop. This is P0 because async is exactly where correlation matters most.

### BAD — message carries no trace context

```csharp
await _bus.PublishAsync(new OrderPlaced(orderId));
// Consumer in another process starts a fresh Activity with no parent — new trace.
```

### GOOD — inject traceparent into the message, restore it on consume

```csharp
var msg = new ServiceBusMessage(body);
msg.ApplicationProperties["traceparent"] = Activity.Current?.Id;   // W3C id

// Consumer:
using var activity = _source.StartActivity("OrderPlaced handler", ActivityKind.Consumer,
    parentId: msg.ApplicationProperties["traceparent"]?.ToString());
// Same trace now spans publish → queue → consume.
```

---

## Check D — Downstream/SQL calls not in the request trace (DTC-004)

### Detection

Check that EF Core / SQL and outbound HTTP calls emit child spans under the request span —
i.e. `SqlClient` and `HttpClient` instrumentation is registered (`dotnet-observability`).
Without it, a slow request is an opaque block: you can see it took 4s but not that 3.8s was one
N+1 query (`sql-performance-review`). The spans exist in principle; the review checks they are
actually wired into the same trace, not disabled or unregistered.

### BAD — only ASP.NET Core instrumented; DB/HTTP invisible

```csharp
builder.Services.AddOpenTelemetry().WithTracing(t => t.AddAspNetCoreInstrumentation());
// No AddSqlClientInstrumentation / AddHttpClientInstrumentation → the trace stops at the
// controller; the query and downstream call are never attributed.
```

### GOOD — downstream layers emit child spans

```csharp
builder.Services.AddOpenTelemetry().WithTracing(t => t
    .AddAspNetCoreInstrumentation()
    .AddHttpClientInstrumentation()
    .AddSqlClientInstrumentation(o => o.SetDbStatementForText = false)); // no PII in span text
// One trace now shows controller → EF Core query → downstream API, with per-span timing.
```

---

## Check E — Trace id not surfaced to user or logs (DTC-005)

### Detection

Two linked gaps: (1) the trace id is not returned to the SPA on error — so a user-reported
"error id" can't be tied to the server-side trace (`angular-error-handling` has nothing to
show); and (2) logs aren't enriched with `TraceId`/`SpanId` (`dotnet-logging`), so a log line
can't be pivoted to its trace in `azure-observability`. Fixing both makes "user says it broke"
→ "here's the exact trace" a one-step lookup.

### BAD — error reveals nothing traceable

```csharp
return Problem(statusCode: 500);   // no trace id anywhere; user can only say "it failed"
// Logger has no scope enrichment → log lines carry no TraceId to search on.
```

### GOOD — trace id in the error body and every log line

```csharp
// ProblemDetails carries the trace id (RFC 7807 extension) — see api-design-standards.
return Problem(statusCode: 500, extensions: new Dictionary<string, object?>
    { ["traceId"] = Activity.Current?.TraceId.ToString() });
// Serilog/OTel log enrichment adds TraceId/SpanId to every event, so the id the user
// reports lands directly on the trace and its logs in App Insights.
```

---

## Read budget

≤ 12 files: the Angular API interceptor, the .NET OpenTelemetry/`ActivitySource` registration
in `Program.cs`, the message publish/consume sites, the logging enrichment config, and the
error-response shaping. Reference `dotnet-observability`, `angular-telemetry`, and
`azure-observability` for each side's own mechanics rather than re-deriving them — this skill
only checks that the sides join into one trace. Budgets bound exploration, not quality: if
confirming an async hop's propagation needs one more file, read it and say why.
