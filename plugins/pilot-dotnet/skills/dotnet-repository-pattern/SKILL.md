---
name: dotnet-repository-pattern
description: Reviews when and how the repository pattern should sit over EF Core — flags interfaces that leak IQueryable<T> to callers, generic IRepository<T> wrappers with no added value over DbContext.Set<T>(), missing Unit of Work coordination across multiple repositories, absent Specification pattern for reusable complex queries, and repository method names that leak SQL-specific concepts. Outputs findings with pilot-dotnet repository-pattern standard IDs.
when_to_use: repository pattern, IRepository, IQueryable leak, Unit of Work, IUnitOfWork, Specification pattern, DbContext.Set, generic repository, domain method naming, EF Core abstraction
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| RP-001 | P1 | Repository interface exposes IQueryable<T> to callers |
| RP-002 | P3 | Generic IRepository<T> adds no behavior over DbContext.Set<T>() (advisory) |
| RP-003 | P1 | No Unit of Work — multiple SaveChanges() calls per business operation |
| RP-004 | P2 | Complex query logic duplicated instead of using a Specification |
| RP-005 | P2 | Repository method names leak SQL-specific concepts |

---

## Check A — IQueryable leaking through the abstraction

### Detection

1. Search repository interfaces for methods returning `IQueryable<T>`.
2. If callers outside the repository compose further `.Where()`/`.Include()`/`.OrderBy()` on the returned queryable, the abstraction provides no isolation from EF Core — flag RP-001.

### BAD — IQueryable leaks EF Core composition to callers

```csharp
public interface IOrderRepository
{
    IQueryable<Order> GetOrders();
}

public class OrderRepository : IOrderRepository
{
    private readonly AppDbContext _db;
    public OrderRepository(AppDbContext db) => _db = db;

    public IQueryable<Order> GetOrders() => _db.Orders;
}

// Caller composes arbitrary EF Core-specific queries — the "abstraction" hides nothing.
public class OrderReportService
{
    private readonly IOrderRepository _repo;
    public OrderReportService(IOrderRepository repo) => _repo = repo;

    public async Task<List<Order>> GetActiveOrdersAsync(int customerId) =>
        await _repo.GetOrders()
            .Where(o => o.CustomerId == customerId && o.Status == OrderStatus.Active)
            .Include(o => o.LineItems)
            .ToListAsync();
}
```

### GOOD — intention-revealing methods, no leaked IQueryable

```csharp
public interface IOrderRepository
{
    Task<List<Order>> GetActiveOrdersForCustomerAsync(int customerId, CancellationToken ct = default);
    Task<Order?> GetByIdWithLineItemsAsync(int orderId, CancellationToken ct = default);
}

public class OrderRepository : IOrderRepository
{
    private readonly AppDbContext _db;
    public OrderRepository(AppDbContext db) => _db = db;

    public Task<List<Order>> GetActiveOrdersForCustomerAsync(int customerId, CancellationToken ct = default) =>
        _db.Orders
            .Where(o => o.CustomerId == customerId && o.Status == OrderStatus.Active)
            .Include(o => o.LineItems)
            .ToListAsync(ct);

    public Task<Order?> GetByIdWithLineItemsAsync(int orderId, CancellationToken ct = default) =>
        _db.Orders.Include(o => o.LineItems)
            .FirstOrDefaultAsync(o => o.Id == orderId, ct);
}
```

---

## Check B — Generic IRepository<T> with no added value (advisory)

### Detection

1. Look for a generic `IRepository<T>` whose implementation forwards every call straight to `DbContext.Set<T>()` with no caching, no query centralization, and no persistence-swapping justification.
2. This is advisory (P3) — repositories add real value when you need to swap persistence, add caching, or centralize complex queries. A pure pass-through adds indirection without behavior.

### BAD — pass-through generic repository, no behavior added

```csharp
public interface IRepository<T> where T : class
{
    Task<T?> GetByIdAsync(int id);
    Task<List<T>> GetAllAsync();
    Task AddAsync(T entity);
}

public class Repository<T> : IRepository<T> where T : class
{
    private readonly AppDbContext _db;
    public Repository(AppDbContext db) => _db = db;

    public Task<T?> GetByIdAsync(int id) => _db.Set<T>().FindAsync(id).AsTask();
    public Task<List<T>> GetAllAsync() => _db.Set<T>().ToListAsync();
    public Task AddAsync(T entity) => _db.Set<T>().AddAsync(entity).AsTask();
}
// No caching, no query centralization, no persistence abstraction — just DbContext.Set<T>() in disguise.
```

### GOOD — use DbContext directly, or add a repository only where it earns its keep

```csharp
// Option 1: skip the repository entirely for simple CRUD — inject AppDbContext directly.
public class ProductService
{
    private readonly AppDbContext _db;
    public ProductService(AppDbContext db) => _db = db;

    public Task<Product?> GetByIdAsync(int id) => _db.Products.FindAsync(id).AsTask();
}

// Option 2: a focused repository that earns its abstraction via caching + domain queries.
public interface IProductCatalogRepository
{
    Task<Product?> GetByIdAsync(int id); // cached
    Task<List<Product>> GetFeaturedProductsAsync();
}

public class CachedProductCatalogRepository : IProductCatalogRepository
{
    private readonly AppDbContext _db;
    private readonly IMemoryCache _cache;

    public CachedProductCatalogRepository(AppDbContext db, IMemoryCache cache)
    {
        _db = db;
        _cache = cache;
    }

    public Task<Product?> GetByIdAsync(int id) =>
        _cache.GetOrCreateAsync($"product:{id}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
            return await _db.Products.FindAsync(id);
        });

    public Task<List<Product>> GetFeaturedProductsAsync() =>
        _db.Products.Where(p => p.IsFeatured).ToListAsync();
}
```

---

## Check C — Missing Unit of Work coordination

### Detection

1. Search a single business/application-service method for calls to more than one repository, each independently calling its own `SaveChanges()`/`SaveChangesAsync()`.
2. If a failure between the two calls could leave the operation half-committed → RP-003.

### BAD — two repositories, two independent SaveChanges calls

```csharp
public class TransferService
{
    private readonly IAccountRepository _accounts;
    private readonly ILedgerRepository _ledger;

    public TransferService(IAccountRepository accounts, ILedgerRepository ledger)
    {
        _accounts = accounts;
        _ledger = ledger;
    }

    public async Task TransferAsync(int fromId, int toId, decimal amount)
    {
        await _accounts.DebitAsync(fromId, amount);
        await _accounts.SaveChangesAsync();       // commit #1

        await _ledger.RecordTransferAsync(fromId, toId, amount);
        await _ledger.SaveChangesAsync();          // commit #2 — if this throws, debit already committed
    }
}
```

### GOOD — single Unit of Work wraps both repository writes

```csharp
public interface IUnitOfWork
{
    IAccountRepository Accounts { get; }
    ILedgerRepository Ledger { get; }
    Task<int> SaveChangesAsync(CancellationToken ct = default);
}

public class UnitOfWork : IUnitOfWork
{
    private readonly AppDbContext _db;
    public IAccountRepository Accounts { get; }
    public ILedgerRepository Ledger { get; }

    public UnitOfWork(AppDbContext db, IAccountRepository accounts, ILedgerRepository ledger)
    {
        _db = db;
        Accounts = accounts;
        Ledger = ledger;
    }

    public Task<int> SaveChangesAsync(CancellationToken ct = default) => _db.SaveChangesAsync(ct);
}

public class TransferService
{
    private readonly IUnitOfWork _uow;
    public TransferService(IUnitOfWork uow) => _uow = uow;

    public async Task TransferAsync(int fromId, int toId, decimal amount)
    {
        await _uow.Accounts.DebitAsync(fromId, amount);
        await _uow.Ledger.RecordTransferAsync(fromId, toId, amount);
        await _uow.SaveChangesAsync(); // single atomic commit for the whole operation
    }
}
```

---

## Check D — Missing Specification pattern for reusable complex queries

### Detection

1. Search for the same or near-identical `.Where()`/`.Include()` chain duplicated across two or more repository methods.
2. If the duplication involves 3+ conditions repeated verbatim → RP-004.

### BAD — the same complex filter duplicated across methods

```csharp
public class OrderRepository
{
    public Task<List<Order>> GetActiveHighValueOrdersAsync(int customerId) =>
        _db.Orders
            .Where(o => o.CustomerId == customerId
                && o.Status == OrderStatus.Active
                && o.Total > 1000)
            .Include(o => o.LineItems)
            .ToListAsync();

    public Task<int> CountActiveHighValueOrdersAsync(int customerId) =>
        _db.Orders
            .Where(o => o.CustomerId == customerId
                && o.Status == OrderStatus.Active
                && o.Total > 1000) // duplicated condition set
            .CountAsync();
}
```

### GOOD — Specification pattern centralizes the query logic once

```csharp
public class ActiveHighValueOrdersSpec
{
    public int CustomerId { get; }
    public ActiveHighValueOrdersSpec(int customerId) => CustomerId = customerId;

    public IQueryable<Order> Apply(IQueryable<Order> query) =>
        query.Where(o => o.CustomerId == CustomerId
            && o.Status == OrderStatus.Active
            && o.Total > 1000);
}

public class OrderRepository
{
    private readonly AppDbContext _db;
    public OrderRepository(AppDbContext db) => _db = db;

    public Task<List<Order>> GetActiveHighValueOrdersAsync(int customerId)
    {
        var spec = new ActiveHighValueOrdersSpec(customerId);
        return spec.Apply(_db.Orders).Include(o => o.LineItems).ToListAsync();
    }

    public Task<int> CountActiveHighValueOrdersAsync(int customerId)
    {
        var spec = new ActiveHighValueOrdersSpec(customerId);
        return spec.Apply(_db.Orders).CountAsync();
    }
}
```

---

## Check E — Method names leaking SQL-specific concepts

### Detection

Grep repository interfaces for method names containing `Sql`, `Query`, `Proc`, `Sp`, or raw table/column terminology instead of domain language describing intent.

### BAD — SQL-flavored method names

```csharp
public interface IOrderRepository
{
    Task<List<Order>> GetBySqlAsync(string status, int customerId);
    Task<List<Order>> ExecOrdersQueryAsync();
}
```

### GOOD — domain-language method names

```csharp
public interface IOrderRepository
{
    Task<List<Order>> GetActiveOrdersForCustomerAsync(int customerId);
    Task<List<Order>> GetOrdersAwaitingFulfillmentAsync();
}
```

**Detection rule:** flag any repository interface method whose name (case-insensitive) contains `Sql`, `Query` (when used as a suffix like `*Query`), `StoredProc`, or `Exec`, and recommend a name expressing business intent instead.
