---
name: sql-schema-design
description: Reviews foundational SQL Server schema design before migration-safety, performance, or injection-defense checks even apply. Flags inconsistent table/column naming conventions, an undocumented surrogate-vs-natural key strategy, missing foreign key constraints enforced only in application code, missing NOT NULL/CHECK constraints on columns with a bounded business domain, stored procedures/views not checked into source control, and unbounded NVARCHAR(MAX) columns on well-known bounded domains. Outputs findings with sql-schema-design standard IDs.
when_to_use: schema design, table naming convention, primary key strategy, surrogate key, natural key, foreign key constraint, NOT NULL constraint, CHECK constraint, stored procedure source control, NVARCHAR(MAX), column length, database normalization, DDL review
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| SCH-001 | P2 | No consistent table/column naming convention |
| SCH-002 | P1 | Undocumented/inconsistent surrogate key strategy across tables |
| SCH-003 | P1 | Relationship enforced only in application code — no FOREIGN KEY constraint |
| SCH-004 | P2 | Missing NOT NULL/CHECK constraint on a column with a bounded business domain |
| SCH-005 | P2 | Stored procedures/views not checked into source control alongside migrations |
| SCH-006 | P3 | NVARCHAR(MAX)/unbounded length on a column with a well-known bounded domain |

---

## Check A — Inconsistent naming convention (SCH-001)

### Detection

Scan `CREATE TABLE`/migration DDL for a mix of casing (`PascalCase` alongside
`snake_case`), inconsistent pluralization (`Order` next to `Customers`), and
inconsistent prefixing (`tbl_Orders`, `dbo.Order`). A schema with no single
convention forces every new developer and every ORM mapping to special-case
table names, and ad hoc pluralization mistakes (`Order` vs `Orders`) become a
recurring source of EF Core `[Table]` attribute overrides.

### BAD — mixed conventions across the schema

```sql
CREATE TABLE dbo.tbl_Order (       -- legacy tbl_ prefix, singular
    OrderId INT PRIMARY KEY
);

CREATE TABLE dbo.customers (       -- snake_case, plural, no prefix
    customer_id INT PRIMARY KEY
);

CREATE TABLE dbo.OrderLine_Items ( -- PascalCase with underscore, plural
    Id INT PRIMARY KEY
);
```

### GOOD — one documented convention applied everywhere

```sql
-- Convention (documented in docs/DATABASE-CONVENTIONS.md):
--   PascalCase, plural table names, "Id" suffix on all keys, no prefixes.
CREATE TABLE dbo.Orders (
    Id INT IDENTITY PRIMARY KEY
);

CREATE TABLE dbo.Customers (
    Id INT IDENTITY PRIMARY KEY
);

CREATE TABLE dbo.OrderLineItems (
    Id INT IDENTITY PRIMARY KEY,
    OrderId INT NOT NULL REFERENCES dbo.Orders(Id)
);
```

---

## Check B — Undocumented surrogate key strategy (SCH-002)

### Detection

Check whether key strategy is consistent and deliberate: some tables use
`IDENTITY INT`, others `UNIQUEIDENTIFIER` (GUID), others a composite natural
key — with no documented rule for which to use when. This matters beyond
style: `IDENTITY INT` clusters well and is compact but is guessable/enumerable
and leaks row-creation order; GUIDs avoid enumeration and merge cleanly across
distributed writers but fragment a clustered index unless sequential
(`NEWSEQUENTIALID()`) or the clustering key is a separate `IDENTITY` column.
Cross-reference with `dotnet-entity-keys`, which governs the same decision
from the application/EF Core side.

### BAD — no rule, key type chosen per table by whoever wrote it

```sql
CREATE TABLE dbo.Orders (Id INT IDENTITY PRIMARY KEY);              -- int
CREATE TABLE dbo.Payments (Id UNIQUEIDENTIFIER PRIMARY KEY);         -- random GUID, fragments clustered index
CREATE TABLE dbo.AuditEvents (TenantId INT, EventTime DATETIME2, PRIMARY KEY (TenantId, EventTime)); -- composite natural key
```

### GOOD — documented rule, applied consistently

```sql
-- Rule (docs/DATABASE-CONVENTIONS.md):
--   Internal/high-write-throughput tables: IDENTITY INT/BIGINT (compact, clusters well).
--   Tables whose key is exposed externally (URLs, public APIs, multi-writer sync):
--     UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID() to avoid enumeration
--     while keeping clustered-index insert locality.
CREATE TABLE dbo.Orders (Id INT IDENTITY PRIMARY KEY);               -- internal only

CREATE TABLE dbo.Payments (
    Id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY  -- exposed in webhook URLs
);
```

---

## Check C — Relationship enforced only in application code (SCH-003)

### Detection

Grep DDL for tables that clearly reference another table by a same-named
`*Id` column (`OrderId`, `CustomerId`) with no matching `FOREIGN KEY`
constraint. Without a DB-level constraint, application-code bugs, direct SQL
scripts, or a bulk import can silently create orphaned rows — and nothing
in the database itself prevents or even detects it.

### BAD — no FK, orphaned rows possible

```sql
CREATE TABLE dbo.OrderLineItems (
    Id INT IDENTITY PRIMARY KEY,
    OrderId INT NOT NULL,   -- looks like a reference to Orders.Id, but nothing enforces it
    Sku NVARCHAR(50) NOT NULL
);
-- A bug in a cleanup script can DELETE FROM Orders without ever touching
-- OrderLineItems, leaving rows that reference an Order that no longer exists.
```

### GOOD — FK constraint enforced by the engine

```sql
CREATE TABLE dbo.OrderLineItems (
    Id INT IDENTITY PRIMARY KEY,
    OrderId INT NOT NULL REFERENCES dbo.Orders(Id) ON DELETE CASCADE,
    Sku NVARCHAR(50) NOT NULL
);
```

---

## Check D — Missing NOT NULL/CHECK constraint on a bounded domain (SCH-004)

### Detection

Look for columns whose business meaning has a well-known bounded/enumerable
domain (status codes, currency codes, percentages, email format) declared
with no `CHECK` constraint and no `NOT NULL`, pushing all validity
enforcement into application code. Any raw script, ad hoc fix, or a future
service that writes to the table bypasses that validation entirely.

### BAD — status column accepts any string, including NULL

```sql
CREATE TABLE dbo.Orders (
    Id INT IDENTITY PRIMARY KEY,
    Status NVARCHAR(20) NULL,      -- no constraint: NULL, "aproved" (typo), "999" all valid
    DiscountPercent DECIMAL(5,2) NULL  -- nothing stops -50 or 300
);
```

### GOOD — domain enforced at the schema level

```sql
CREATE TABLE dbo.Orders (
    Id INT IDENTITY PRIMARY KEY,
    Status NVARCHAR(20) NOT NULL
        CONSTRAINT CK_Orders_Status CHECK (Status IN ('Pending', 'Approved', 'Shipped', 'Cancelled')),
    DiscountPercent DECIMAL(5,2) NOT NULL DEFAULT 0
        CONSTRAINT CK_Orders_DiscountPercent CHECK (DiscountPercent BETWEEN 0 AND 100)
);
```

---

## Check E — Stored procedures/views not in source control (SCH-005)

### Detection

Check whether stored procedures, views, functions, and triggers are defined
as versioned migration scripts (or EF Core migration `Sql()` calls) checked
into the repository, versus existing only as objects deployed ad hoc through
SSMS. If a procedure only exists live in the database, there is no diff
history, no code review, and no way to reconstruct it if a
change needs to be rolled back — the same problem `architecture-decision-records`
solves for decisions applies here to executable schema objects.

### BAD — procedure created directly in SSMS, never committed

```text
<!-- No file anywhere in the repo defines dbo.usp_ApproveOrder. -->
<!-- It exists only as a live object in the Production database, -->
<!-- last modified by someone who has since left the team. -->
```

### GOOD — procedure defined as a versioned migration script

```sql
-- Migrations/Procedures/usp_ApproveOrder.sql (checked into source control,
-- applied via a migration step, re-run with CREATE OR ALTER on every deploy)
CREATE OR ALTER PROCEDURE dbo.usp_ApproveOrder
    @OrderId INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Orders SET Status = 'Approved' WHERE Id = @OrderId;
END
```

---

## Check F — Unbounded length on a well-known bounded domain (SCH-006)

### Detection

Grep DDL for `NVARCHAR(MAX)` (or very large lengths like `NVARCHAR(4000)`)
on columns whose business domain is well-known and bounded — email
addresses, phone numbers, postal codes, currency codes. `NVARCHAR(MAX)`
disables several SQL Server optimizations (can't be used in an index key,
forces off-row storage past 8000 bytes) and silently accepts pathological
input that a bounded length would reject at the schema level for free.

### BAD — unbounded columns for inherently bounded data

```sql
CREATE TABLE dbo.Customers (
    Id INT IDENTITY PRIMARY KEY,
    Email NVARCHAR(MAX) NOT NULL,        -- emails are practically ≤ 254 chars
    CurrencyCode NVARCHAR(MAX) NOT NULL  -- ISO 4217 codes are always 3 chars
);
```

### GOOD — bounded to the actual domain

```sql
CREATE TABLE dbo.Customers (
    Id INT IDENTITY PRIMARY KEY,
    Email NVARCHAR(254) NOT NULL,
    CurrencyCode CHAR(3) NOT NULL
        CONSTRAINT CK_Customers_CurrencyCode CHECK (CurrencyCode = UPPER(CurrencyCode))
);
```
