---
name: dotnet-graphql
description: Reviews HotChocolate GraphQL API design for shops using GraphQL instead of (or alongside) REST. Flags resolver-level N+1 query patterns with no DataLoader batching, no query-depth or complexity limit letting a single query become a DoS vector, field-level authorization done with role checks instead of the permissions-only model, and no persisted-query/allow-list policy for a public-facing endpoint. Outputs findings with pilot-dotnet graphql standard IDs.
when_to_use: GraphQL, HotChocolate, DataLoader, N+1 resolver, query complexity limit, query depth limit, persisted query, field authorization GraphQL, GraphQL DoS
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| GQL-001 | P0 | Resolver-level N+1 query pattern with no `DataLoader` batching |
| GQL-002 | P0 | No query-depth or complexity limit — a single query can be a DoS vector |
| GQL-003 | P0 | Field-level authorization uses role checks instead of the permissions-only model |
| GQL-004 | P2 | No persisted-query/allow-list policy for a public-facing endpoint |

This skill only applies when `stack-detection` identifies HotChocolate/GraphQL in the
dependency graph. REST APIs remain fully governed by `dotnet-api-versioning`,
`dotnet-validation`, `dotnet-error-handling`, etc. — this skill covers GraphQL-specific
concerns those don't translate to directly.

---

## Check A — Resolver N+1 with no DataLoader (GQL-001)

### Detection

Grep resolvers for a child-field resolver that queries the database per-parent-object
instead of batching via `DataLoader` — GraphQL's field-resolution model makes N+1 the
default failure mode: resolving `order.customer` for 100 orders in a list naively issues
100 separate customer lookups unless batched, the exact same underlying problem
`sql-performance-review` flags for EF Core loops, just triggered by GraphQL's execution
model instead of an explicit loop.

### BAD — per-order customer lookup, no batching

```csharp
public class OrderType : ObjectType<Order>
{
    protected override void Configure(IObjectTypeDescriptor<Order> descriptor)
    {
        descriptor.Field("customer")
            .Resolve(async ctx =>
            {
                var order = ctx.Parent<Order>();
                return await ctx.Service<AppDbContext>().Customers.FindAsync(order.CustomerId);
                // Resolved once per order in the result set — 100 orders = 100 queries.
            });
    }
}
```

### GOOD — batched via DataLoader

```csharp
public class CustomerByIdDataLoader : BatchDataLoader<Guid, Customer>
{
    private readonly AppDbContext _db;

    protected override async Task<IReadOnlyDictionary<Guid, Customer>> LoadBatchAsync(
        IReadOnlyList<Guid> keys, CancellationToken ct)
    {
        return await _db.Customers
            .Where(c => keys.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, ct); // one query for the whole batch, regardless of result-set size
    }
}

public class OrderType : ObjectType<Order>
{
    protected override void Configure(IObjectTypeDescriptor<Order> descriptor)
    {
        descriptor.Field("customer")
            .Resolve(async ctx => await ctx.DataLoader<CustomerByIdDataLoader>()
                .LoadAsync(ctx.Parent<Order>().CustomerId, ctx.RequestAborted));
    }
}
```

---

## Check B — No query-depth/complexity limit (GQL-002)

### Detection

Check `AddGraphQLServer()` configuration for `.AddMaxExecutionDepthRule()` and/or a
complexity-analysis rule. GraphQL's client-driven query shape means a single request can
recursively nest fields (`order { customer { orders { customer { orders { ... } } } } }`)
to a depth that's computationally explosive server-side — an unbounded query shape is a
DoS vector unique to GraphQL that REST's fixed endpoint shapes don't have.

### BAD — no depth or complexity limit configured

```csharp
builder.Services.AddGraphQLServer().AddQueryType<Query>();
// A client can send an arbitrarily deep/nested query with no server-side bound.
```

### GOOD — depth and complexity limits configured

```csharp
builder.Services.AddGraphQLServer()
    .AddQueryType<Query>()
    .AddMaxExecutionDepthRule(15)
    .SetRequestOptions(new RequestExecutorOptions { ComplexityMaxAllowedComplexity = 1000 });
```

---

## Check C — Field authorization uses role checks (GQL-003)

### Detection

Grep `[Authorize(Roles = "...")]` on GraphQL field resolvers — the same permissions-only
rule `dotnet-authorization` AZ-001 enforces everywhere else in this codebase applies
identically here, with no exception for GraphQL's different syntax.

### BAD — role-based field authorization

```csharp
public class Mutation
{
    [Authorize(Roles = "Manager")] // same AZ-001 violation, just on a GraphQL field
    public async Task<Order> ApproveOrder(Guid orderId) => ...;
}
```

### GOOD — permission-based field authorization

```csharp
public class Mutation
{
    [Authorize(Policy = Permissions.Orders.Approve)]
    public async Task<Order> ApproveOrder(Guid orderId) => ...;
}
```

---

## Check D — No persisted-query/allow-list policy (GQL-004, advisory)

### Detection

For a public-facing GraphQL endpoint, check whether arbitrary ad-hoc queries are accepted
from any client versus a persisted-query allow-list (the server only executes queries
matching a pre-registered hash) — an allow-list closes the door on the exact DoS/data-
exposure surface Check B's depth limit only bounds rather than eliminates, at the cost of
losing GraphQL's client-driven query flexibility for that endpoint.

### BAD — any arbitrary query string accepted from any client

```csharp
builder.Services.AddGraphQLServer().AddQueryType<Query>();
// Any client can submit any query shape the depth/complexity rules allow — no allow-list.
```

### GOOD — persisted queries only for the public endpoint

```csharp
builder.Services.AddGraphQLServer()
    .AddQueryType<Query>()
    .UsePersistedQueryPipeline() // only pre-registered, hashed queries are accepted
    .AddReadOnlyFileSystemQueryStorage("./persisted-queries");
```
