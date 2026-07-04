---
name: dotnet-soft-delete
description: Reviews the EF Core soft-delete pattern in ASP.NET Core apps. Flags soft-deletable entities missing a global query filter, direct DbContext.Remove() calls that bypass a hard-to-soft-delete interceptor, unique indexes not filtered to exclude deleted rows, un-cascaded soft deletes that orphan active children, and missing DeletedBy/DeletedAt audit pairs. Outputs findings with pilot-dotnet soft-delete standard IDs; cross-references the dotnet-audit-fields skill for the general audit-trail pattern.
when_to_use: soft delete, IsDeleted, DeletedAt, ISoftDelete, SaveChanges interceptor, global query filter delete, filtered unique index, cascade soft delete, orphaned children, DeletedBy, audit trail delete, logical delete
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| SFD-001 | P0 | Soft-deletable entity has no global query filter excluding `IsDeleted`/`DeletedAt` rows |
| SFD-002 | P0 | `DbContext.Remove()` called directly instead of being intercepted into a soft delete |
| SFD-003 | P1 | Unique index/constraint not filtered to exclude soft-deleted rows |
| SFD-004 | P1 | Cascade not considered — child rows not soft-deleted alongside soft-deleted parent |
| SFD-005 | P2 | Only a boolean `IsDeleted` flag exists, no `DeletedBy`/`DeletedAt` audit pair |

---

## Check A — Missing global query filter for soft-deletable entities

### Detection

1. Glob `**/*.cs` for entities implementing `ISoftDelete` or having an `IsDeleted` property.
2. In `OnModelCreating`, verify each such entity has `HasQueryFilter(e => !e.IsDeleted)`.
3. Missing filter → SFD-001; soft-deleted rows keep showing up in every default query.

### BAD — entity with IsDeleted, no filter

```csharp
public class Customer : ISoftDelete
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool IsDeleted { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}

protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<Customer>().ToTable("Customers");
    // Missing: .HasQueryFilter(c => !c.IsDeleted);
}
```

### GOOD — filter applied for every ISoftDelete entity

```csharp
public interface ISoftDelete
{
    bool IsDeleted { get; set; }
    DateTimeOffset? DeletedAt { get; set; }
    string? DeletedBy { get; set; }
}

protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    foreach (var entityType in modelBuilder.Model.GetEntityTypes())
    {
        if (typeof(ISoftDelete).IsAssignableFrom(entityType.ClrType))
        {
            var parameter = Expression.Parameter(entityType.ClrType, "e");
            var property = Expression.Property(parameter, nameof(ISoftDelete.IsDeleted));
            var condition = Expression.Lambda(Expression.Not(property), parameter);

            modelBuilder.Entity(entityType.ClrType).HasQueryFilter(condition);
        }
    }
}
```

---

## Check B — `Remove()` bypassing the soft-delete interceptor

### Detection

1. Grep for `_db.Remove(`, `_db.Set<T>().Remove(`, `DbContext.Remove(` on entities that
   implement `ISoftDelete`.
2. If no `SaveChanges`/`SaveChangesAsync` override or `ISaveChangesInterceptor` converts
   these into an update flipping `IsDeleted = true`, flag SFD-002 — the row is physically
   deleted despite the entity being designed for soft delete.

### BAD — hard delete on a soft-deletable entity

```csharp
public async Task DeleteCustomerAsync(int id)
{
    var customer = await _db.Customers.FindAsync(id);
    _db.Remove(customer); // bypasses soft delete entirely — row is gone
    await _db.SaveChangesAsync();
}
```

### GOOD — `SaveChanges` interceptor converts hard deletes to soft deletes

```csharp
public class SoftDeleteInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData, InterceptionResult<int> result)
    {
        ConvertDeletesToSoftDeletes(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        ConvertDeletesToSoftDeletes(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private static void ConvertDeletesToSoftDeletes(DbContext? context)
    {
        if (context is null) return;

        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.State != EntityState.Deleted || entry.Entity is not ISoftDelete softDelete)
            {
                continue;
            }

            entry.State = EntityState.Modified;
            softDelete.IsDeleted = true;
            softDelete.DeletedAt = DateTimeOffset.UtcNow;
            softDelete.DeletedBy = TenantAwareCurrentUser.UserIdOrNull;
        }
    }
}

// Program.cs
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(connectionString)
           .AddInterceptors(new SoftDeleteInterceptor()));
```

---

## Check C — Unique constraints not filtered for soft-deleted rows

### Detection

1. Grep `HasIndex(...).IsUnique()` for entities implementing `ISoftDelete`.
2. If the index has no `.HasFilter(...)` excluding deleted rows, flag SFD-003 — a
   soft-deleted row's unique value (e.g., email) permanently blocks re-registration.

### BAD — unique index blocks re-registration after soft delete

```csharp
modelBuilder.Entity<Customer>()
    .HasIndex(c => c.Email)
    .IsUnique();
// Soft-deleting a customer and later re-inviting the same email throws a
// unique-constraint violation, because the "deleted" row still occupies the slot.
```

### GOOD — filtered unique index excludes soft-deleted rows

```csharp
modelBuilder.Entity<Customer>()
    .HasIndex(c => c.Email)
    .IsUnique()
    .HasFilter("[IsDeleted] = 0");
```

---

## Check D — Cascade behavior for soft-deleted parents

### Detection

1. For each soft-deletable parent entity, find its dependent/child entities
   (navigation properties, FK relationships).
2. Check whether the delete/soft-delete path also marks children as deleted, or at least
   excludes them via a query filter that considers the parent's state.
3. If children remain `IsDeleted = false` while their parent is soft-deleted, flag SFD-004
   — "active" children now dangle under a logically nonexistent parent.

### BAD — parent soft-deleted, children left active

```csharp
public async Task DeleteOrderAsync(int orderId)
{
    var order = await _db.Orders
        .Include(o => o.LineItems)
        .SingleAsync(o => o.Id == orderId);

    order.IsDeleted = true;
    order.DeletedAt = DateTimeOffset.UtcNow;
    // LineItems are untouched — they still report IsDeleted = false,
    // yet their parent Order no longer appears in any filtered query.
    await _db.SaveChangesAsync();
}
```

### GOOD — cascade soft delete to children explicitly

```csharp
public async Task DeleteOrderAsync(int orderId)
{
    var order = await _db.Orders
        .Include(o => o.LineItems)
        .SingleAsync(o => o.Id == orderId);

    var now = DateTimeOffset.UtcNow;
    var deletedBy = _currentUser.UserId;

    order.IsDeleted = true;
    order.DeletedAt = now;
    order.DeletedBy = deletedBy;

    foreach (var lineItem in order.LineItems)
    {
        lineItem.IsDeleted = true;
        lineItem.DeletedAt = now;
        lineItem.DeletedBy = deletedBy;
    }

    await _db.SaveChangesAsync();
}
```

For deep or variable-depth graphs, prefer folding this cascade logic into the
`SoftDeleteInterceptor` from Check B so every call site gets it automatically instead of
relying on each service method to remember.

---

## Check E — Missing `DeletedBy`/`DeletedAt` audit pair

### Detection

1. Grep entities implementing `ISoftDelete` (or with an `IsDeleted` bool) for companion
   `DeletedAt` and `DeletedBy` properties.
2. A bare `IsDeleted` boolean with no timestamp or actor field is a compliance/forensics
   gap — flag SFD-005. This is the delete-specific instance of the general audit-trail
   pattern; see the `dotnet-audit-fields` skill for `CreatedBy`/`CreatedAt`/`ModifiedBy`/
   `ModifiedAt` conventions that this pairs with.

### BAD — flag only, no audit trail

```csharp
public class Customer : ISoftDelete
{
    public int Id { get; set; }
    public bool IsDeleted { get; set; }
    // No DeletedAt, no DeletedBy — impossible to answer "when and by whom"
}
```

### GOOD — full audit pair alongside the flag

```csharp
public class Customer : ISoftDelete
{
    public int Id { get; set; }
    public bool IsDeleted { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }
}
```
