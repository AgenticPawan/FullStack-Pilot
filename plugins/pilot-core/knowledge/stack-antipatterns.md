# Stack Antipatterns — FullStack Pilot Multi-Stack Reference

> Patterns Claude must never generate. Each entry: BAD snippet → WHY → GOOD replacement.
> Covered stacks: Angular, .NET, SQL Server, Azure/Bicep.

---

## Angular / TypeScript

### ANG-001: `subscribe()` without cleanup

**BAD**
```typescript
ngOnInit() {
  this.userService.getUsers().subscribe(users => this.users = users);
}
```

**WHY**: Subscription lives past component destruction → memory leak across route navigations.

**GOOD**
```typescript
private destroyRef = inject(DestroyRef);

ngOnInit() {
  this.userService.getUsers()
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe(users => this.users = users);
}
```

---

### ANG-002: `ngOnDestroy` + Subject boilerplate

**BAD**
```typescript
private destroy$ = new Subject<void>();
ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
```

**WHY**: 5-line boilerplate per component; Angular 16+ ships `takeUntilDestroyed` as the right abstraction.

**GOOD**: Use `takeUntilDestroyed(this.destroyRef)`. No `ngOnDestroy` needed.

---

### ANG-003: `: any` type bindings

**BAD**
```typescript
getUserData(): any { ... }
@Input() config: any;
```

**WHY**: Defeats the type system. Compiler misses shape mismatches; IDE loses autocomplete.

**GOOD**
```typescript
getUserData(): UserDto { ... }
@Input() config: ChartConfig;
```

---

### ANG-004: Importing `BrowserModule` in lazy modules

**BAD**
```typescript
@NgModule({ imports: [BrowserModule, ...] })
export class FeatureModule {}
```

**WHY**: `BrowserModule` must only import once in `AppModule`. Lazy module re-import throws a runtime error.

**GOOD**: Import `CommonModule` or nothing in standalone components.

---

### ANG-005: Property mutation for local state in Angular 17+

**BAD**
```typescript
isLoading = false; // + manual markForCheck() or zone triggers
```

**WHY**: Forces full zone-based change detection cycles. Signals are more precise and required by Zoneless Angular.

**GOOD**
```typescript
isLoading = signal(false);
// template: @if (isLoading()) { <spinner /> }
```

---

## .NET / C#

### NET-001: `DateTime.Now` instead of `TimeProvider`

**BAD**
```csharp
var expires = DateTime.Now.AddMinutes(30);
```

**WHY**: Untestable — tests cannot freeze or advance time. Produces local timestamps that break across timezones.

**GOOD**
```csharp
// Inject TimeProvider; use FakeTimeProvider in tests
var expires = _timeProvider.GetUtcNow().AddMinutes(30);
```

---

### NET-002: `new HttpClient()` instead of `IHttpClientFactory`

**BAD**
```csharp
var client = new HttpClient();
var response = await client.GetAsync(url);
```

**WHY**: One new socket per call → socket exhaustion under load; DNS TTL changes not respected.

**GOOD**
```csharp
// DI: builder.Services.AddHttpClient<MyService>();
public MyService(HttpClient client) { _client = client; }
```

---

### NET-003: `async void` methods

**BAD**
```csharp
public async void ProcessOrder(Order order) { await _repo.SaveAsync(order); }
```

**WHY**: Exceptions thrown inside crash the process unhandled. Callers cannot await the result.

**GOOD**
```csharp
public async Task ProcessOrderAsync(Order order) { await _repo.SaveAsync(order); }
```

Exception: event handler delegates where `void` is required by the signature.

---

### NET-004: Sync-over-async deadlock (`.Result`, `.GetAwaiter().GetResult()`)

**BAD**
```csharp
var user = _userService.GetUserAsync(id).Result; // deadlocks ASP.NET Core
```

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

**WHY**: Swallows critical runtime exceptions and hides bugs from callers.

**GOOD**
```csharp
catch (DbException ex) when (ex.IsTransient) { /* retry */ }
catch (ValidationException ex) { return Result.Failure(ex.Errors); }
// Let unexpected exceptions propagate — global handler owns them
```

---

### NET-006: Repository pattern wrapping EF Core (see ADR-003)

**BAD**
```csharp
public interface IUserRepository { Task<User> GetByIdAsync(Guid id); }
```

**WHY**: `DbContext` IS the unit of work and repository. Wrapping adds two abstraction layers: harder to test, no LINQ composition, can't use query filters.

**GOOD**: Inject `AppDbContext` directly. For testing, use an in-memory provider or Testcontainers.

---

## SQL Server / EF Core

### SQL-001: `SELECT *` in application queries

**BAD**
```sql
SELECT * FROM Orders WHERE TenantId = @tid
```

**WHY**: Over-fetches unused columns; breaks when schema changes; prevents covering index usage.

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

**WHY**: Returns all tenant rows. One misconfigured query leaks all customer data.

**GOOD**: Enforce via global query filter at DbContext level. See ADR-005.

---

### SQL-003: Missing index on FK columns

**WHY**: Every join or FK lookup does a full table scan without an index.

**GOOD**: `HasIndex(o => o.CustomerId)` in `OnModelCreating`, or `CREATE INDEX IX_Orders_CustomerId ON Orders (CustomerId)`.

---

### SQL-004: `nvarchar(max)` on every column

**WHY**: Prevents index key usage (>900-byte limit). Wastes storage for short strings.

**GOOD**: `HasMaxLength(256)` for emails; choose appropriate lengths per column purpose.

---

## Azure / Bicep

### AZR-001: Hardcoded secrets in `parameters.json`

**BAD**
```json
{ "adminPassword": { "value": "MyP@ssword123!" } }
```

**WHY**: Parameters files get committed. Secret is in git history forever.

**GOOD**: Reference Key Vault secrets: `param adminPassword string = kv.getSecret('adminPassword')`.

---

### AZR-002: Wide firewall rules (`allowAllWindowsAzureIps`, 0.0.0.0–255.255.255.255)

**WHY**: Exposes the database to the entire internet or to all other Azure tenants.

**GOOD**: Private endpoints or VNet-restricted rules. See `azure-security-baseline`.

---

### AZR-003: Missing resource locks on production resources

**WHY**: A runbook error or accidental CLI command can permanently delete the resource.

**GOOD**
```bicep
resource storageLock 'Microsoft.Authorization/locks@2020-05-01' = {
  scope: storage
  properties: { level: 'CanNotDelete', notes: 'Production — unlock required before deletion.' }
}
```
