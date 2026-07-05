---
name: dotnet-reporting-etl
description: Reviews scheduled report generation and batch/ETL pipelines in ASP.NET Core apps — distinct from dotnet-document-io's ad-hoc on-request Excel/PDF export. Flags long-running batch jobs run inline in a web request instead of via a background job runner, full-table in-memory reads instead of streamed/chunked reads, ETL jobs with no idempotency/checkpoint strategy that duplicate work on retry, hardcoded recipients/cron schedules instead of configurable settings, no alerting for silently failing scheduled jobs, and report queries hitting the OLTP database with no read-replica separation. Outputs findings with pilot-dotnet reporting-etl standard IDs.
when_to_use: scheduled report, ETL pipeline, batch job, Hangfire, background job, report generation, data warehouse load, nightly job, cron job, IAsyncEnumerable streaming, chunked read, checkpoint, idempotent ETL, resumable job, reporting database, read replica, OLTP contention, report recipient list, job monitoring, silent job failure, dead job alerting
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| ETL-001 | P0 | Long-running batch/report job executed inline in an HTTP request instead of via a background job runner (Hangfire) |
| ETL-002 | P1 | Large ETL read materializes an entire source table into memory instead of streaming/batching |
| ETL-003 | P0 | Multi-hour ETL job has no idempotency/checkpoint strategy — a mid-run failure reprocesses already-completed rows |
| ETL-004 | P2 | Scheduled report recipient list or cron schedule hardcoded in code instead of a configurable store |
| ETL-005 | P1 | No monitoring/alerting when a scheduled ETL/report job silently fails or stops running |
| ETL-006 | P1 | Report queries run directly against the OLTP production database with no read-replica/reporting-database separation |

---

## Check A — Batch/report jobs executed inline in a web request (ETL-001)

### Detection

Find controller actions/minimal-API handlers performing multi-second-to-multi-minute work
synchronously within the request lifecycle (large exports, month-end reports, cross-table
aggregation). Flag ETL-001 when there is no enqueue to a background job runner (Hangfire —
see `dotnet-background-jobs`) — the job is bound by the request/response timeout and gets
cut off with no completion guarantee or status check. Distinct from `dotnet-document-io`,
which covers a single on-request document, not unbounded scheduled/batch work.

### BAD — month-end report built synchronously inside the request

```csharp
[HttpPost("reports/month-end")]
public async Task<IActionResult> GenerateMonthEndReport(int year, int month)
{
    var orders = await _db.Orders
        .Where(o => o.CreatedAt.Year == year && o.CreatedAt.Month == month)
        .ToListAsync(); // could be millions of rows

    foreach (var order in orders)
        await _reportBuilder.AppendOrderAsync(order); // aggregation, formatting, per-row I/O

    var reportBytes = await _reportBuilder.FinalizeAsync();
    await _emailService.SendAsync("finance@acme.com", "Month-end report", reportBytes);
    return Ok(); // request may already have timed out client-side by the time this returns
}
```

### GOOD — enqueue to Hangfire, return immediately with a job reference

```csharp
[HttpPost("reports/month-end")]
public IActionResult QueueMonthEndReport(int year, int month)
{
    var jobId = _backgroundJobClient.Enqueue<MonthEndReportJob>(
        job => job.RunAsync(year, month, CancellationToken.None));

    return Accepted(new { jobId, statusUrl = $"/reports/jobs/{jobId}" });
}

public class MonthEndReportJob(AppDbContext db, IReportBuilder reportBuilder, IEmailService emailService)
{
    [AutomaticRetry(Attempts = 3)]
    public async Task RunAsync(int year, int month, CancellationToken ct)
    {
        await foreach (var order in db.Orders
            .Where(o => o.CreatedAt.Year == year && o.CreatedAt.Month == month)
            .AsNoTracking().AsAsyncEnumerable().WithCancellation(ct))
            await reportBuilder.AppendOrderAsync(order);

        var reportBytes = await reportBuilder.FinalizeAsync();
        await emailService.SendAsync("finance@acme.com", "Month-end report", reportBytes);
    }
}
```

---

## Check B — Full-table in-memory reads instead of streaming/batching (ETL-002)

### Detection

Grep ETL/report code for `.ToListAsync()`/`.ToList()`/`.AsEnumerable()` applied to a query
with no pagination against a source table of unbounded/unknown row count. Flag ETL-002 when
the materialized collection is then iterated once — the buffering serves no purpose except
holding rows the code never needs all at once (ties into `dotnet-performance`'s guidance on
avoiding large materializations). Recommend `IAsyncEnumerable<T>` or chunked `Take` batches
(e.g., 5,000 rows) that bound peak memory regardless of source table growth.

### BAD — entire source table loaded into memory before processing

```csharp
public async Task LoadCustomerWarehouseAsync()
{
    var allCustomers = await _sourceDb.Customers.AsNoTracking().ToListAsync(); // unbounded
    foreach (var customer in allCustomers)
        await _warehouseDb.DimCustomers.AddAsync(MapToDimension(customer));
    await _warehouseDb.SaveChangesAsync();
}
```

### GOOD — chunked/streamed read bounding peak memory

```csharp
public async Task LoadCustomerWarehouseAsync(CancellationToken ct)
{
    const int batchSize = 5_000;
    var batch = new List<DimCustomer>(batchSize);

    await foreach (var customer in _sourceDb.Customers.AsNoTracking().AsAsyncEnumerable().WithCancellation(ct))
    {
        batch.Add(MapToDimension(customer));
        if (batch.Count >= batchSize)
        {
            await _warehouseDb.BulkInsertAsync(batch, ct);
            batch.Clear();
        }
    }

    if (batch.Count > 0) await _warehouseDb.BulkInsertAsync(batch, ct);
}
```

---

## Check C — No idempotency/checkpoint strategy for multi-hour ETL jobs (ETL-003)

### Detection

Find long-running ETL jobs processing rows in a single pass with no persisted "last
successfully processed" marker (checkpoint row/watermark/cursor table). Flag ETL-003 when a
retry after a mid-run failure has no way to resume and reprocesses the entire dataset —
wasting hours of compute, or duplicating downstream rows if the sink isn't upsert-safe.
Recommend a checkpoint table storing the last processed watermark, updated transactionally
with each committed batch, plus upsert-style sink writes — the ETL-specific application of
`dotnet-idempotency`'s principles.

### BAD — no checkpoint; a crash mid-run means starting over from row 1

```csharp
public async Task SyncOrdersToWarehouseAsync(CancellationToken ct)
{
    await foreach (var order in _sourceDb.Orders.AsNoTracking().AsAsyncEnumerable().WithCancellation(ct))
    {
        await _warehouseDb.FactOrders.AddAsync(MapToFact(order), ct);
        await _warehouseDb.SaveChangesAsync(ct); // dies at row 4M of 5M -> next run restarts from row 1, duplicating all of it
    }
}
```

### GOOD — watermark checkpoint plus upsert sink

```csharp
public async Task SyncOrdersToWarehouseAsync(CancellationToken ct)
{
    var checkpoint = await _warehouseDb.JobCheckpoints
        .FirstOrDefaultAsync(c => c.JobName == "SyncOrdersToWarehouse", ct)
        ?? new JobCheckpoint { JobName = "SyncOrdersToWarehouse", LastProcessedId = 0 };

    const int batchSize = 5_000;
    List<Order> batch;
    while ((batch = await _sourceDb.Orders.AsNoTracking()
        .Where(o => o.Id > checkpoint.LastProcessedId)
        .OrderBy(o => o.Id).Take(batchSize).ToListAsync(ct)).Count > 0)
    {
        await _warehouseDb.UpsertFactOrdersAsync(batch.Select(MapToFact), ct); // idempotent on reprocess

        checkpoint.LastProcessedId = batch[^1].Id;
        _warehouseDb.JobCheckpoints.Update(checkpoint);
        await _warehouseDb.SaveChangesAsync(ct); // checkpoint committed with the batch
    }
}
```

---

## Check D — Hardcoded recipient lists / cron schedules (ETL-004)

### Detection

Grep scheduled job registration and report-dispatch code for string-literal email addresses
or cron expressions embedded directly in C#. Flag ETL-004 — every change to recipients or
schedule then requires a code change and redeploy, with no self-service way for the business
owner to adjust it. Recommend the app's configurable settings store (see
`dotnet-dynamic-configuration`), read at dispatch time with cache invalidation on change.

### BAD — recipients and cron expression hardcoded

```csharp
RecurringJob.AddOrUpdate<MonthEndReportJob>("month-end-report",
    job => job.RunAsync(DateTime.UtcNow.Year, DateTime.UtcNow.Month, CancellationToken.None),
    "0 6 1 * *"); // hardcoded cron — changing the schedule requires a code change and redeploy

private static readonly string[] Recipients = ["finance@acme.com", "cfo@acme.com"]; // hardcoded

public async Task RunAsync(int year, int month, CancellationToken ct)
{
    var report = await BuildReportAsync(year, month, ct);
    foreach (var recipient in Recipients)
        await _emailService.SendAsync(recipient, "Month-end report", report);
}
```

### GOOD — recipients and schedule read from configurable settings store

```csharp
RecurringJob.AddOrUpdate<MonthEndReportJob>("month-end-report",
    job => job.RunAsync(DateTime.UtcNow.Year, DateTime.UtcNow.Month, CancellationToken.None),
    () => _reportSettings.GetCronExpression("month-end-report")); // resolved from settings store, admin-editable

public async Task RunAsync(int year, int month, CancellationToken ct)
{
    var recipients = await _reportSettings.GetRecipientsAsync("month-end-report", ct);
    var report = await BuildReportAsync(year, month, ct);
    foreach (var recipient in recipients)
        await _emailService.SendAsync(recipient, "Month-end report", report);
}
```

---

## Check E — No monitoring/alerting for silently failing scheduled jobs (ETL-005)

### Detection

Check whether recurring jobs have any completion/failure signal wired to an alerting channel
(Application Insights availability alert, a heartbeat/dead-man's-switch check) — or whether
the only visibility is the Hangfire dashboard itself, which nobody is watching. Flag ETL-005
when a job silently stops firing and no alert distinguishes "ran and failed" from "didn't
run at all."

### BAD — job failures are visible only in the Hangfire dashboard

```csharp
[AutomaticRetry(Attempts = 3)]
public async Task RunAsync(int year, int month, CancellationToken ct)
{
    var orders = await LoadOrdersAsync(year, month, ct);
    await BuildAndSendReportAsync(orders, ct);
    // If this throws after retries, the job shows "Failed" in Hangfire — nobody is paged.
}
```

### GOOD — explicit success/failure heartbeat wired to alerting

```csharp
[AutomaticRetry(Attempts = 3, OnAttemptsExceeded = AttemptsExceededAction.Fail)]
public async Task RunAsync(int year, int month, CancellationToken ct)
{
    try
    {
        var orders = await LoadOrdersAsync(year, month, ct);
        await BuildAndSendReportAsync(orders, ct);
        await _heartbeatService.RecordSuccessAsync("month-end-report", ct); // dead-man's-switch row
    }
    catch (Exception ex)
    {
        _telemetryClient.TrackException(ex);
        await _heartbeatService.RecordFailureAsync("month-end-report", ex.Message, ct);
        throw; // let Hangfire's retry/failure tracking still apply
    }
}
```

Alert rule: "no successful heartbeat for 'month-end-report' in the last 32 hours" pages
on-call — covers both an exception and the job never running at all.

---

## Check F — Report queries against the OLTP production database (ETL-006)

### Detection

Identify report/ETL data-access code sharing the same `DbContext`/connection string as the
live transactional application. Flag ETL-006 when a reporting query involves large
scans/aggregations against that connection — it competes for buffer pool, locks, and I/O
with live traffic, and a slow report can block and degrade the app for real users. Recommend
routing reporting/ETL workloads to a read replica or dedicated reporting/warehouse database
via a distinct `DbContext` configured for read-only, higher-timeout workloads.

### BAD — heavy report query runs against the same connection as live traffic

```csharp
public class SalesReportService(AppDbContext db) // same DbContext as checkout, cart, inventory
{
    public Task<List<SalesReportRow>> BuildQuarterlyReportAsync(int year, int quarter, CancellationToken ct) =>
        db.OrderLines
            .Where(ol => ol.Order.CreatedAt.Year == year && GetQuarter(ol.Order.CreatedAt) == quarter)
            .GroupBy(ol => ol.ProductId)
            .Select(g => new SalesReportRow(g.Key, g.Sum(x => x.Quantity), g.Sum(x => x.LineTotal)))
            .ToListAsync(ct); // full-quarter scan/aggregation directly against the OLTP primary
}
```

### GOOD — reporting connection routed to a read replica / reporting database

```csharp
// Program.cs
builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseSqlServer(builder.Configuration.GetConnectionString("Primary"))); // OLTP writes/reads

builder.Services.AddDbContext<ReportingDbContext>(opts =>
    opts.UseSqlServer(builder.Configuration.GetConnectionString("ReportingReplica"),
        sql => sql.CommandTimeout(300))); // read-replica / reporting DB, longer timeout

public class SalesReportService(ReportingDbContext reportingDb)
{
    public Task<List<SalesReportRow>> BuildQuarterlyReportAsync(int year, int quarter, CancellationToken ct) =>
        reportingDb.OrderLines
            .Where(ol => ol.Order.CreatedAt.Year == year && GetQuarter(ol.Order.CreatedAt) == quarter)
            .GroupBy(ol => ol.ProductId)
            .Select(g => new SalesReportRow(g.Key, g.Sum(x => x.Quantity), g.Sum(x => x.LineTotal)))
            .ToListAsync(ct); // runs against the replica, no contention with live checkout traffic
}
```

---

## Reporting/ETL checklist

- [ ] Jobs longer than the HTTP request timeout are enqueued via a background job runner, not inline
- [ ] Job status is queryable after enqueue instead of the caller blocking on the response
- [ ] Large source reads use `IAsyncEnumerable`/chunked batches, never one unbounded `ToListAsync()`
- [ ] Every multi-hour ETL job persists a checkpoint/watermark updated transactionally per batch
- [ ] Sink writes are upsert-safe so a reprocessed batch after a crash does not create duplicates
- [ ] Report recipients and cron schedules are read from a configurable settings store, not hardcoded
- [ ] A dead-man's-switch/heartbeat alert fires when a job neither succeeds nor fails on schedule
- [ ] Job failures page/notify a real channel, not just a dashboard nobody watches
- [ ] Reporting/ETL queries run against a read replica or dedicated reporting database, not OLTP
- [ ] Heavy aggregation queries have a bounded/longer command timeout than interactive OLTP queries

---

## References

- Hangfire recurring jobs: https://docs.hangfire.io/en/latest/background-methods/index.html
- EF Core `IAsyncEnumerable` streaming: https://learn.microsoft.com/en-us/ef/core/querying/async
- Azure SQL read replicas: https://learn.microsoft.com/en-us/azure/azure-sql/database/read-scale-out
- App Insights availability/heartbeat alerts: https://learn.microsoft.com/en-us/azure/azure-monitor/app/availability-overview
