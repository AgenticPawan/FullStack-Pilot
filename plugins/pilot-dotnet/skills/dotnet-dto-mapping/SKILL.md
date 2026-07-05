---
name: dotnet-dto-mapping
description: Reviews the boundary between EF Core entities and API contracts. Flags EF entities returned/bound directly through controllers or GraphQL instead of dedicated DTOs, hand-rolled field-by-field mapping duplicated across handlers instead of one AutoMapper/Mapster profile, mapping profiles with no unit test asserting every DTO member is covered, and DTOs that eagerly include navigation-property graphs the caller never asked for. Outputs findings with pilot-dotnet dto-mapping standard IDs.
when_to_use: AutoMapper, Mapster, mapping profile, DTO vs entity, entity leaking through API, IMapper, ProjectTo, Adapt, over-fetching, navigation property serialization, CreateMap, entity to DTO, response contract
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| DTM-001 | P0 | EF entity returned/bound directly through a controller or GraphQL type instead of a DTO |
| DTM-002 | P1 | Field-by-field mapping duplicated by hand across handlers instead of one mapping profile |
| DTM-003 | P2 | Mapping profile has no test asserting every DTO member is mapped |
| DTM-004 | P1 | DTO/projection eagerly loads navigation properties the caller never requested |

---

## Check A — Entity leaked through the API boundary (DTM-001)

### Detection

Grep controller actions/GraphQL resolvers for a return type or bound parameter that is the
EF entity itself (`public ActionResult<Order> Get(...)`, `public Order CreateOrder(...)`)
rather than a dedicated request/response DTO. Serializing an entity directly exposes every
column the schema ever grows (including ones added later for internal use), leaks EF Core
proxy/lazy-loading behavior into JSON serialization, and couples the wire contract to the
database schema — a schema migration becomes a breaking API change.

### BAD — entity serialized directly to the client

```csharp
[HttpGet("{id}")]
public async Task<ActionResult<Order>> Get(Guid id)
{
    var order = await _db.Orders
        .Include(o => o.Customer)
        .Include(o => o.LineItems)
        .FirstOrDefaultAsync(o => o.Id == id);
    return order is null ? NotFound() : Ok(order); // client now sees every EF navigation property
}

[HttpPost]
public async Task<ActionResult> Create(Order order) // client can set OrderId, CreatedBy, RowVersion...
{
    _db.Orders.Add(order);
    await _db.SaveChangesAsync();
    return Ok(order.Id);
}
```

### GOOD — dedicated DTOs on both sides of the boundary

```csharp
public record OrderResponse(Guid Id, string CustomerName, decimal Total, IReadOnlyList<LineItemResponse> LineItems);
public record CreateOrderRequest(Guid CustomerId, IReadOnlyList<CreateLineItemRequest> LineItems);

[HttpGet("{id}")]
public async Task<ActionResult<OrderResponse>> Get(Guid id)
{
    var order = await _mapper.ProjectTo<OrderResponse>(
        _db.Orders.Where(o => o.Id == id)).FirstOrDefaultAsync();
    return order is null ? NotFound() : Ok(order);
}

[HttpPost]
public async Task<ActionResult<Guid>> Create(CreateOrderRequest request)
{
    var order = _mapper.Map<Order>(request); // only fields the client is allowed to set
    _db.Orders.Add(order);
    await _db.SaveChangesAsync();
    return Ok(order.Id);
}
```

---

## Check B — Hand-rolled mapping duplicated across handlers (DTM-002)

### Detection

Grep for repeated `new OrderResponse { Id = order.Id, CustomerName = order.Customer.Name, ... }`
construction appearing in more than one handler/controller for the same entity/DTO pair.
Duplicated mapping code drifts silently — one call site gets a new field added, the other
doesn't, and nothing fails until a client notices data missing.

### BAD — the same entity-to-DTO mapping written out twice

```csharp
// OrdersController.Get
var response = new OrderResponse { Id = order.Id, CustomerName = order.Customer.Name, Total = order.Total };

// OrderSearchHandler.Handle — same fields, mapped again by hand, easy to drift
var results = orders.Select(o => new OrderResponse { Id = o.Id, CustomerName = o.Customer.Name, Total = o.Total });
```

### GOOD — one mapping profile, reused everywhere

```csharp
public class OrderMappingProfile : Profile
{
    public OrderMappingProfile()
    {
        CreateMap<Order, OrderResponse>()
            .ForMember(d => d.CustomerName, o => o.MapFrom(s => s.Customer.Name));
        CreateMap<CreateOrderRequest, Order>();
    }
}

// every call site
var response = _mapper.Map<OrderResponse>(order);
var results = await _mapper.ProjectTo<OrderResponse>(query).ToListAsync(ct);
```

---

## Check C — No test asserting full DTO coverage (DTM-003)

### Detection

Check the test project for a mapping-configuration test (`AssertConfigurationIsValid()` for
AutoMapper, or an equivalent Mapster config check). Without it, a DTO member left unmapped
silently serializes as its default value (`null`/`0`) in production instead of failing CI.

### BAD — mapping profile registered but never validated

```csharp
builder.Services.AddAutoMapper(typeof(OrderMappingProfile));
// no test ever calls AssertConfigurationIsValid() — an unmapped DTO member fails silently at runtime
```

### GOOD — CI fails if any profile has an unmapped member

```csharp
[Fact]
public void MappingProfiles_AreValid()
{
    var config = new MapperConfiguration(cfg => cfg.AddProfile<OrderMappingProfile>());
    config.AssertConfigurationIsValid(); // fails the build if any destination member is unmapped
}
```

---

## Check D — DTO/projection over-fetches navigation graphs (DTM-004)

### Detection

Grep DTO-producing queries for `.Include(...)` chains that pull in navigation properties
the DTO doesn't actually expose, or a `Map<TDto>(entity)` call on an entity that was loaded
with unrelated `Include`s "just in case." Prefer `ProjectTo<TDto>` (which translates to a
SQL projection selecting only mapped columns) over materializing the full entity graph and
mapping in memory.

### BAD — full entity graph loaded, only a few fields ever used

```csharp
var order = await _db.Orders
    .Include(o => o.Customer).ThenInclude(c => c.Addresses)
    .Include(o => o.LineItems).ThenInclude(li => li.Product).ThenInclude(p => p.Supplier)
    .FirstOrDefaultAsync(o => o.Id == id);

return _mapper.Map<OrderSummaryResponse>(order); // OrderSummaryResponse only has Id, CustomerName, Total
```

### GOOD — projection selects only the columns the DTO needs

```csharp
var summary = await _mapper.ProjectTo<OrderSummaryResponse>(
    _db.Orders.Where(o => o.Id == id)).FirstOrDefaultAsync();
// SQL SELECT only includes Id, Customer.Name, Total — no LineItems/Supplier join at all
```

---

## DTO/mapping checklist

- [ ] No controller/GraphQL resolver returns or binds an EF entity directly
- [ ] Every entity-DTO pair maps through one AutoMapper/Mapster profile, not hand-rolled per handler
- [ ] CI runs `AssertConfigurationIsValid()` (or equivalent) so an unmapped member fails the build
- [ ] Read-side DTOs use `ProjectTo<TDto>`/`Adapt` projections, not full entity load + in-memory map
- [ ] Write-side DTOs (`CreateXRequest`/`UpdateXRequest`) never expose server-owned fields (Id, CreatedBy, RowVersion) for the client to set
