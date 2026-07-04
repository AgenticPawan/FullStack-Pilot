---
name: angular-http-resilience
description: Typed HttpClient wrappers, interceptor-based retry with exponential backoff and per-request timeout, correlation-ID header propagation to .NET backends, error normalisation into typed error models, and loading-state management. Targets Angular 17+ functional HttpClient configuration.
when_to_use: HTTP, HttpClient, interceptor, retry, timeout, error handling, correlation ID, request header, loading state, API calls, http resilience, typed response, catchError, exponential backoff, HttpContext, withInterceptors
applies_to: angular>=17
---

<!-- Version index:
  provideHttpClient + withInterceptors  Angular 15+
  HttpContextToken                      Angular 12+
  functional interceptors               Angular 15+
  withXsrfConfiguration()               Angular 15+
  httpResource()                        experimental Angular 19.2+
-->

## Architecture overview

```
Component / Service
    │  typed request method
    ▼
ApiService (typed wrapper)
    │  Observable<T>
    ▼
HttpClient  ──► Interceptor chain ──► .NET API
              ├─ CorrelationIdInterceptor   (adds X-Correlation-Id header)
              ├─ RetryInterceptor           (exponential backoff on 5xx)
              └─ TimeoutInterceptor         (per-request timeout via HttpContext)
```

---

## Typed service wrapper

### BAD — scattered HttpClient calls with `any`

```typescript
@Component({ ... })
export class ProductsComponent {
  products: any[] = [];

  constructor(private http: HttpClient) {
    // No typing, no error handling, no cleanup
    this.http.get('/api/products').subscribe((data: any) => {
      this.products = data;
    });
  }
}
```

### GOOD — typed service with `Observable<T>`

```typescript
// product.service.ts
export interface Product { id: number; name: string; price: number; }
export interface ApiError  { code: string; message: string; traceId: string; }

@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);
  private base = '/api/products';

  getAll(): Observable<Product[]> {
    return this.http.get<Product[]>(this.base);
  }

  getById(id: number): Observable<Product> {
    return this.http.get<Product>(`${this.base}/${id}`);
  }

  create(payload: Omit<Product, 'id'>): Observable<Product> {
    return this.http.post<Product>(this.base, payload);
  }
}
```

**Note:** `http.get<T>()` is a type assertion, not runtime validation. Validate with
`zod` or a custom validator when schema correctness is critical.

---

## Correlation-ID interceptor

Propagates a per-request ID from Angular to the .NET backend so distributed traces
link frontend logs to backend logs.

```typescript
// correlation-id.interceptor.ts
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

export const correlationIdInterceptor: HttpInterceptorFn = (req, next) => {
  const correlationId = crypto.randomUUID();
  const cloned = req.clone({
    headers: req.headers.set('X-Correlation-Id', correlationId)
  });
  return next(cloned);
};
```

**.NET backend — read and echo the header:**
```csharp
// Middleware or filter
var correlationId = ctx.Request.Headers["X-Correlation-Id"].FirstOrDefault()
    ?? Guid.NewGuid().ToString();
ctx.Response.Headers.Append("X-Correlation-Id", correlationId);
// Enrich logger scope:
using (_logger.BeginScope(new { CorrelationId = correlationId })) { ... }
```

---

## Retry interceptor with exponential backoff

```typescript
// retry.interceptor.ts
import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { timer } from 'rxjs';
import { retry, switchMap } from 'rxjs/operators';

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRIES = 3;

export const retryInterceptor: HttpInterceptorFn = (req, next) => {
  // Only retry idempotent methods
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next(req);
  }

  return next(req).pipe(
    retry({
      count: MAX_RETRIES,
      delay: (error, attempt) => {
        if (!RETRYABLE_STATUS.has(error.status)) {
          throw error;  // non-retryable: propagate immediately
        }
        const backoff = Math.pow(2, attempt) * 200;  // 400ms, 800ms, 1600ms
        return timer(backoff);
      }
    })
  );
};
```

---

## Per-request timeout via HttpContextToken

```typescript
// timeout.interceptor.ts
import {
  HttpContextToken, HttpInterceptorFn, HttpErrorResponse
} from '@angular/common/http';
import { inject } from '@angular/core';
import { timeout, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

/** Pass TIMEOUT_MS(5000) in HttpContext to override the default 10 s timeout. */
export const TIMEOUT_MS = new HttpContextToken<number>(() => 10_000);

export const timeoutInterceptor: HttpInterceptorFn = (req, next) => {
  const ms = req.context.get(TIMEOUT_MS);
  return next(req).pipe(
    timeout(ms),
    catchError(err => {
      if (err.name === 'TimeoutError') {
        return throwError(() =>
          new HttpErrorResponse({ status: 408, statusText: 'Request Timeout' })
        );
      }
      return throwError(() => err);
    })
  );
};
```

**Caller usage — override timeout per request:**
```typescript
import { HttpContext } from '@angular/common/http';
import { TIMEOUT_MS } from './timeout.interceptor';

this.http.get<Report>('/api/report/generate', {
  context: new HttpContext().set(TIMEOUT_MS, 30_000)  // 30 s for slow report
});
```

---

## Register interceptors

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(
      withInterceptors([
        correlationIdInterceptor,  // first: add ID to every outgoing request
        retryInterceptor,          // second: retry 5xx on idempotent methods
        timeoutInterceptor         // third: cancel requests that exceed timeout
      ]),
      withXsrfConfiguration({
        cookieName: 'XSRF-TOKEN',
        headerName: 'X-XSRF-TOKEN'
      })
    )
  ]
};
```

---

## Error normalisation

Map `HttpErrorResponse` to a domain error model so components never inspect raw HTTP status codes:

```typescript
// api-error.ts
export interface ApiError {
  status:   number;
  message:  string;
  traceId?: string;
}

export function toApiError(err: HttpErrorResponse): ApiError {
  return {
    status:  err.status,
    message: err.error?.message ?? err.statusText,
    traceId: err.error?.traceId ?? err.headers.get('X-Correlation-Id') ?? undefined
  };
}
```

```typescript
// product.service.ts — surface normalised error
getAll(): Observable<Product[]> {
  return this.http.get<Product[]>(this.base).pipe(
    catchError((err: HttpErrorResponse) => throwError(() => toApiError(err)))
  );
}
```

---

## Loading state with signals

```typescript
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) { <app-spinner /> }
    @else if (error()) { <p role="alert">{{ error()!.message }}</p> }
    @else {
      @for (p of products(); track p.id) { <app-product-card [product]="p" /> }
    }
  `
})
export class ProductListComponent {
  private svc = inject(ProductService);

  products = signal<Product[]>([]);
  loading  = signal(true);
  error    = signal<ApiError | null>(null);

  constructor() {
    this.svc.getAll().pipe(takeUntilDestroyed()).subscribe({
      next:     p   => { this.products.set(p); this.loading.set(false); },
      error:    err => { this.error.set(err);  this.loading.set(false); }
    });
  }
}
```

---

## Checklist

- [ ] All HTTP calls go through a typed service method — no raw `HttpClient` in components
- [ ] `correlationIdInterceptor` registered — every request carries `X-Correlation-Id`
- [ ] `retryInterceptor` retries only idempotent methods (GET/HEAD/OPTIONS) on 5xx
- [ ] `timeoutInterceptor` guards all requests; override with `TIMEOUT_MS` for slow endpoints
- [ ] `HttpErrorResponse` mapped to domain `ApiError` before reaching the component
- [ ] Loading, error, and data states are distinct signals — template handles all three
- [ ] Non-idempotent (POST/PUT/DELETE) retries require idempotency keys from the .NET API
- [ ] `withXsrfConfiguration()` names match `.NET AntiforgeryOptions` (see angular-security)
