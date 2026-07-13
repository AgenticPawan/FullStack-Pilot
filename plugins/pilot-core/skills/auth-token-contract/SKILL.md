---
name: auth-token-contract
description: Reviews the cross-cutting auth contract tying angular-authentication (SPA OIDC/PKCE) to dotnet-authentication (token validation) plus the permissions-only rule shared by angular-security and dotnet-authorization. Flags audience/issuer/scope mismatch between SPA and API, claim-name drift between issuance and permission checks, token lifetime/renew misalignment, and client-only gating with no server enforcement. Outputs pilot-core auth-token-contract standard IDs.
when_to_use: auth contract, OIDC flow end to end, token audience mismatch, issuer validation, scope mismatch, claim name drift, permission claim, access token lifetime, silent renew alignment, 401 contract, bearer token audience, client-only gating, SPA to API auth seam, permissions-only across layers, Entra ID audience scope
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ATC-001 | P0 | Token `aud`/`iss`/`scope` requested by the SPA doesn't match what the API validates |
| ATC-002 | P0 | Permission/role claim name the API authorizes on differs from what the IdP issues |
| ATC-003 | P1 | Access-token lifetime and the SPA's silent-renew cadence are misaligned |
| ATC-004 | P0 | UI gates a capability the server never re-enforces (client-only authorization) |
| ATC-005 | P1 | No single documented source of truth for the audience/scope/claim contract |

Two skills each own one side of this handshake in isolation: `angular-authentication`
(how the SPA logs in, stores tokens, and renews them) and `dotnet-authentication` (how the
API validates the incoming token). Neither checks that the two sides actually *agree* on
audience, issuer, scopes, and claim names — and `angular-security` + `dotnet-authorization`
both enforce the house **permissions-only** rule but on opposite ends of the wire. This
skill is the shared contract layer above all four: the token the SPA sends must be exactly
the token the API expects, and every UI gate must have a server gate behind it.

---

## Check A — Audience / issuer / scope mismatch (ATC-001)

### Detection

Compare the OIDC/MSAL configuration the SPA uses to request a token (`angular-authentication`)
against the `JwtBearerOptions` the API validates with (`dotnet-authentication`). A token
whose `aud` doesn't match `TokenValidationParameters.ValidAudience`, whose `iss` doesn't
match `ValidIssuer`, or whose granted scope isn't the scope the endpoint requires, is
rejected with a 401 the user can't diagnose — or, worse, silently accepted if validation
is loosened to make it "work."

### BAD — SPA requests one audience/scope, API validates another

```typescript
// Angular — angular-oauth2-oidc / MSAL config
scope: 'openid profile api://orders-api/read',   // audience: orders-api
```

```csharp
// .NET — the API validates a DIFFERENT audience, so every token is rejected 401
options.TokenValidationParameters = new TokenValidationParameters
{
    ValidAudience = "api://billing-api",          // ATC-001: mismatch — never matches the token
    ValidIssuer   = "https://login.microsoftonline.com/{tenant}/v2.0"
};
```

### GOOD — one audience/issuer/scope agreed on both ends

```csharp
// Both ends reference the same audience + issuer, ideally from shared config, not literals.
options.Authority = builder.Configuration["Auth:Authority"];   // issuer
options.Audience  = builder.Configuration["Auth:Audience"];    // api://orders-api
// Endpoint requires the scope the SPA actually requested:
// [Authorize] + policy RequireScope("api://orders-api/read")
```

---

## Check B — Claim-name drift between issuance and authorization (ATC-002)

### Detection

Check that the claim the API authorizes on is the claim the IdP actually issues. Entra ID
emits roles/permissions under `roles` or `scp`; a custom IdP may map them to `permission`,
`permissions`, or a namespaced URI. If `dotnet-authorization` reads `"permission"` but the
token carries `"permissions"` (or the .NET default remaps it to the long
`http://schemas.microsoft.com/.../role` URI), every check fails closed or, if patched with
a fallback, fails open. This is the permissions-only rule breaking at the wire.

### BAD — API reads a claim name the token never contains

```csharp
// Token issued with:  "permissions": ["orders.read", "orders.write"]
// API authorizes on a different claim name entirely:
if (User.HasClaim("permission", "orders.write"))   // ATC-002: singular vs plural — never true
    ...
```

### GOOD — the authorized claim name is the issued claim name, documented once

```csharp
// docs/AUTH-CONTRACT.md pins the claim: permissions are issued under "permissions".
// Startup maps it explicitly so ClaimTypes remapping can't rename it:
options.TokenValidationParameters.RoleClaimType = "permissions";
// dotnet-authorization policies then check "permissions" — the same name the IdP issues.
// (Permissions only — never a role name. See dotnet-authorization / angular-security.)
```

---

## Check C — Token lifetime vs silent-renew misalignment (ATC-003)

### Detection

Compare the access-token lifetime configured at the IdP against the SPA's silent-renew /
refresh cadence (`angular-authentication`). If the token lives 60 minutes but the SPA only
attempts renewal on navigation, a long-idle tab makes an API call with an expired token and
gets a 401 mid-action; if renewal fires far more often than needed, it hammers the IdP. The
renewal must be driven off the actual `exp`, not a hard-coded interval guessed independently
of the token's real lifetime.

### BAD — fixed renew interval guessed independently of token lifetime

```typescript
// SPA renews every 55 min on a hunch; IdP actually issues 15-min tokens.
setInterval(() => this.auth.silentRenew(), 55 * 60 * 1000);   // ATC-003: 40 min of dead token
```

### GOOD — renewal scheduled from the token's own expiry with a safety margin

```typescript
// Schedule renewal at exp minus a margin; angular-authentication's silent-renew handles it.
// The API's clock-skew tolerance (dotnet-authentication) is set to match the margin so a
// token in flight during renewal is never spuriously rejected.
```

---

## Check D — Client-only gating with no server enforcement (ATC-004)

### Detection

For every capability the UI hides or disables based on a permission (`angular-security` UI
gating / route guards), confirm the API endpoint behind it independently enforces the same
permission (`dotnet-authorization`). A hidden button is a usability affordance, never a
security control — an attacker calls the endpoint directly. This is the single most common
real breach in a permissions-only SPA: the guard exists, the `[Authorize]` policy doesn't.

### BAD — route guard gates the page; the endpoint is wide open

```typescript
// Angular — guard blocks navigation to the admin page
canActivate: [() => inject(Auth).has('users.delete')]
```

```csharp
// .NET — the endpoint the page calls has no matching policy at all
[HttpDelete("users/{id}")]                 // ATC-004: no [Authorize] — direct call succeeds
public IActionResult DeleteUser(Guid id) { ... }
```

### GOOD — every UI gate has a server gate enforcing the same permission

```csharp
[HttpDelete("users/{id}")]
[Authorize(Policy = "users.delete")]       // same permission the Angular guard checks
public IActionResult DeleteUser(Guid id) { ... }
// The guard is UX; this policy is the control. Both cite the same permission name (ATC-002).
```

---

## Check E — No single source of truth for the contract (ATC-005)

### Detection

Check for one discoverable, version-controlled document that pins the authority/issuer,
audience, the scope list, and the permission-claim name — the values Checks A–D all depend
on. Without it, the SPA config and the API config are two independent copies of an unwritten
contract, and they drift the first time either side changes an app registration.

### GOOD — the contract is written down once and both ends reference it

```
<!-- docs/AUTH-CONTRACT.md -->
Authority (issuer): https://login.microsoftonline.com/{tenant}/v2.0
API audience:       api://orders-api
Scopes:             api://orders-api/read, api://orders-api/write
Permission claim:   "permissions" (array of dot-scoped strings, e.g. "orders.write")
Access-token life:  15 min; SPA renews at exp − 2 min; API clock skew 2 min.
Rule: authorization is permissions-only (never role names) on BOTH ends.
Any change to an app registration updates this file in the same PR.
```
