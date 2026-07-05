---
name: dotnet-authentication
description: Reviews authentication setup in ASP.NET Core — establishing *who* the caller is, distinct from dotnet-authorization's permission checks on *what* they can do. Flags hand-rolled login endpoints minting tokens with no real IdP, homegrown ASP.NET Core Identity password flows used instead of an external IdP for new enterprise apps, weak password/lockout policy when Identity is used, refresh tokens with no rotation/expiry, long-lived access tokens, no MFA for privileged accounts, disabled token-validation parameters, and unthrottled login endpoints. Outputs findings with pilot-dotnet authentication standard IDs.
when_to_use: authentication, AddAuthentication, AddJwtBearer, AddOpenIdConnect, login endpoint, ASP.NET Core Identity, Entra ID, IdentityServer, Duende, Auth0, refresh token, access token expiry, token rotation, MFA, multi-factor authentication, TokenValidationParameters, ClockSkew, account lockout, password policy
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| AUTH-001 | P0 | Hand-rolled login endpoint mints its own tokens with no real IdP / standard scheme behind it |
| AUTH-002 | P1 | Homegrown ASP.NET Core Identity password flow used instead of an external IdP for a new enterprise app |
| AUTH-003 | P1 | ASP.NET Core Identity in use with no password-policy hardening and/or no account lockout configured |
| AUTH-004 | P0 | Refresh tokens issued with no rotation/reuse detection and no expiry |
| AUTH-005 | P1 | Access tokens are long-lived (well beyond 15-30 min) instead of paired with short-lived access + refresh tokens |
| AUTH-006 | P0 | No MFA option available for privileged/admin accounts |
| AUTH-007 | P0 | Token validation parameters disabled or `ClockSkew` left at the 5-minute default with no justification for a high-security flow |
| AUTH-008 | P0 | Login endpoint has no rate limiting / brute-force protection |

---

## Check A — Hand-rolled login endpoint with no real IdP (AUTH-001)

### Detection

Grep `Program.cs`/auth controllers for a login action that manually constructs a
`JwtSecurityToken` (or hand-rolled session cookie) after comparing a password hash, with no
`AddAuthentication().AddJwtBearer(...)` or `AddOpenIdConnect(...)` scheme registered anywhere.
A standard scheme centralizes signing-key management, validation parameters, and token
lifetime policy in one place; a bespoke endpoint reinvents all of that per app, usually
missing several of the checks below by construction.

### BAD — endpoint mints its own token with no registered scheme behind it

```csharp
[HttpPost("login")]
public async Task<IActionResult> Login(LoginDto dto)
{
    var user = await _db.Users.SingleOrDefaultAsync(u => u.Email == dto.Email);
    if (user is null || !_hasher.Verify(dto.Password, user.PasswordHash))
        return Unauthorized();

    var token = new JwtSecurityToken(
        claims: new[] { new Claim("sub", user.Id.ToString()) },
        expires: DateTime.UtcNow.AddDays(30),
        signingCredentials: new SigningCredentials(_hardcodedKey, SecurityAlgorithms.HmacSha256));
    return Ok(new JwtSecurityTokenHandler().WriteToken(token));
}
// No AddAuthentication/AddJwtBearer anywhere — this is the only place tokens are validated too.
```

### GOOD — standard scheme registered, login endpoint issues tokens through it

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = builder.Configuration["Auth:Authority"]; // Entra ID / IdentityServer
        options.Audience = builder.Configuration["Auth:Audience"];
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };
    });
```

Prefer delegating login entirely to an external IdP (Check B) rather than issuing tokens
from application code at all.

---

## Check B — Homegrown Identity password flow instead of an external IdP (AUTH-002)

### Detection

For a new enterprise app, check whether `AddIdentity<TUser, TRole>()` with a local password
table is the *only* sign-in path, with no `AddOpenIdConnect`/`AddMicrosoftIdentityWebApp`
integration against Entra ID, Duende IdentityServer, or Auth0. Homegrown password storage
means the app owns password-reset flows, breach-credential monitoring, and MFA delivery —
all solved problems an external IdP already handles, and all additional attack surface a
small team doesn't need to maintain.

### BAD — local password table is the whole authentication story

```csharp
builder.Services.AddIdentity<ApplicationUser, IdentityRole>()
    .AddEntityFrameworkStores<AppDbContext>();
// No external IdP integration at all — every credential, MFA delivery mechanism,
// and password-reset email is this team's problem to build and secure.
```

### GOOD — external IdP as the primary path; Identity retained only where mandated

```csharp
builder.Services.AddAuthentication(OpenIdConnectDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApp(builder.Configuration.GetSection("EntraId"));
// Password storage, MFA, breach-credential detection, and reset flows are Entra ID's job.
```

If ASP.NET Core Identity must be kept (e.g., a legacy migration path), harden it per Check C
rather than leaving it at defaults.

---

## Check C — Weak password policy / no account lockout in ASP.NET Core Identity (AUTH-003)

### Detection

Where `AddIdentity<...>()` is used, check `IdentityOptions.Password` for defaults left
unmodified (Identity's out-of-box minimum is 6 characters with no complexity requirement)
and `IdentityOptions.Lockout` for `MaxFailedAccessAttempts` never configured — meaning an
attacker can attempt unlimited passwords against one account with no lockout at all.

### BAD — Identity registered with no policy hardening

```csharp
builder.Services.AddIdentity<ApplicationUser, IdentityRole>()
    .AddEntityFrameworkStores<AppDbContext>();
// Password: 6 chars, no complexity required. Lockout: not configured — unlimited attempts.
```

### GOOD — password policy and lockout explicitly hardened

```csharp
builder.Services.AddIdentity<ApplicationUser, IdentityRole>(options =>
{
    options.Password.RequiredLength = 12;
    options.Password.RequireUppercase = true;
    options.Password.RequireNonAlphanumeric = true;
    options.Password.RequireDigit = true;

    options.Lockout.MaxFailedAccessAttempts = 5;
    options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    options.Lockout.AllowedForNewUsers = true;
})
.AddEntityFrameworkStores<AppDbContext>();
```

---

## Check D — Refresh tokens with no rotation or expiry (AUTH-004)

### Detection

Grep the refresh-token issuance/consumption code for whether a used refresh token is
invalidated and replaced (rotation) and whether reuse of an already-consumed token is
detected and treated as a compromise signal. Also check the refresh-token store for any
expiry column — a refresh token that never expires is a permanent credential if leaked.

### BAD — refresh token reused indefinitely, never rotated, never expires

```csharp
[HttpPost("refresh")]
public async Task<IActionResult> Refresh(string refreshToken)
{
    var stored = await _db.RefreshTokens.SingleOrDefaultAsync(t => t.Token == refreshToken);
    if (stored is null) return Unauthorized();

    var newAccessToken = _tokenService.CreateAccessToken(stored.UserId);
    return Ok(newAccessToken); // same refreshToken remains valid forever, reusable by anyone who has it
}
```

### GOOD — rotation with reuse detection and a bounded expiry

```csharp
[HttpPost("refresh")]
public async Task<IActionResult> Refresh(string refreshToken)
{
    var stored = await _db.RefreshTokens.SingleOrDefaultAsync(t => t.Token == refreshToken);
    if (stored is null || stored.ExpiresAt < DateTime.UtcNow) return Unauthorized();

    if (stored.ConsumedAt is not null)
    {
        // Token already used once before — this is a replay of a stolen token.
        await _db.RefreshTokens.Where(t => t.FamilyId == stored.FamilyId)
            .ExecuteUpdateAsync(t => t.SetProperty(x => x.Revoked, true));
        return Unauthorized("Refresh token reuse detected; session family revoked.");
    }

    stored.ConsumedAt = DateTime.UtcNow;
    var newRefreshToken = _tokenService.IssueRefreshToken(stored.UserId, stored.FamilyId,
        expiresAt: DateTime.UtcNow.AddDays(7));
    var newAccessToken = _tokenService.CreateAccessToken(stored.UserId);
    await _db.SaveChangesAsync();

    return Ok(new { accessToken = newAccessToken, refreshToken = newRefreshToken });
}
```

---

## Check E — Long-lived access tokens instead of short access + refresh pair (AUTH-005)

### Detection

Check the access-token expiry configured at issuance. An access token valid for hours or
days means a leaked bearer token (logged, cached, proxied) stays usable for that entire
window with no way to revoke it early — permission changes made via
`dotnet-authorization`'s per-request resolution still can't help if the token itself lives
too long relative to how the app expects to react to a compromised account.

### BAD — access token valid for 24 hours

```csharp
var token = new JwtSecurityToken(issuer, audience, claims,
    expires: DateTime.UtcNow.AddHours(24)); // any leak of this token is exploitable for a full day
```

### GOOD — short-lived access token, refresh token carries the session forward

```csharp
var accessToken = new JwtSecurityToken(issuer, audience, claims,
    expires: DateTime.UtcNow.AddMinutes(15)); // narrow exposure window if leaked
var refreshToken = _tokenService.IssueRefreshToken(user.Id, familyId: Guid.NewGuid(),
    expiresAt: DateTime.UtcNow.AddDays(7)); // rotated per Check D on each use
```

---

## Check F — No MFA option for privileged/admin accounts (AUTH-006)

### Detection

Check whether any second factor (authenticator app TOTP, external IdP-enforced MFA
conditional access policy, WebAuthn) is available at all for accounts holding an
administrative permission (see `dotnet-authorization` policy catalog). Password-only
authentication for the highest-value accounts in the system is the single weakest link an
attacker will target first.

### BAD — every account, including admins, is password-only

```csharp
builder.Services.AddIdentity<ApplicationUser, IdentityRole>()
    .AddEntityFrameworkStores<AppDbContext>();
// No TOTP provider registered, no conditional-access policy — admins log in with password alone.
```

### GOOD — MFA required for accounts holding privileged permissions

```csharp
builder.Services.AddIdentity<ApplicationUser, IdentityRole>()
    .AddDefaultTokenProviders() // enables TOTP-based two-factor tokens
    .AddEntityFrameworkStores<AppDbContext>();

// Enforced at sign-in for any account holding Permissions.Admin.Access:
if (await _userManager.GetTwoFactorEnabledAsync(user) == false
    && await _authz.AuthorizeAsync(principal, Permissions.Admin.Access))
{
    return RedirectToAction("EnrollMfa"); // block admin session establishment until MFA is set up
}
```

When using an external IdP, prefer enforcing MFA via that IdP's conditional-access policy
for the admin app registration rather than reimplementing TOTP locally.

---

## Check G — Token validation misconfigured (AUTH-007)

### Detection

Grep `TokenValidationParameters` for `ValidateIssuer = false`, `ValidateAudience = false`,
or `ValidateLifetime = false`, and check `ClockSkew` for the library default of 5 minutes
left unexamined on a flow where that tolerance is inappropriate (e.g., short-lived
step-up-auth tokens for a payment confirmation). Disabling issuer/audience validation
means a token minted for a *different* app or a different environment will validate here.

### BAD — issuer/audience checks disabled, default skew unexamined

```csharp
options.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = false,   // a token from any issuer will pass
    ValidateAudience = false, // a token minted for a completely different API will pass
    ValidateLifetime = true
    // ClockSkew left at the library default (5 minutes) with no review
};
```

### GOOD — issuer/audience enforced, skew set deliberately

```csharp
options.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = true,
    ValidIssuer = builder.Configuration["Auth:Authority"],
    ValidateAudience = true,
    ValidAudience = builder.Configuration["Auth:Audience"],
    ValidateLifetime = true,
    ClockSkew = TimeSpan.FromMinutes(1) // tightened deliberately for a high-security flow
};
```

---

## Check H — Login endpoint with no rate limiting (AUTH-008)

### Detection

Confirm the login/token endpoint has a `.RequireRateLimiting(...)` policy attached. This
check overlaps `dotnet-rate-limiting` RL-001 directly — flag it here as an authentication
gap too, since an unthrottled login endpoint undermines every other control in this skill:
a strong password policy and MFA both still allow unlimited guesses if nothing throttles
the attempts.

### BAD — login endpoint accepts unlimited attempts per second

```csharp
app.MapPost("/api/auth/login", async (LoginDto dto, IAuthService auth) =>
{
    var result = await auth.LoginAsync(dto.Email, dto.Password);
    return result.Succeeded ? Results.Ok(result.Token) : Results.Unauthorized();
});
```

### GOOD — dedicated rate-limit policy applied (see dotnet-rate-limiting RL-001 for the full policy definition)

```csharp
app.MapPost("/api/auth/login", async (LoginDto dto, IAuthService auth) => { ... })
   .RequireRateLimiting("auth");
```

Authentication establishes *identity*; it says nothing about what that identity is allowed
to do — every check in this skill feeds into `dotnet-authorization`'s permission-based
access control, which governs the request from that point forward.
