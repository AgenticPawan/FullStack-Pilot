---
name: incident-correlation
description: Takes multiple error artifacts — a .NET exception, a SQL timeout, an Angular HTTP error, an Azure alert body — and correlates them into a single request-chain timeline. Outputs correlation/request ID (if found), layer-by-layer event sequence, which layer introduced the failure vs. which propagated it, and a confidence rating (High/Medium/Low). Loaded exclusively by fsp-incident-responder.
when_to_use: correlate errors, request chain, where did this fail, trace this incident, multiple error artifacts, exception plus timeout, cross-layer failure, incident timeline, root cause chain, which layer failed, what happened, error correlation
---

## Purpose

A production incident typically surfaces as three or four simultaneous error signals: an
Angular `HttpErrorResponse`, a .NET exception in Application Insights, a SQL execution timeout,
and an Azure alert. These are usually one failure propagating through layers, not four
independent bugs. This skill's job is to reconstruct the single request chain from the
separate artifacts and identify the *origin* layer so the fix targets the root cause, not
a symptom.

Loaded exclusively by `@fsp-incident-responder`. Not user-invocable as a standalone command.

## Standard IDs

| ID | Confidence output | What it represents |
|----|-------------------|--------------------|
| IC-001 | Low | No correlation or request ID found in any artifact — cannot definitively link the signals |
| IC-002 | Medium | Multiple independent failures — artifacts are not causally linked (different request IDs or times) |
| IC-003 | High | SQL layer is the root — DB timeout/error propagates up through .NET to Angular |
| IC-004 | High | .NET layer is the root — application exception causes Angular HTTP error; SQL is incidental or absent |
| IC-005 | High | Angular/client is the root — malformed request payload causes .NET validation failure |

## Read budget (STRICT): max 15 files

Work primarily from the error artifacts the engineer pastes — they contain more diagnostic
signal than reading source code. Read source only to confirm a hypothesis (e.g. verify a
missing null-check at a specific line). If a scout brief exists under `.claude/pilot/context/`,
read it before opening source.

---

## Step 1 — Extract correlation signals from each artifact

For each error artifact provided, extract:

| Field | Where to look |
|-------|---------------|
| **Correlation ID / Request ID** | `traceparent` header, `X-Correlation-Id`, Application Insights `operation_Id`, structured log `CorrelationId` property |
| **Timestamp** | Exception timestamp, SQL timeout start, Angular XHR timing |
| **Layer** | Identify artifact as Angular, .NET, SQL, or Azure |
| **Error type** | HTTP status code, exception class name, SQL error code (e.g. 1205 = deadlock, timeout = wait exceeded), Azure alert rule name |
| **Request context** | HTTP method + path (if present), SQL query hash or text (if present) |

If a correlation ID is present in multiple artifacts → they link to the same request → proceed to
Step 2 with High confidence in the linkage. If not → note IC-001, proceed with timeline inference.

---

## Step 2 — Build the request-chain timeline

Order the artifacts by timestamp (earliest first). Typical propagation patterns:

### Pattern A — Database root (→ IC-003)
```
1. SQL: execution timeout / deadlock / missing index → query fails after N ms
2. .NET: DbContext throws DbUpdateException / SqlException → caught (or not) → 500 response
3. Angular: HttpErrorResponse 500 → user sees "something went wrong"
Azure: alert fires on HTTP 5xx rate or response-time SLO breach
```

### Pattern B — Application root (→ IC-004)
```
1. .NET: NullReferenceException / unhandled exception in handler → 500 before SQL is called
   (evidence: SQL artifact absent, or SQL executes successfully before the .NET exception)
2. Angular: HttpErrorResponse 500
Azure: alert fires on HTTP 5xx rate
```

### Pattern C — Client root (→ IC-005)
```
1. Angular: sends malformed payload (wrong field names, missing required field, wrong type)
2. .NET: returns 400 Bad Request with ProblemDetails validation errors
   (evidence: .NET exception is ValidationException / FluentValidation, not a server error)
3. SQL: not involved
```

### Pattern D — Independent failures (→ IC-002)
```
Artifacts have different correlation IDs, timestamps more than 5 min apart, or error types
in different layers that cannot plausibly share a call chain (e.g. a UI rendering error
and an unrelated background job timeout).
```

---

## Step 3 — Identify introduction point vs. propagation points

State explicitly:
- **Root layer**: the layer where the failure originated (where a fix would prevent all the others)
- **Propagation layers**: layers that received and re-surfaced the failure (fix here treats symptoms only)

Example:
```
Root layer: SQL (deadlock on Orders table — IC-003)
Propagation: .NET (SqlException not caught → 500); Angular (HttpErrorResponse 500 displayed to user)
Fix target: SQL deadlock cause (index, transaction order, lock escalation)
```

---

## Step 4 — Output the correlation report

```markdown
## Incident Correlation Report

Artifacts analysed: <list>
Correlation ID: <value, or "not found">

### Timeline
| Time offset | Layer | Event |
|-------------|-------|-------|
| T+0ms       | SQL   | Query execution began |
| T+2400ms    | SQL   | Timeout after 2400ms (threshold: 2000ms) |
| T+2401ms    | .NET  | SqlException thrown in OrderRepository.GetByIdAsync |
| T+2402ms    | .NET  | Unhandled → 500 Internal Server Error |
| T+2600ms    | Angular | HttpErrorResponse 500 on POST /api/orders |

### Root cause
<IC-ID> [Confidence: High/Medium/Low]
Root layer: <layer>
Evidence: <2-3 bullet points citing specific artifact lines>

### Propagation
<layer 2>: <how the error was re-surfaced>
<layer 3>: <how the error was re-surfaced>

### Fix target
<one sentence on where to apply the fix and why>

### What this is NOT
<explicitly rule out the other IC patterns and why the evidence doesn't support them>
```

---

## Confidence calibration

| Confidence | Conditions |
|------------|------------|
| High | Correlation ID links artifacts, timestamps are consistent, error type matches the propagation pattern |
| Medium | Timestamps consistent but no correlation ID, OR correlation ID found but error types ambiguous |
| Low | No correlation ID, timestamps differ by >5 min, or only one artifact is available |

When confidence is Low (IC-001): list what additional evidence would raise confidence (e.g.
"request the Application Insights operation_Id from the failing request" or "enable
`traceparent` header logging per `distributed-tracing-correlation` DTC-001").

---

## Rules

- Never guess a root cause without citing evidence from the provided artifacts.
- Never read more than 5 source files — the artifacts contain the signal; source confirms the theory.
- If the artifacts are insufficient to correlate, say so explicitly and list what is needed.
- Budgets bound exploration, not quality: stop and report with available evidence; never silently
  return a speculative result.
