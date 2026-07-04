---
name: angular-error-handling
description: Reviews Angular application-level error handling — the frontend counterpart to dotnet-error-handling's ProblemDetails contract. Flags no global ErrorHandler for uncaught exceptions, per-component ad-hoc catchError blocks with no shared error-boundary/toast pattern, HTTP error responses not parsed against the .NET ProblemDetails shape, and no user-facing fallback UI distinguishing recoverable errors from a full application crash. Outputs findings with pilot-angular error-handling standard IDs.
when_to_use: ErrorHandler, global error handler Angular, error boundary, catchError, ProblemDetails Angular, HTTP error interceptor, toast notification error, fallback UI, uncaught exception Angular, crash screen
applies_to: angular>=17
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| AEH-001 | P1 | No global `ErrorHandler` registered for uncaught exceptions |
| AEH-002 | P2 | Per-component ad-hoc `catchError` with no shared error-boundary/notification pattern |
| AEH-003 | P1 | HTTP error responses not parsed against the .NET `ProblemDetails` shape |
| AEH-004 | P2 | No user-facing fallback UI distinguishing a recoverable error from a full crash |

---

## Check A — No global ErrorHandler (AEH-001)

### Detection

Check `app.config.ts`/`AppModule` providers for a custom `ErrorHandler` implementation. Without
one, an uncaught exception anywhere in the component tree (a template expression throwing,
an unguarded array access) surfaces only in the browser console — the user sees a frozen
or partially-rendered page with no indication anything went wrong.

### BAD — no global ErrorHandler, uncaught exceptions vanish into the console

```typescript
export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(), provideRouter(routes)],
  // No ErrorHandler override — Angular's default just console.errors and moves on.
};
```

### GOOD — a global ErrorHandler that logs and surfaces a recoverable notification

```typescript
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly notifications = inject(NotificationService);
  private readonly telemetry = inject(TelemetryService);

  handleError(error: unknown): void {
    this.telemetry.trackException(error); // send to Application Insights JS SDK
    this.notifications.showError('Something went wrong. Please try again.');
  }
}

export const appConfig: ApplicationConfig = {
  providers: [{ provide: ErrorHandler, useClass: GlobalErrorHandler }],
};
```

---

## Check B — Ad-hoc catchError with no shared pattern (AEH-002)

### Detection

Grep components/services for repeated `catchError(err => { /* custom toast logic */ })`
blocks that each reimplement how an HTTP failure is surfaced to the user, instead of one
shared error-normalization interceptor/service reused everywhere (this builds on
`angular-http-resilience`'s error-normalization guidance, applied consistently at the UI
layer, not just the data layer).

### BAD — every component reimplements its own error toast

```typescript
this.orderService.getOrders().pipe(
  catchError(err => {
    this.snackBar.open('Failed to load orders'); // duplicated with slightly different wording per component
    return of([]);
  })
).subscribe();
```

### GOOD — one shared error-notification service, consistent messaging

```typescript
this.orderService.getOrders().pipe(
  catchError(err => this.errorNotifier.handle(err, 'Failed to load orders'))
).subscribe();

@Injectable({ providedIn: 'root' })
export class ErrorNotifierService {
  private readonly snackBar = inject(MatSnackBar);
  handle(error: AppError, fallbackMessage: string) {
    this.snackBar.open(error.userMessage ?? fallbackMessage);
    return of(null);
  }
}
```

---

## Check C — HTTP errors not parsed against ProblemDetails (AEH-003)

### Detection

Check the HTTP error-normalization interceptor (`angular-http-resilience`) for whether it
actually parses the `.NET` API's `ProblemDetails`/`ValidationProblemDetails` response body
(established in `dotnet-error-handling` ERR-002) into a typed Angular error model, or
whether it just surfaces the raw HTTP status code with no server-provided detail.

### BAD — only the HTTP status code is used, ProblemDetails body ignored

```typescript
catchError((err: HttpErrorResponse) => {
  return throwError(() => new AppError(`Request failed with status ${err.status}`));
  // err.error actually contains a ProblemDetails body with a specific title/errors dictionary — discarded.
})
```

### GOOD — ProblemDetails body parsed into a typed error model

```typescript
interface ProblemDetails {
  title: string;
  status: number;
  errors?: Record<string, string[]>;
  correlationId?: string;
}

catchError((err: HttpErrorResponse) => {
  const problem = err.error as ProblemDetails;
  return throwError(() => new AppError(problem.title, problem.errors, problem.correlationId));
})
```

---

## Check D — No fallback UI distinguishing recoverable errors from a crash (AEH-004)

### Detection

Check whether the app has a distinct "something recoverable failed, here's a retry
button" state versus a full top-level crash screen — conflating the two means a minor
failed API call (recoverable — retry the request) looks the same to the user as an
unrecoverable rendering crash (needs a full reload).

### BAD — every error, recoverable or not, shows the same blank/frozen page

```html
@if (error()) {
  <p>Error</p>
}
```

### GOOD — distinct recoverable vs. crash states

```html
@if (loadError()) {
  <div class="inline-error">
    <p>Couldn't load orders.</p>
    <button (click)="retry()">Retry</button>
  </div>
} @else if (appCrashed()) {
  <app-crash-screen /> <!-- full-page fallback set by GlobalErrorHandler, offers a reload -->
}
```
