---
name: dotnet-validation
description: Reviews ASP.NET Core request validation strategy. Flags inconsistent validation approaches across endpoints (mixing data annotations and ad-hoc checks with no house convention), validation logic duplicated between the endpoint and its Application-layer handler instead of one pipeline behavior, validation failures not shaped as ProblemDetails, and cross-field/business validation run inline in a controller instead of an independently testable validator. Outputs findings with pilot-dotnet validation standard IDs.
when_to_use: FluentValidation, IValidator, data annotations, model validation, ValidationProblemDetails, pipeline behavior, MediatR validation, endpoint filter validation, cross-field validation, business rule validation, request validation strategy
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| VAL-001 | P1 | No consistent validation strategy across endpoints |
| VAL-002 | P1 | Validation logic duplicated between endpoint and Application-layer handler |
| VAL-003 | P2 | Validation failures not shaped as `ProblemDetails` |
| VAL-004 | P2 | Cross-field/business validation run inline in a controller |

---

## Check A — Inconsistent validation strategy (VAL-001)

### Detection

Grep across controllers/handlers for a mix of `[Required]`/data-annotation attributes on
some DTOs and hand-rolled `if (string.IsNullOrEmpty(...))` checks on others, with no single
house convention. FluentValidation is recommended once rules go beyond simple
presence/length checks (conditional rules, cross-field rules, async DB-backed rules).

### BAD — two different validation approaches in the same codebase

```csharp
public class CreateOrderDto
{
    [Required, MaxLength(100)]
    public string CustomerName { get; set; } = "";
}

// ...meanwhile, in another controller:
[HttpPost]
public IActionResult Create(CreateInvoiceDto dto)
{
    if (string.IsNullOrWhiteSpace(dto.CustomerName)) return BadRequest("Name required"); // different pattern, different error shape
}
```

### GOOD — one validation approach (FluentValidation), applied consistently

```csharp
public class CreateOrderDtoValidator : AbstractValidator<CreateOrderDto>
{
    public CreateOrderDtoValidator()
    {
        RuleFor(x => x.CustomerName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Total).GreaterThan(0);
    }
}

builder.Services.AddValidatorsFromAssemblyContaining<CreateOrderDtoValidator>();
```

---

## Check B — Validation duplicated between endpoint and handler (VAL-002)

### Detection

Grep for the same rule (e.g., "email must be valid format") implemented once in a minimal
API endpoint filter/controller action filter and again inside the Application-layer
handler it delegates to. Duplication means the two can silently drift, and a caller that
bypasses the endpoint (e.g., another handler invoking the same command internally) skips
the endpoint-level check entirely.

### BAD — same rule checked twice, in two different places

```csharp
// Controller
if (!dto.Email.Contains('@')) return BadRequest("Invalid email");
await _mediator.Send(new CreateCustomerCommand(dto));

// CreateCustomerCommandHandler
public async Task Handle(CreateCustomerCommand cmd, CancellationToken ct)
{
    if (!cmd.Email.Contains('@')) throw new ValidationException("Invalid email"); // duplicated rule
}
```

### GOOD — one validator wired into a shared pipeline behavior

```csharp
public class ValidationBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : IRequest<TResponse>
{
    private readonly IEnumerable<IValidator<TRequest>> _validators;

    public async Task<TResponse> Handle(
        TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken ct)
    {
        var failures = _validators
            .Select(v => v.Validate(request))
            .SelectMany(r => r.Errors)
            .Where(f => f is not null)
            .ToList();

        if (failures.Count != 0) throw new ValidationException(failures);
        return await next();
    }
}

// Program.cs — every command/query goes through the same validation stage exactly once
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));
```

---

## Check C — Validation failures not shaped as ProblemDetails (VAL-003)

### Detection

Check what a validation failure actually returns to the client — it should produce the
same `ValidationProblemDetails` shape (with an `errors` dictionary keyed by field name)
that `dotnet-error-handling` ERR-002 establishes for every other error response, not a
one-off 400 body unique to validation.

### BAD — validation failure returns a different shape than other errors

```csharp
catch (ValidationException ex)
{
    return BadRequest(new { message = "Validation failed", details = ex.Errors }); // own shape
}
```

### GOOD — validation failures use ValidationProblemDetails, same family as ERR-002

```csharp
catch (ValidationException ex)
{
    var problem = new ValidationProblemDetails(
        ex.Errors.ToDictionary(e => e.PropertyName, e => new[] { e.ErrorMessage }))
    {
        Status = StatusCodes.Status400BadRequest,
        Title = "One or more validation errors occurred."
    };
    return new BadRequestObjectResult(problem);
}
```

---

## Check D — Cross-field/business validation run inline in a controller (VAL-004)

### Detection

Grep controllers for validation that requires a database lookup (uniqueness checks,
referential checks against another aggregate) implemented inline instead of inside a
validator/handler that can be unit-tested without spinning up the whole HTTP pipeline.

### BAD — DB-backed uniqueness check inline in the controller

```csharp
[HttpPost]
public async Task<IActionResult> Create(CreateCustomerDto dto)
{
    if (await _db.Customers.AnyAsync(c => c.Email == dto.Email))
        return BadRequest("Email already in use"); // untestable without a live DbContext + HTTP pipeline
    ...
}
```

### GOOD — async validator rule, independently testable

```csharp
public class CreateCustomerDtoValidator : AbstractValidator<CreateCustomerDto>
{
    public CreateCustomerDtoValidator(AppDbContext db)
    {
        RuleFor(x => x.Email)
            .NotEmpty()
            .MustAsync(async (email, ct) => !await db.Customers.AnyAsync(c => c.Email == email, ct))
            .WithMessage("Email already in use");
    }
}
```
