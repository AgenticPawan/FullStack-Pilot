---
name: angular-authentication
description: Reviews how an Angular SPA authenticates against an OIDC/OAuth2 IdP or the .NET backend — distinct from angular-security's permission gating, which assumes authentication already happened. Flags tokens in localStorage instead of httpOnly Secure cookies, no central auth interceptor, no silent renewal, hand-rolled OIDC/PKCE, decentralized auth state, and no global 401 handling. Outputs pilot-angular authentication standard IDs.
when_to_use: OIDC, OAuth2, PKCE, login, logout, access token, refresh token, silent renew, token storage, localStorage token, httpOnly cookie, bearer token, auth interceptor, angular-oauth2-oidc, MSAL Angular, Entra ID, Azure AD, 401 handling, session expiry, auth state, isAuthenticated, currentUser signal
applies_to: angular
---

<!-- Version index:
  HttpInterceptorFn (functional interceptors)  Angular 15+ (provideHttpClient)
  inject() in class fields                     Angular 14+
  signal()-based auth state                     Angular 16+
  angular-oauth2-oidc                            all Angular versions (community library)
  MSAL Angular (@azure/msal-angular)             all Angular versions (Entra ID)
-->

## Rule reference

| ID | Standard | Severity |
|----|----------|----------|
| NGAUTH-001 | OWASP A07 | block |
| NGAUTH-002 | InternalPolicy | warn |
| NGAUTH-003 | InternalPolicy | warn |
| NGAUTH-004 | InternalPolicy | warn |
| NGAUTH-005 | InternalPolicy | warn |
| NGAUTH-006 | OWASP A07 | block |

---

## NGAUTH-001 — Tokens in localStorage/sessionStorage instead of httpOnly cookies

`localStorage` and `sessionStorage` are readable by any script running in the page —
one XSS gap anywhere in the app (or in a third-party script, see
`angular-third-party-scripts`) is enough to exfiltrate every stored token. An httpOnly
cookie set by the .NET backend is invisible to JavaScript entirely; the token never
touches app code.

### BAD — token stored and read from localStorage

```typescript
// auth.service.ts
login(credentials: LoginRequest) {
  return this.http.post<TokenResponse>('/api/auth/login', credentials).pipe(
    tap(res => {
      localStorage.setItem('access_token', res.accessToken); // readable by any injected script
      localStorage.setItem('refresh_token', res.refreshToken);
    })
  );
}

getToken(): string | null {
  return localStorage.getItem('access_token');
}
```

### GOOD — backend sets an httpOnly, Secure, SameSite cookie; Angular never sees the token

```csharp
// .NET backend — Program.cs / AuthController
Response.Cookies.Append("access_token", accessToken, new CookieOptions
{
    HttpOnly = true,
    Secure = true,
    SameSite = SameSiteMode.Strict,
    Expires = DateTimeOffset.UtcNow.AddMinutes(15)
});
```

```typescript
// auth.service.ts — Angular sends credentials, cookie is set/read by the browser automatically
login(credentials: LoginRequest) {
  return this.http.post<void>('/api/auth/login', credentials, { withCredentials: true });
  // No token is ever stored or read in JS — the cookie rides along on every request.
}
```

---

## NGAUTH-002 — No centralized auth interceptor attaching the bearer token

### Detection

Grep feature services for `Authorization: Bearer` headers built manually per HTTP call, or
services independently reading a token store. Flag when two or more services duplicate this
logic instead of a single functional `HttpInterceptorFn` registered once.

### BAD — each service attaches the header itself

```typescript
// orders.service.ts
getOrders() {
  const token = this.authService.getToken();
  return this.http.get<Order[]>('/api/orders', {
    headers: { Authorization: `Bearer ${token}` } // duplicated in every service
  });
}
```

### GOOD — one functional interceptor attaches the token to every outbound request

```typescript
// auth.interceptor.ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.accessToken();
  if (!token) return next(req);

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};

// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(withInterceptors([authInterceptor]))],
};
```

> If tokens live in an httpOnly cookie (NGAUTH-001's fix), this interceptor is unnecessary —
> the browser attaches the cookie automatically and `withCredentials: true` is all that's needed.

---

## NGAUTH-003 — No silent token renewal before expiry

### Detection

Check whether a short-lived access token has any renewal path before it expires. Flag when
the only recovery from an expired token is a full re-login (or a 401 loop — see NGAUTH-006)
rather than a proactive refresh scheduled ahead of the expiry timestamp.

### BAD — token simply expires and the user is bounced to login

```typescript
// No renewal scheduling anywhere. When the 15-minute access token expires mid-session,
// the next API call 401s and the user is redirected to log in again, losing form state.
```

### GOOD — refresh scheduled ahead of expiry using the library's built-in silent renew

```typescript
// app.config.ts (angular-oauth2-oidc)
export function initAuth(oauthService: OAuthService) {
  return () => oauthService.loadDiscoveryDocumentAndTryLogin().then(() => {
    oauthService.setupAutomaticSilentRefresh(); // renews ~before token expiry, no user interruption
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => initAuth(inject(OAuthService))()),
  ],
};
```

```typescript
// MSAL Angular equivalent — silent token acquisition via acquireTokenSilent
this.msalService.acquireTokenSilent({ scopes: ['api://app-id/access_as_user'] }).subscribe({
  next: result => this.authState.setToken(result.accessToken),
  error: () => this.msalService.acquireTokenRedirect({ scopes: ['api://app-id/access_as_user'] }),
});
```

---

## NGAUTH-004 — Hand-rolled OIDC/PKCE instead of a maintained library

### Detection

Grep for manual construction of authorization-request URLs, manual PKCE `code_verifier`/
`code_challenge` generation, or manual `id_token` JWT parsing/validation. Flag any of these
in favor of `angular-oauth2-oidc` (generic OIDC providers) or `@azure/msal-angular` (Entra ID).
Hand-rolled PKCE is a common source of state/nonce validation bugs and token-replay gaps.

### BAD — PKCE flow implemented by hand

```typescript
function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32))); // easy to get subtly wrong
}
// ...manual code_challenge, manual redirect URL construction, manual state param, manual
// exchange of the auth code for tokens, manual id_token signature verification...
```

### GOOD — PKCE handled by a maintained library

```typescript
// app.config.ts (angular-oauth2-oidc)
export const authConfig: AuthConfig = {
  issuer: 'https://login.acme.com',
  redirectUri: window.location.origin + '/callback',
  clientId: 'angular-spa',
  responseType: 'code',
  scope: 'openid profile api.read',
  useSilentRefresh: true,
  // PKCE code_verifier/challenge, state, and nonce handling are all internal to the library.
};
```

```typescript
// MSAL Angular equivalent — PKCE is on by default for the authorization code flow
export const msalConfig: Configuration = {
  auth: { clientId: 'entra-app-id', authority: 'https://login.microsoftonline.com/tenant-id' },
};
```

---

## NGAUTH-005 — Auth state not centralized

### Detection

Grep components for independent JWT decoding (`atob(token.split('.')[1])` or similar) or
per-component reads of a token store to determine `isAuthenticated`/`currentUser`. Flag when
two or more components each derive this state independently instead of reading from one
injectable signal-based store.

### BAD — components decode the token themselves

```typescript
// profile.component.ts
ngOnInit() {
  const token = localStorage.getItem('access_token');
  const payload = JSON.parse(atob(token!.split('.')[1])); // duplicated decode logic
  this.userName = payload.name;
}
```

### GOOD — a single AuthState signal store is the source of truth

```typescript
// auth-state.service.ts
@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly _currentUser = signal<CurrentUser | null>(null);
  readonly currentUser = this._currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this._currentUser() !== null);

  setUser(user: CurrentUser | null) {
    this._currentUser.set(user);
  }
}
```

```typescript
// profile.component.ts
readonly authState = inject(AuthStateService);
// template: @if (authState.isAuthenticated()) { <p>{{ authState.currentUser()?.name }}</p> }
```

---

## NGAUTH-006 — No global 401 handling

### Detection

Grep for `catchError` blocks in individual components/services that each redirect to login
on an error response, rather than one interceptor inspecting the status code centrally.
Flag ad-hoc per-call handling as duplicated and inconsistent (some calls redirect, others
silently fail).

### BAD — each component handles its own 401

```typescript
// order-detail.component.ts
this.orderService.getOrder(id).subscribe({
  error: err => {
    if (err.status === 401) this.router.navigate(['/login']); // repeated in every component
  },
});
```

### GOOD — one interceptor handles 401s: attempt refresh, else redirect

```typescript
// auth.interceptor.ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError(err => {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        return authService.tryRefresh().pipe(
          switchMap(() => next(req.clone())), // retry the original request once, post-refresh
          catchError(() => {
            router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
            return throwError(() => err);
          }),
        );
      }
      return throwError(() => err);
    }),
  );
};
```

---

## Angular authentication checklist

- [ ] Tokens live in an httpOnly, Secure, SameSite cookie set by the .NET backend, not in localStorage/sessionStorage
- [ ] `withCredentials: true` (or an interceptor attaching bearer tokens) is applied consistently, never per-service
- [ ] Silent token renewal is scheduled ahead of expiry, not left to fail into a re-login
- [ ] OIDC/PKCE flow uses `angular-oauth2-oidc` or `@azure/msal-angular`, never a hand-rolled implementation
- [ ] `isAuthenticated`/`currentUser` are read from one centralized signal-based `AuthStateService`
- [ ] No component decodes a JWT directly to derive auth state
- [ ] A single interceptor handles 401 responses — attempt one refresh, then redirect to login
- [ ] Client-side auth state is treated as UX only; real enforcement is the .NET backend (see `dotnet-authentication`)
- [ ] Route guards for authentication (`canActivate`) check the centralized auth state, not a locally decoded token
- [ ] Logout clears server-side session/cookie via an API call, not just client-side state

---

## References

- angular-oauth2-oidc: https://github.com/manfredsteyer/angular-oauth2-oidc
- MSAL Angular (Entra ID): https://learn.microsoft.com/en-us/entra/identity-platform/tutorial-v2-angular
- OWASP A07:2021 Identification and Authentication Failures: https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/
- OAuth 2.0 for Browser-Based Apps (PKCE): https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps
- Angular functional interceptors: https://angular.dev/guide/http/interceptors
