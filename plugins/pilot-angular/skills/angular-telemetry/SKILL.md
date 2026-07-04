---
name: angular-telemetry
description: Reviews Angular application telemetry — the frontend counterpart to dotnet-observability. Flags no Application Insights JS SDK (or equivalent) wired, user-interaction events tracked with inconsistent/ad-hoc naming instead of a shared event-tracking convention, no correlation between a frontend user action and the backend request trace ID already established by angular-http-resilience/dotnet-observability, and PII captured in telemetry event properties. Outputs findings with pilot-angular telemetry standard IDs.
when_to_use: Application Insights JS SDK, frontend telemetry, event tracking, analytics event, user interaction tracking, trackEvent, trackPageView, correlation ID frontend, telemetry PII, custom dimensions
applies_to: angular>=17
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| TEL-001 | P1 | No Application Insights JS SDK (or equivalent) wired into the app |
| TEL-002 | P2 | User-interaction events tracked with ad-hoc/inconsistent naming instead of a shared convention |
| TEL-003 | P1 | No correlation between a frontend action and the backend request's trace ID |
| TEL-004 | P0 | PII captured in telemetry event properties |

---

## Check A — No Application Insights JS SDK wired (TEL-001)

### Detection

Check `app.config.ts`/`main.ts` for `@microsoft/applicationinsights-web` (or an equivalent
RUM/analytics SDK) initialization. Without it, frontend errors, page-load performance, and
user-interaction patterns are invisible — `dotnet-observability` covers the backend, but a
slow or broken frontend experience produces no telemetry at all on its own.

### BAD — no frontend telemetry SDK at all

```typescript
export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(), provideRouter(routes)],
  // No telemetry SDK — a JS error or a slow page load is invisible unless a user reports it.
};
```

### GOOD — Application Insights initialized, wired to the global ErrorHandler

```typescript
const appInsights = new ApplicationInsights({
  config: { connectionString: environment.appInsightsConnectionString, enableAutoRouteTracking: true },
});
appInsights.loadAppInsights();

@Injectable()
export class TelemetryService {
  trackEvent(name: string, properties?: Record<string, string>) {
    appInsights.trackEvent({ name }, properties);
  }
  trackException(error: unknown) {
    appInsights.trackException({ exception: error as Error });
  }
}
```

`GlobalErrorHandler` (from `angular-error-handling` AEH-001) calls
`telemetry.trackException(error)` so uncaught exceptions are captured automatically.

---

## Check B — Ad-hoc event naming instead of a shared convention (TEL-002)

### Detection

Grep `trackEvent(...)` call sites for inconsistent naming (`"Order Approved"`,
`"order_approve_click"`, `"OrderApprove"` all appearing across the codebase) instead of one
documented convention (e.g., `Feature.Action` — `Orders.Approved`, `Orders.ExportClicked`).
Inconsistent naming makes it impossible to build a reliable dashboard/funnel query across
events from different features.

### BAD — every feature invents its own event-naming style

```typescript
this.telemetry.trackEvent('order approved!!');       // feature A
this.telemetry.trackEvent('invoice_export_click');    // feature B — different casing/style entirely
```

### GOOD — one naming convention, documented and enforced

```typescript
// telemetry-events.ts — the single source of truth for event names
export const TelemetryEvents = {
  Orders: { Approved: 'Orders.Approved', ExportClicked: 'Orders.ExportClicked' },
  Invoices: { ExportClicked: 'Invoices.ExportClicked' },
} as const;

this.telemetry.trackEvent(TelemetryEvents.Orders.Approved);
```

---

## Check C — No correlation between frontend action and backend trace ID (TEL-003)

### Detection

Check whether a tracked frontend event tied to an API call includes the same correlation/
trace ID the HTTP interceptor already attaches to the outbound request (`angular-http-
resilience`'s `X-Correlation-Id`, which `dotnet-resilience`/`dotnet-observability` thread
through backend logs and traces). Without it, a slow "Approve order" event in the frontend
telemetry can't be joined to the corresponding backend trace to find *where* the time went.

### BAD — frontend event and backend trace are two disconnected data sets

```typescript
this.telemetry.trackEvent('Orders.Approved'); // no link to the HTTP request's correlation ID
this.http.post('/api/orders/approve', dto).subscribe();
```

### GOOD — the same correlation ID ties the frontend event to the backend trace

```typescript
const correlationId = crypto.randomUUID();
this.http.post('/api/orders/approve', dto, {
  headers: { 'X-Correlation-Id': correlationId }, // same header angular-http-resilience already sends
}).subscribe(() => {
  this.telemetry.trackEvent(TelemetryEvents.Orders.Approved, { correlationId });
});
```

A support engineer can now search Application Insights for `correlationId` and see both
the frontend event and the full backend trace (`dotnet-observability` OBS-003) in one query.

---

## Check D — PII captured in telemetry properties (TEL-004)

### Detection

Grep `trackEvent`/`trackPageView` calls for PII passed as a custom property/dimension
(email, full name, phone number) — the same concern `dotnet-data-protection` DP-003 raises
for backend logs applies identically to frontend telemetry, which is equally
long-retention and equally outside the app's own data-erasure flow.

### BAD — PII passed straight into telemetry properties

```typescript
this.telemetry.trackEvent('Orders.Approved', { customerEmail: order.customer.email }); // PII in telemetry, indefinitely retained
```

### GOOD — a non-PII identifier instead

```typescript
this.telemetry.trackEvent('Orders.Approved', { customerId: order.customer.id }); // Guid identifier, not PII
```
