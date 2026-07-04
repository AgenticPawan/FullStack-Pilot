---
name: dotnet-background-jobs
description: Reviews ASP.NET Core background/scheduled job design. Flags hand-rolled BackgroundService loops used instead of Hangfire, job schedules (name, cron, enabled) hardcoded in code instead of sourced from a configurable store, an unauthenticated Background Jobs admin controller that lets callers register or trigger arbitrary jobs, non-idempotent job handlers despite Hangfire's at-least-once execution guarantee, and an unprotected Hangfire dashboard. Outputs findings with pilot-dotnet background-jobs standard IDs.
when_to_use: Hangfire, background job, recurring job, IRecurringJobManager, BackgroundService, cron schedule, job scheduling, BackgroundJobsController, Hangfire dashboard, idempotent job, fire-and-forget job, IDashboardAuthorizationFilter, scheduled task
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| BGJ-001 | P0 | Custom `BackgroundService` + delay loop used instead of Hangfire for recurring/scheduled work |
| BGJ-002 | P1 | Job schedule (name/cron/enabled) hardcoded instead of sourced from a configurable store |
| BGJ-003 | P0 | Background-jobs admin endpoint with no `[Authorize]`/permission-policy guard |
| BGJ-004 | P1 | Job handler is not idempotent despite Hangfire's at-least-once execution guarantee |
| BGJ-005 | P2 | Hangfire dashboard mounted with no `IDashboardAuthorizationFilter` |

---

## Check A — Hand-rolled loop instead of Hangfire (BGJ-001)

### Detection

1. Grep for custom `BackgroundService`/`IHostedService` implementations that `while (!stoppingToken.IsCancellationRequested) { ...; await Task.Delay(...); }` to run periodic work.
2. This loses everything Hangfire provides for free: persistence across restarts, automatic retry with backoff, a dashboard, and distributed execution across multiple instances (without it, a scaled-out deployment runs the same job N times).

### BAD — custom polling loop

```csharp
public class InvoiceReminderService : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await SendReminders();
            await Task.Delay(TimeSpan.FromHours(24), stoppingToken);
            // No persistence, no retry, runs once per replica when scaled out.
        }
    }
}
```

### GOOD — Hangfire recurring job

```csharp
builder.Services.AddHangfire(config => config
    .UsePostgreSqlStorage(builder.Configuration.GetConnectionString("Hangfire"))); // or SQL Server storage
builder.Services.AddHangfireServer();

// Registered once at startup (or via the configurable job store — see Check B)
RecurringJob.AddOrUpdate<IInvoiceReminderJob>(
    "invoice-reminders",
    job => job.RunAsync(),
    Cron.Daily);
```

---

## Check B — Job schedule hardcoded instead of configurable (BGJ-002)

### Detection

1. Check whether cron expressions and job enablement live as C# literals/attributes in startup code, or are sourced from a configurable store (DB table or JSON config) that ops can edit without a redeploy.
2. Flag `RecurringJob.AddOrUpdate("job-name", ..., "0 3 * * *")` calls scattered through code with no single source of truth for `name`/`cron`/`enabled`.

### BAD — cron hardcoded per call site, no way to disable without a deploy

```csharp
RecurringJob.AddOrUpdate<IInvoiceReminderJob>("invoice-reminders", j => j.RunAsync(), "0 3 * * *");
RecurringJob.AddOrUpdate<ICleanupJob>("nightly-cleanup", j => j.RunAsync(), "0 2 * * *");
```

### GOOD — jobs defined in a configurable JSON/DB-backed schedule

```json
// jobs.config.json (or a JobSchedules DB table with the same shape)
[
  { "name": "invoice-reminders", "cron": "0 3 * * *", "enabled": true },
  { "name": "nightly-cleanup",   "cron": "0 2 * * *", "enabled": false }
]
```

```csharp
public interface IJobDefinition
{
    string Name { get; }
    void Register(); // maps Name -> the strongly-typed job invocation
}

public class BackgroundJobScheduler
{
    private readonly IEnumerable<IJobDefinition> _definitions;
    private readonly IJobScheduleStore _store; // reads jobs.config.json or the DB table

    public async Task SyncAsync()
    {
        foreach (var schedule in await _store.GetAllAsync())
        {
            var definition = _definitions.SingleOrDefault(d => d.Name == schedule.Name);
            if (definition is null) continue;

            if (schedule.Enabled)
                RecurringJob.AddOrUpdate(schedule.Name, () => definition.Invoke(), schedule.Cron);
            else
                RecurringJob.RemoveIfExists(schedule.Name);
        }
    }
}
```

---

## Check C — Unauthenticated background-jobs admin endpoint (BGJ-003)

### Detection

1. Find any controller that lets a caller register, trigger, or delete a Hangfire job (`BackgroundJobsController`, `/api/jobs/{name}/trigger`).
2. Flag any such endpoint with no `[Authorize]`, or `[Authorize]` with no fine-grained permission policy (see `dotnet-authorization` AZ-001/AZ-002) — this endpoint can run arbitrary scheduled work on demand and must be treated as a high-privilege admin surface.

### BAD — anyone can trigger or reschedule a job

```csharp
[ApiController]
[Route("api/jobs")]
public class BackgroundJobsController : ControllerBase
{
    [HttpPost("{name}/trigger")]
    public IActionResult Trigger(string name)
    {
        BackgroundJob.Enqueue(name); // no [Authorize] at all
        return Ok();
    }
}
```

### GOOD — permission-gated admin endpoint

```csharp
[ApiController]
[Route("api/jobs")]
[Authorize(Policy = "Jobs.Manage")]
public class BackgroundJobsController : ControllerBase
{
    [HttpPost("{name}/trigger")]
    public async Task<IActionResult> Trigger(string name, CancellationToken ct)
    {
        if (!await _jobCatalog.ExistsAsync(name)) return NotFound();
        BackgroundJob.Enqueue(name);
        return Accepted();
    }
}
```

---

## Check D — Job handler not idempotent (BGJ-004)

### Detection

Hangfire guarantees *at-least-once* execution — a job can run twice after a crash/retry. Check whether a job handler is safe to run twice (upsert/dedupe-key check) or whether it performs a non-idempotent side effect (send-email, charge-payment, increment-counter) with no guard.

### BAD — sending a reminder twice on retry double-charges/double-emails

```csharp
public async Task RunAsync()
{
    var overdue = await _db.Invoices.Where(i => i.IsOverdue).ToListAsync();
    foreach (var invoice in overdue)
        await _emailSender.SendReminderAsync(invoice); // retried job = duplicate emails
}
```

### GOOD — idempotency guard via a processed-marker

```csharp
public async Task RunAsync()
{
    var overdue = await _db.Invoices.Where(i => i.IsOverdue && i.ReminderSentAt == null).ToListAsync();
    foreach (var invoice in overdue)
    {
        await _emailSender.SendReminderAsync(invoice);
        invoice.ReminderSentAt = DateTime.UtcNow; // next retry/run skips it
    }
    await _db.SaveChangesAsync();
}
```

---

## Check E — Hangfire dashboard unprotected (BGJ-005)

### Detection

Check `app.UseHangfireDashboard(...)` for an `Authorization` filter. The default (no filter, or the sample `LocalRequestsOnlyAuthorizationFilter`) allows anyone reaching the route to view/manage all jobs in non-local environments.

### BAD — dashboard mounted with no auth filter in a deployed environment

```csharp
app.UseHangfireDashboard("/hangfire"); // default filter only allows localhost — often forgotten when tunneled/proxied
```

### GOOD — dashboard gated by an authorization filter tied to real auth

```csharp
app.UseHangfireDashboard("/hangfire", new DashboardOptions
{
    Authorization = new[] { new HangfireAdminAuthorizationFilter() }
});

public class HangfireAdminAuthorizationFilter : IDashboardAuthorizationFilter
{
    public bool Authorize(DashboardContext context)
    {
        var httpContext = context.GetHttpContext();
        return httpContext.User.Identity?.IsAuthenticated == true
            && httpContext.User.IsInRole("Admin");
    }
}
```
