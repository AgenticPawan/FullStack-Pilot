---
name: dotnet-testing
description: Reviews ASP.NET Core test suite architecture. Flags hand-rolled WebApplicationFactory setup duplicated per test class instead of a shared fixture/collection, integration tests run against a mocked DbContext or EF Core's in-memory provider instead of a real SQL Server instance via Testcontainers, ad-hoc test data literals scattered per test instead of shared builders, and an undocumented policy for what gets faked versus what must be real in test doubles. Outputs findings with pilot-dotnet testing standard IDs.
when_to_use: WebApplicationFactory, integration test, Testcontainers, EF Core in-memory provider, test data builder, object mother, test fixture, xUnit collection fixture, mocking policy, test double, IClassFixture
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| TST-001 | P1 | Hand-rolled `WebApplicationFactory` setup duplicated per test class |
| TST-002 | P1 | Integration tests use a mocked/in-memory `DbContext` instead of a real SQL Server instance |
| TST-003 | P2 | Test data built via ad-hoc literals scattered per test instead of a shared builder |
| TST-004 | P2 | No documented policy for what's faked vs. what must be real in test doubles |

---

## Check A — WebApplicationFactory duplicated per test class (TST-001)

### Detection

Grep integration test classes for repeated `ConfigureWebHost`/`ConfigureServices`
overrides with the same setup (test auth handler, connection string override) copy-pasted
across multiple `IClassFixture<WebApplicationFactory<Program>>` usages instead of one
shared factory reused via an xUnit collection fixture.

### BAD — every test class re-implements the same factory setup

```csharp
public class OrdersControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    public OrdersControllerTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.WithWebHostBuilder(b =>
            b.ConfigureServices(s => { /* same test-auth override as every other test class */ }))
            .CreateClient();
    }
}
// InvoicesControllerTests repeats the exact same ConfigureServices block.
```

### GOOD — one shared factory, reused via a collection fixture

```csharp
public class ApiTestFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            services.AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
        });
    }
}

[CollectionDefinition("Api")]
public class ApiTestCollection : ICollectionFixture<ApiTestFactory> { }

[Collection("Api")]
public class OrdersControllerTests
{
    public OrdersControllerTests(ApiTestFactory factory) => _client = factory.CreateClient();
}
```

---

## Check B — Mocked DbContext / in-memory provider instead of real SQL Server (TST-002)

### Detection

Grep integration test setup for `UseInMemoryDatabase(...)` or a hand-mocked `DbContext`.
EF Core's in-memory provider silently accepts things real SQL Server rejects (no unique
constraint enforcement, no real transaction semantics, different `NULL` handling), so
tests pass against it and fail in production — the exact gap `dotnet-di-modules` DIM-004
warns about when test setup diverges from the real composition root.

### BAD — in-memory provider used for integration tests

```csharp
services.AddDbContext<AppDbContext>(opts => opts.UseInMemoryDatabase("TestDb"));
// A unique-index violation that would 500 in production silently succeeds here.
```

### GOOD — real SQL Server via Testcontainers

```csharp
public class ApiTestFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly MsSqlContainer _sqlContainer = new MsSqlBuilder().Build();

    public async Task InitializeAsync() => await _sqlContainer.StartAsync();
    public new async Task DisposeAsync() => await _sqlContainer.DisposeAsync();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.AddDbContext<AppDbContext>(opts =>
                opts.UseSqlServer(_sqlContainer.GetConnectionString()));
        });
    }
}
```

---

## Check C — Ad-hoc test data instead of shared builders (TST-003)

### Detection

Grep test files for repeated inline entity construction with the same default field values
copy-pasted across many tests, instead of a shared test-data builder/object-mother that
centralizes sensible defaults and lets each test override only the field it cares about.

### BAD — full object literal repeated in every test

```csharp
var order = new Order
{
    Id = Guid.NewGuid(), CustomerId = Guid.NewGuid(), Status = OrderStatus.Pending,
    Total = 100m, CreatedAt = DateTime.UtcNow, CreatedBy = Guid.NewGuid()
}; // repeated with minor tweaks in 40 other tests
```

### GOOD — a builder with sensible defaults, overridden per test

```csharp
public class OrderBuilder
{
    private Order _order = new()
    {
        Id = Guid.NewGuid(), CustomerId = Guid.NewGuid(),
        Status = OrderStatus.Pending, Total = 100m,
        CreatedAt = DateTime.UtcNow, CreatedBy = Guid.NewGuid()
    };

    public OrderBuilder WithStatus(OrderStatus status) { _order.Status = status; return this; }
    public OrderBuilder WithTotal(decimal total) { _order.Total = total; return this; }
    public Order Build() => _order;
}

var order = new OrderBuilder().WithStatus(OrderStatus.Approved).Build();
```

---

## Check D — No documented test-double policy (TST-004)

### Detection

Confirm the test suite (or a `docs/TESTING.md`-equivalent) states which dependencies are
faked and which must be real: outbound HTTP calls to third parties (see
`dotnet-resilience`) should be faked/stubbed at the `DelegatingHandler` level, the database
should be real (Testcontainers, per Check B), and internal module boundaries
(`dotnet-di-modules`) should be exercised through the real DI container, not manually
`new`'d up. Flag test suites with no consistent line drawn — some tests fake the DB while
others hit real third-party APIs, or vice versa.

### BAD — no consistent policy; a test hits a real third-party API

```csharp
[Fact]
public async Task ApproveOrder_SendsRealEmail() // hits the real SendGrid API in CI
{
    var result = await _orderService.ApproveAsync(orderId);
}
```

### GOOD — outbound third-party calls faked at the handler level, DB stays real

```csharp
services.AddHttpClient<PaymentGatewayClient>()
    .ConfigurePrimaryHttpMessageHandler(() => new FakePaymentGatewayHandler());
// AppDbContext still points at the Testcontainers SQL instance from Check B.
```
