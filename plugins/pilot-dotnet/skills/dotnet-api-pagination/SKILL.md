---
name: dotnet-api-pagination
description: Reviews pagination, filtering, and sorting conventions on ASP.NET Core list endpoints. Flags list endpoints with no paging at all, inconsistent paging shapes across endpoints with no shared request DTO, offset/skip-based paging used on high-write frequently-reordered data instead of cursor/keyset pagination, response envelopes missing total-count/hasMore metadata, sort/filter fields concatenated into a query instead of an allow-listed sortable-fields mechanism, and no max page-size cap. Outputs findings with pilot-dotnet api-pagination standard IDs.
when_to_use: pagination, paging, page size, pageSize, skip take, cursor pagination, keyset pagination, offset pagination, total count, hasMore, sortable fields, sort allow-list, list endpoint, unbounded query, max page size cap
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| PAG-001 | P0 | List endpoint returns an unbounded full table scan with no paging at all |
| PAG-002 | P2 | Paging shape is inconsistent across endpoints with no shared request DTO/convention |
| PAG-003 | P1 | Offset/skip-based paging used on a high-write, frequently-reordered dataset instead of cursor/keyset pagination |
| PAG-004 | P2 | Response envelope has no total-count/hasMore metadata |
| PAG-005 | P0 | Sort/filter fields concatenated into a query instead of an allow-listed sortable-fields mechanism |
| PAG-006 | P1 | No max page-size cap, letting a client defeat paging entirely |

---

## Check A — List endpoint with no paging at all (PAG-001)

### Detection

Grep controller/minimal-API list actions for `.ToListAsync()` or `.ToList()` called
directly against a `DbSet`/`IQueryable` with no `.Skip(...)`/`.Take(...)`, cursor filter, or
equivalent applied first. A table that has 200 rows in dev and 2 million in production will
pass code review and then take the database down the first time it's called against real
data.

### BAD — full table materialized on every request

```csharp
[HttpGet("orders")]
public async Task<IActionResult> GetOrders()
{
    var orders = await _db.Orders.ToListAsync(); // every row, every call, forever
    return Ok(orders);
}
```

### GOOD — paging applied unconditionally, before any other work

```csharp
[HttpGet("orders")]
public async Task<IActionResult> GetOrders([FromQuery] PagedRequest request)
{
    var page = await _db.Orders
        .OrderBy(o => o.Id)
        .Skip((request.Page - 1) * request.PageSize)
        .Take(request.PageSize)
        .ToListAsync();

    return Ok(page);
}
```

---

## Check B — Inconsistent paging shape across endpoints (PAG-002)

### Detection

Compare query parameter names and response envelope shapes across list endpoints in the
same API. Flag PAG-002 when one endpoint uses `page`/`pageSize`, another uses `skip`/`take`,
and a third uses `cursor`/`limit` with no shared base request/response DTO — every client
integration has to special-case each endpoint's conventions instead of writing one generic
paging helper.

### BAD — three endpoints, three different paging vocabularies

```csharp
[HttpGet("orders")]
public async Task<IActionResult> GetOrders(int page, int pageSize) { ... }

[HttpGet("customers")]
public async Task<IActionResult> GetCustomers(int skip, int take) { ... }

[HttpGet("invoices")]
public async Task<IActionResult> GetInvoices(string cursor, int limit) { ... }
// A client SDK needs three separate paging implementations for one API.
```

### GOOD — one shared request/response convention reused everywhere

```csharp
public record PagedRequest
{
    private const int MaxPageSize = 100;
    public int Page { get; init; } = 1;

    private int _pageSize = 25;
    public int PageSize
    {
        get => _pageSize;
        init => _pageSize = Math.Clamp(value, 1, MaxPageSize); // ties into Check F
    }
}

public record PagedResponse<T>(IReadOnlyList<T> Items, int TotalCount, bool HasMore); // ties into Check D

[HttpGet("orders")]
public async Task<ActionResult<PagedResponse<OrderDto>>> GetOrders([FromQuery] PagedRequest request) { ... }

[HttpGet("customers")]
public async Task<ActionResult<PagedResponse<CustomerDto>>> GetCustomers([FromQuery] PagedRequest request) { ... }
```

---

## Check C — Offset paging on high-write, reordered data instead of keyset pagination (PAG-003)

### Detection

For a dataset that is frequently inserted into or re-sorted (an activity feed, a live
order queue sorted by "most recently updated"), check whether paging is done with
`Skip(n)`. As rows are inserted ahead of the current page or the sort order shifts between
requests, `Skip`-based paging silently skips rows that moved past the offset or repeats rows
that moved backward — the client sees an inconsistent list with no error raised anywhere.

### BAD — skip-based paging on a feed that reorders between requests

```csharp
[HttpGet("activity-feed")]
public async Task<IActionResult> GetFeed(int page, int pageSize)
{
    // Between page 1 and page 2 requests, new activity rows can be inserted at the top,
    // shifting every row's offset and causing page 2 to repeat/skip rows from page 1.
    return Ok(await _db.Activities
        .OrderByDescending(a => a.UpdatedAt)
        .Skip((page - 1) * pageSize)
        .Take(pageSize)
        .ToListAsync());
}
```

### GOOD — keyset/cursor pagination anchored to a stable, indexed key

```csharp
[HttpGet("activity-feed")]
public async Task<IActionResult> GetFeed([FromQuery] string? cursor, int pageSize = 25)
{
    var cursorValue = cursor is null ? DateTime.MaxValue : CursorCodec.Decode(cursor);

    var items = await _db.Activities
        .Where(a => a.UpdatedAt < cursorValue) // anchors to the last-seen row, immune to inserts elsewhere
        .OrderByDescending(a => a.UpdatedAt)
        .Take(pageSize)
        .ToListAsync();

    var nextCursor = items.Count == pageSize ? CursorCodec.Encode(items[^1].UpdatedAt) : null;
    return Ok(new { items, nextCursor });
}
```

---

## Check D — No total-count/hasMore metadata (PAG-004)

### Detection

Check the response envelope for whether the client can determine it has reached the end of
the result set without making one extra request that comes back empty. A bare array with no
count or continuation signal forces every consumer to guess, typically by requesting one page
past the last one and treating an empty result as "done" — wasteful and error-prone if the
underlying data changed between requests.

### BAD — bare array, no way to know when paging is complete

```csharp
[HttpGet("orders")]
public async Task<IActionResult> GetOrders([FromQuery] PagedRequest request)
{
    var orders = await _db.Orders.Skip(...).Take(...).ToListAsync();
    return Ok(orders); // client has no idea if there's a next page without probing further
}
```

### GOOD — envelope carries total count and a hasMore flag

```csharp
[HttpGet("orders")]
public async Task<ActionResult<PagedResponse<OrderDto>>> GetOrders([FromQuery] PagedRequest request)
{
    var query = _db.Orders.OrderBy(o => o.Id);
    var totalCount = await query.CountAsync();
    var items = await query.Skip((request.Page - 1) * request.PageSize).Take(request.PageSize).ToListAsync();

    return Ok(new PagedResponse<OrderDto>(
        Items: items,
        TotalCount: totalCount,
        HasMore: request.Page * request.PageSize < totalCount));
}
```

---

## Check E — Sort/filter fields concatenated into the query (PAG-005)

### Detection

Grep for a `sortBy` or `filterField` query parameter interpolated directly into a raw SQL
string, a dynamic LINQ `OrderBy(sortField)` string call, or an `EF.Property<object>(entity,
sortField)` call fed straight from user input with no allow-list check first. Beyond the
SQL-injection risk this creates when raw SQL is involved (see `sql-injection-defense`), an
un-validated field name can also let a client sort/filter on a column that was never meant
to be queryable (internal flags, other tenants' foreign keys) or crash the endpoint entirely
on a bogus name.

### BAD — client-supplied field name flows straight into the query

```csharp
[HttpGet("orders")]
public async Task<IActionResult> GetOrders(string sortBy)
{
    // sortBy is whatever the client sends — no check that it's even a real, queryable column.
    var sql = $"SELECT * FROM Orders ORDER BY {sortBy}";
    return Ok(await _db.Orders.FromSqlRaw(sql).ToListAsync());
}
```

### GOOD — sortable fields allow-listed and mapped explicitly

```csharp
private static readonly Dictionary<string, Expression<Func<Order, object>>> SortableFields = new()
{
    ["createdAt"] = o => o.CreatedAt,
    ["totalAmount"] = o => o.TotalAmount,
    ["status"] = o => o.Status
};

[HttpGet("orders")]
public async Task<IActionResult> GetOrders(string sortBy = "createdAt")
{
    if (!SortableFields.TryGetValue(sortBy, out var sortExpr))
        return BadRequest($"'{sortBy}' is not a sortable field.");

    var orders = await _db.Orders.OrderBy(sortExpr).Take(25).ToListAsync();
    return Ok(orders);
}
```

---

## Check F — No max page-size cap (PAG-006)

### Detection

Check whether `pageSize`/`take`/`limit` is clamped server-side to a sane maximum. Without a
cap, a client sending `pageSize=999999` gets the entire table in one call, defeating every
protection paging was meant to provide and reintroducing the same large-materialization risk
as Check A (see also `dotnet-performance` for the in-memory cost of doing this repeatedly).

### BAD — client-supplied page size accepted with no upper bound

```csharp
[HttpGet("orders")]
public async Task<IActionResult> GetOrders(int page = 1, int pageSize = 25)
{
    return Ok(await _db.Orders.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync());
    // pageSize=999999 returns the whole table in one response.
}
```

### GOOD — page size clamped to a documented maximum (see Check B's `PagedRequest` for a reusable pattern)

```csharp
[HttpGet("orders")]
public async Task<IActionResult> GetOrders(int page = 1, int pageSize = 25)
{
    pageSize = Math.Clamp(pageSize, 1, 100); // server enforces the cap regardless of what the client asks for
    return Ok(await _db.Orders.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync());
}
```
