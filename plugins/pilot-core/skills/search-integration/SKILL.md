---
name: search-integration
description: Reviews integration of a dedicated search service (Azure Cognitive Search / Elasticsearch / OpenSearch) into a full-stack app in place of ad-hoc SQL queries. Flags full-text or fuzzy search implemented as a LIKE query against the primary OLTP database, a search index with no defined re-indexing/sync strategy against the source-of-truth database, no incremental indexing path (change feed/CDC/outbox) forcing slow full reindexes, relevance ranking left at default with no documented scoring profile, no access-control enforcement at the search layer, and no graceful degradation when the search service is unavailable. Outputs findings with pilot-core search-integration standard IDs.
when_to_use: search integration, Azure Cognitive Search, Azure AI Search, Elasticsearch, OpenSearch, full-text search, fuzzy search, search index, reindexing, incremental indexing, search relevance, scoring profile, search access control, search fallback, LIKE query search
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| SRCH-001 | P1 | Full-text/fuzzy search implemented as `LIKE '%term%'` against the OLTP database instead of a dedicated search index |
| SRCH-002 | P1 | Search index has no defined re-indexing/sync strategy against the source-of-truth database |
| SRCH-003 | P2 | No incremental indexing path — full reindex is the only way to update the search index |
| SRCH-004 | P2 | Relevance ranking left at default with no documented scoring profile for the domain |
| SRCH-005 | P0 | No access-control enforcement at the search layer — index returns documents the user isn't authorized to see |
| SRCH-006 | P1 | Search service treated as a hard dependency with no graceful degradation when unavailable |

This skill covers integrating a dedicated search service (Azure Cognitive Search / Azure
AI Search, Elasticsearch, OpenSearch) into a full-stack app instead of leaning on ad-hoc
SQL queries for search-shaped problems. `sql-performance-review` flags the SARGable-predicate
symptom (`LIKE '%term%'` defeating an index); this skill addresses the underlying fix —
routing full-text and fuzzy search to a system built for it — and the integration concerns
that come with running a second data store alongside SQL Server as the source of truth.

---

## Check A — Full-text/fuzzy search implemented as SQL LIKE (SRCH-001)

### Detection

Search the codebase for query methods backing a "search" text box or fuzzy-match feature
and check whether they resolve to `WHERE Column LIKE '%term%'` (or `Contains()` translated
to the same) against the primary OLTP database. A leading-wildcard `LIKE` cannot use a
standard index — `sql-performance-review`'s SARGable-predicate check (non-SARGable
predicate on an indexed column) flags exactly this pattern — and it has no concept of
relevance ranking, typo tolerance, or stemming; it can only ever answer "does this
substring appear," never "which result is the best match."

### BAD — full-text search routed straight at SQL Server with LIKE

```csharp
public async Task<List<Product>> SearchProductsAsync(string term)
{
    return await _db.Products
        .Where(p => p.Name.Contains(term) || p.Description.Contains(term))
        .ToListAsync();
    // Translates to WHERE Name LIKE '%term%' OR Description LIKE '%term%' —
    // full table scan on every keyword, no ranking, no typo tolerance,
    // and it gets slower as the catalog grows with no way to fix it via indexing.
}
```

### GOOD — full-text/fuzzy search routed to a dedicated search index

```csharp
public async Task<List<ProductSearchResult>> SearchProductsAsync(string term)
{
    var options = new SearchOptions { Size = 20, IncludeTotalCount = true };
    var response = await _searchClient.SearchAsync<ProductSearchResult>(term, options);
    return response.Value.GetResults().Select(r => r.Document).ToList();
    // Azure AI Search handles tokenization, fuzzy matching, and relevance scoring;
    // SQL Server stays the transactional source of truth and is never asked to
    // do a job it isn't built for.
}
```

---

## Check B — No re-indexing/sync strategy against the source of truth (SRCH-002)

### Detection

Once a search index exists, confirm there is a defined, documented process that keeps it
in sync with the OLTP database it's derived from — a scheduled job, an event-driven
pipeline, or at minimum a manual runbook with a stated cadence. An index that was
populated once at launch and never revisited silently drifts: products get renamed,
discontinued, or deleted in SQL Server, and the search index keeps serving the old data
indefinitely with nothing surfacing the discrepancy.

### BAD — index populated once, no ongoing sync

```csharp
// One-time setup script, run manually during the initial feature launch.
// No scheduled job, no event trigger, no documented re-run cadence exists anywhere.
await IndexAllProductsAsync();
// Six months later: products renamed or deleted in SQL Server still show up
// in search with stale names, prices, and availability — nobody owns re-running this.
```

### GOOD — documented, scheduled sync strategy

```csharp
// Hangfire recurring job, documented in docs/SEARCH-INDEX.md as the index's
// sync-of-record: "search index refreshes from Products every 15 minutes;
// see Check C for the lower-latency incremental path."
RecurringJob.AddOrUpdate<ProductIndexSyncJob>(
    "product-index-sync", job => job.RunAsync(), Cron.MinuteInterval(15));
```

---

## Check C — No incremental indexing path (SRCH-003)

### Detection

Check whether an update to a single record (a price change, a status flip) can reach the
search index without triggering a full reindex of the entire dataset. Full reindex as the
only update path means every change has to wait for the next batch job and pays the cost
of re-processing records that didn't change. Look for a change feed, CDC subscription, or
an outbox-driven sync (`dotnet-outbox-pattern`'s transactional outbox is a natural source
for this) that pushes only the delta into the index as it happens.

### BAD — full reindex is the only update mechanism

```csharp
public async Task RunNightlyReindexAsync()
{
    await _searchClient.DeleteIndexAsync();
    await _searchClient.CreateIndexAsync(_indexDefinition);
    var allProducts = await _db.Products.ToListAsync(); // entire table, every night
    await _searchClient.UploadDocumentsAsync(allProducts);
    // A price change made at 9am doesn't show up in search until the next
    // nightly run — and every unrelated product gets re-uploaded for it.
}
```

### GOOD — outbox-driven incremental sync

```csharp
public class ProductIndexOutboxConsumer
{
    public async Task HandleAsync(ProductChangedOutboxMessage message)
    {
        var product = await _db.Products.FindAsync(message.ProductId);
        if (product is null)
            await _searchClient.DeleteDocumentsAsync("id", new[] { message.ProductId.ToString() });
        else
            await _searchClient.MergeOrUploadDocumentsAsync(new[] { ToSearchDocument(product) });
        // Same transactional outbox that guarantees other side effects fire
        // (dotnet-outbox-pattern) now keeps the index seconds-fresh instead of
        // hours-stale, and only touches the document that actually changed.
    }
}
```

---

## Check D — Relevance ranking left at default (SRCH-004)

### Detection

Check whether the search query relies entirely on the search engine's default scoring
with no domain-specific tuning documented anywhere. Every domain has fields that should
outweigh a generic text-match score — an exact SKU match should outrank a fuzzy
description hit, a recently-updated listing should outrank a stale one — and leaving that
undocumented means relevance quality is accidental rather than a deliberate product
decision anyone can reason about or adjust.

### BAD — plain query, no scoring profile, no documented tuning

```csharp
var results = await _searchClient.SearchAsync<ProductSearchResult>(term);
// Whatever ranking Azure AI Search's default text-scoring algorithm produces is what
// ships. No one decided that an exact product-name match should beat a partial
// description hit, or that newer listings should be favored — it's whatever falls out.
```

### GOOD — a documented scoring profile tuned for the domain

```json
// index-definition.json — documented in docs/SEARCH-RELEVANCE.md
"scoringProfiles": [{
  "name": "productBoost",
  "text": { "weights": { "name": 3, "sku": 5, "description": 1 } },
  "functions": [{
    "type": "freshness",
    "fieldName": "lastUpdated",
    "boost": 2,
    "freshness": { "boostingDuration": "P30D" }
  }]
}]
```
```csharp
var options = new SearchOptions { ScoringProfile = "productBoost" };
var results = await _searchClient.SearchAsync<ProductSearchResult>(term, options);
// Exact SKU and name matches outrank incidental description hits, and listings
// updated in the last 30 days get a documented boost — a deliberate, reviewable choice.
```

---

## Check E — No access-control enforcement at the search layer (SRCH-005)

### Detection

Check whether search queries apply the same authorization rules as the rest of the
application before returning results. A search index is a denormalized copy of data built
for query speed, not for enforcing permissions — if the query issued against it doesn't
carry a permission or tenant filter, it will happily return documents the caller has no
right to see, even though the equivalent EF Core query would be scoped correctly by
`dotnet-authorization`'s permission checks or `sql-multitenancy`'s `HasQueryFilter`
tenant isolation.

### BAD — search query has no permission or tenant filter

```csharp
public async Task<List<TicketSearchResult>> SearchTicketsAsync(string term)
{
    var response = await _searchClient.SearchAsync<TicketSearchResult>(term);
    return response.Value.GetResults().Select(r => r.Document).ToList();
    // The index holds tickets from every tenant and every confidentiality level —
    // this query returns whatever text-matches, regardless of who's asking.
}
```

### GOOD — permission/tenant filter applied at the search query

```csharp
public async Task<List<TicketSearchResult>> SearchTicketsAsync(string term, TenantContext ctx)
{
    var options = new SearchOptions
    {
        Filter = $"tenantId eq '{ctx.TenantId}' and " +
                 $"visibleToRoles/any(r: search.in(r, '{string.Join(",", ctx.Roles)}'))"
    };
    var response = await _searchClient.SearchAsync<TicketSearchResult>(term, options);
    return response.Value.GetResults().Select(r => r.Document).ToList();
    // Every result is filtered to the caller's tenant and role, mirroring the same
    // isolation sql-multitenancy enforces in the database and dotnet-authorization
    // enforces on API endpoints — the search layer is not a bypass around either.
}
```

---

## Check F — No graceful degradation when the search service is unavailable (SRCH-006)

### Detection

Check what happens to the search feature when the search service times out, throttles, or
has an outage. If the only code path is a direct call to the search client with no
fallback, a transient search-service blip becomes a full outage of a feature users may
depend on for basic navigation, not just convenience. Confirm a fallback exists — even a
degraded one, like a basic SQL query — so search remains partially functional rather than
returning a hard error.

### BAD — search service is a hard dependency, no fallback

```csharp
public async Task<List<ProductSearchResult>> SearchAsync(string term)
{
    var response = await _searchClient.SearchAsync<ProductSearchResult>(term);
    return response.Value.GetResults().Select(r => r.Document).ToList();
    // If Azure AI Search throttles or has a regional outage, this throws and the
    // entire search feature goes down with it — no fallback path exists.
}
```

### GOOD — fallback to a basic SQL query on search-service failure

```csharp
public async Task<List<ProductSearchResult>> SearchAsync(string term)
{
    try
    {
        var response = await _searchClient.SearchAsync<ProductSearchResult>(term);
        return response.Value.GetResults().Select(r => r.Document).ToList();
    }
    catch (RequestFailedException ex) when (ex.Status is 503 or 429)
    {
        _logger.LogWarning(ex, "Search service degraded, falling back to SQL prefix match");
        return await _db.Products
            .Where(p => EF.Functions.Like(p.Name, $"{term}%"))
            .Take(20)
            .Select(p => new ProductSearchResult(p.Id, p.Name))
            .ToListAsync();
        // A basic prefix match against SQL Server, no ranking or fuzziness —
        // noticeably worse, but users still get results instead of an error page.
    }
}
```
