# Common Antipatterns — FullStack Pilot Multi-Stack Reference

> Patterns Claude must never generate. Each entry: BAD snippet → WHY → GOOD replacement.
> Covered stacks: Angular, .NET, SQL Server, Azure/Bicep.

---

## Angular / TypeScript

### ANG-001: `subscribe()` without cleanup

**BAD**
```typescript
// Component
ngOnInit() {
  this.userService.getUsers().subscribe(users => this.users = users);
}
```

**WHY**: Subscription lives past component destruction → memory leak. Multiplied across route navigations, this degrades the whole SPA.

**GOOD**
```typescript
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

private destroyRef = inject(DestroyRef);

ngOnInit() {
  this.userService.getUsers()
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe(users => this.users = users);
}
```

---

### ANG-002: `ngOnDestroy` + Subject boilerplate instead of `takeUntilDestroyed`

**BAD**
```typescript
private destroy$ = new Subject<void>();
ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
```

**WHY**: 5-line boilerplate per component, error-prone when a developer forgets to call next(). Angular 16+ ships the right abstraction.

**GOOD**: Inject `DestroyRef`, use `takeUntilDestroyed(this.destroyRef)`. No ngOnDestroy needed.

---

### ANG-003: `: any` type bindings

**BAD**
```typescript
getUserData(): any { ... }
@Input() config: any;
```

**WHY**: Defeats TypeScript's type system. Compiler cannot catch shape mismatches; IDE loses autocomplete; refactoring tools fail silently.

**GOOD**
```typescript
getUserData(): UserDto { ... }
@Input() config: ChartConfig;
```

---

### ANG-004: Importing `BrowserModule` in a lazy-loaded module

**BAD**
```typescript
@NgModule({ imports: [BrowserModule, ...] })
export class FeatureModule {}
```

**WHY**: `BrowserModule` must only be imported once in `AppModule`. Re-importing in a lazy module throws a runtime error.

**GOOD**: Import `CommonModule` (or nothing in standalone components using `@if`/`@for`).

---

### ANG-005: Skipping signals for local state in Angular 17+

**BAD**
```typescript
isLoading = false;
// + manual change detection or zone triggers
```

**WHY**: Zone.js-based property mutation forces full change detection cycles. Signals are more precise, testable, and required by future Zoneless Angular.

**GOOD**
```typescript
isLoading = signal(false);
// template: @if (isLoading()) { ... }
```

---

## .NET / C#

### NET-001: `DateTime.Now` instead of `TimeProvider`

**BAD**
```csharp
var expires = DateTime.Now.AddMinutes(30);
```

**WHY**: Untestable — you cannot freeze or advance time in unit tests. Produces local-time timestamps that cause bugs across timezones.

**GOOD**
```csharp
// Inject Microsoft.Extensions.Time.Testing.FakeTimeProvider in tests
var expires = _timeProvider.GetUtcNow().AddMinutes(30);
```

---

### NET-002: `new HttpClient()` instead of `IHttpClientFactory`

**BAD**
```csharp
var client = new HttpClient();
var response = await client.GetAsync(url);
```

**WHY**: Creates a new socket per call. Socket exhaustion under load; DNS changes not respected.

**GOOD**
```csharp
// In DI setup: builder.Services.AddHttpClient<MyService>();
// In service:
public MyService(HttpClient client) { _client = client; }
```

---

### NET-003: `async void` methods

**BAD**
```csharp
public async void ProcessOrder(Order order) { await _repo.SaveAsync(order); }
```

**WHY**: Exceptions thrown inside `async void` crash the process unhandled. Callers cannot await or observe the result.

**GOOD**
```csharp
public async Task ProcessOrderAsync(Order order) { await _repo.SaveAsync(order); }
```

Exception: event handler delegates where `void` is required by the signature.

---

### NET-004: `.Result` and `.GetAwaiter().GetResult()` — sync-over-async deadlock

**BAD**
```csharp
var user = _userService.GetUserAsync(id).Result;
```

**WHY**: In ASP.NET Core, the synchronization context deadlock kills the request thread. No performance gain, worse throughput.

**GOOD**
```csharp
var user = await _userService.GetUserAsync(id);
```

---

### NET-005: Catching `Exception` broadly

**BAD**
```csharp
catch (Exception ex) { _logger.LogError(ex, "Something failed"); return null; }
```

**WHY**: Swallows `OutOfMemoryException`, `StackOverflowException`, `ThreadAbortException`, and real bugs. Return null hides the failure from callers.

**GOOD**
```csharp
catch (DbException ex) when (ex.IsTransient) { /* retry */ }
catch (ValidationException ex) { return Result.Failure(ex.Errors); }
// Let unexpected exceptions propagate — global error handler owns them
```

---

### NET-006: Repository pattern wrapping EF Core

**BAD**
```csharp
public interface IUserRepository { Task<User> GetByIdAsync(Guid id); }
public class UserRepository : IUserRepository { ... }
// Then injecting IUserRepository everywhere
```

**WHY**: `DbContext` IS the unit of work and IS the repository. Wrapping it adds two layers of abstraction with no benefit: harder to test (need to mock a mock), harder to use LINQ, can't compose queries. See ADR-003.

**GOOD**: Inject `AppDbContext` (or an interface for it) directly where needed.

---

## SQL Server / EF Core

### SQL-001: `SELECT *` in application queries

**BAD**
```sql
SELECT * FROM Orders WHERE TenantId = @tid
```

**WHY**: Fetches columns the application never uses. Breaks when columns are added (over-fetch) or renamed (silent null). Prevents covering index utilization.

**GOOD**
```sql
SELECT OrderId, CustomerId, TotalAmount, CreatedAt FROM Orders WHERE TenantId = @tid
```

---

### SQL-002: Missing tenant filter in multi-tenant queries

**BAD**
```csharp
return await _db.Orders.Where(o => o.Status == status).ToListAsync();
```

**WHY**: Returns rows from all tenants. One misconfigured query leaks all customer data.

**GOOD**: Enforce the tenant filter at DbContext level via a global query filter. See ADR-005.
```csharp
modelBuilder.Entity<Order>().HasQueryFilter(o => o.TenantId == _tenantContext.TenantId);
```

---

### SQL-003: Missing index on foreign key columns

**BAD**
```sql
-- Orders.CustomerId references Customers.Id — no index on CustomerId
SELECT * FROM Orders WHERE CustomerId = @id  -- full table scan
```

**WHY**: Every join or foreign-key lookup does a full table scan. Slows all queries touching the relationship.

**GOOD**
```sql
CREATE INDEX IX_Orders_CustomerId ON Orders (CustomerId);
```
Or in EF Core: `HasIndex(o => o.CustomerId)` in `OnModelCreating`.

---

### SQL-004: `nvarchar(max)` on every column

**BAD**
```csharp
modelBuilder.Entity<User>().Property(u => u.Email).HasColumnType("nvarchar(max)");
```

**WHY**: Prevents the column from being used in an index key (>900-byte limit). Wastes storage for short strings.

**GOOD**
```csharp
modelBuilder.Entity<User>().Property(u => u.Email).HasMaxLength(256);
```

---

## Azure / Bicep

### AZR-001: Hardcoded secrets in `parameters.json`

**BAD**
```json
{ "adminPassword": { "value": "MyP@ssword123!" } }
```

**WHY**: Parameters files are typically committed to source control. One leaked `parameters.json` exposes the secret forever via git history.

**GOOD**: Reference Key Vault secrets:
```bicep
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: keyVaultName }
param adminPassword string = kv.getSecret('adminPassword')
```

---

### AZR-002: `allowAllWindowsAzureIps` or wide firewall rules

**BAD**
```bicep
firewallRules: [{ startIpAddress: '0.0.0.0', endIpAddress: '255.255.255.255' }]
```

**WHY**: Exposes the database to the entire internet. "Allow Azure services" (0.0.0.0) also allows other Azure tenants.

**GOOD**: Use private endpoints or restrict to known VNet subnets. See `azure-security-baseline`.

---

### AZR-003: Missing resource locks on production resources

**BAD**
```bicep
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = { ... }
// No lock — anyone with Contributor can delete it
```

**WHY**: A runbook error or accidental CLI command can delete the storage account and all its data permanently.

**GOOD**
```bicep
resource storageLock 'Microsoft.Authorization/locks@2020-05-01' = {
  scope: storage
  name: '${storage.name}-lock'
  properties: { level: 'CanNotDelete', notes: 'Production resource — deletion requires lock removal.' }
}
```
