---
name: sql-tsql-testing
description: Reviews automated testing of T-SQL logic that lives in the database — the one testing surface dotnet-testing and angular-testing don't reach. Flags stored procedures, functions, and triggers carrying business logic with no tSQLt test, tests that hit real tables instead of tSQLt FakeTable/SpyProcedure isolation, T-SQL tests not wired into CI, error/RAISERROR paths with no assertion (happy-path-only), and per-test data setup duplicated instead of a shared fixture. Outputs pilot-sql standard IDs (TSQ-*).
when_to_use: tSQLt, T-SQL unit test, stored procedure testing, function testing, trigger testing, FakeTable, SpyProcedure, AssertEquals, database test isolation, SQL test CI, RAISERROR assertion, sql business logic testing, testable stored procedure
---

## Purpose

`dotnet-testing` and `angular-testing` cover application code; business logic that lives in
stored procedures, scalar/table functions, and triggers has **no** test coverage from either.
For SQL Server that gap is filled by **tSQLt** — a T-SQL unit-test framework that runs each test
in its own auto-rolled-back transaction with table/procedure isolation. This skill reviews
whether database logic is tested the same way application logic is.

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| TSQ-001 | P1 | A stored procedure/function/trigger containing branching business logic has no automated test |
| TSQ-002 | P2 | Tests run against real tables instead of `tSQLt.FakeTable`/`SpyProcedure` isolation — order-dependent, non-deterministic |
| TSQ-003 | P2 | T-SQL tests are not wired into CI — run manually or never |
| TSQ-004 | P3 | Only the happy path is asserted; error/`RAISERROR`/rollback branches have no assertion |
| TSQ-005 | P3 | Test data setup duplicated per test instead of a shared setup/fixture procedure |

---

## Check A — Untested database logic (TSQ-001)

### Detection

For each procedure/function/trigger under source control (`sql-schema-design` SCH-005 requires
they be versioned), look for a corresponding tSQLt test class and test procedure. Flag any object
with conditional logic (`IF`, `CASE`, loops, multi-statement transactions) that has none. Trivial
CRUD wrappers are lower priority; anything computing, validating, or branching needs a test.

### GOOD — a tSQLt test isolating the procedure under test

```sql
EXEC tSQLt.NewTestClass 'OrderTests';
GO
CREATE PROCEDURE OrderTests.[test ApplyDiscount caps at 50 percent]
AS
BEGIN
    EXEC tSQLt.FakeTable 'dbo.Orders';                      -- isolate: no real schema/constraints/data
    INSERT dbo.Orders (Id, Subtotal, DiscountPct) VALUES (1, 100, 90);

    EXEC dbo.ApplyDiscount @OrderId = 1, @RequestedPct = 90;

    DECLARE @actual DECIMAL(5,2) = (SELECT DiscountPct FROM dbo.Orders WHERE Id = 1);
    EXEC tSQLt.AssertEquals @Expected = 50, @Actual = @actual;  -- business rule: cap at 50
END;
GO
```

---

## Check B — Missing isolation (TSQ-002)

Flag tests that `INSERT`/`SELECT` against the real table without `tSQLt.FakeTable` first. Real
tables drag in constraints, triggers, and leftover data from other tests, making results depend
on execution order. `FakeTable` replaces the table with a constraint-free empty copy for the
duration of the test's transaction; `SpyProcedure` records calls to a dependency procedure
without executing it.

```sql
-- BAD — no FakeTable; this test's rows collide with every other Orders test
INSERT dbo.Orders (Id, Subtotal) VALUES (1, 100);
-- GOOD — isolate first
EXEC tSQLt.FakeTable 'dbo.Orders';
```

---

## Check C — Not in CI (TSQ-003)

The suite must run automatically. Flag the absence of a pipeline step that deploys the schema +
tSQLt to a throwaway/LocalDB/container SQL instance and runs `tSQLt.RunAll`, failing the build on
any failed test. A test suite that only runs when a developer remembers is not a gate.

```yaml
# GOOD — CI runs the whole suite against a disposable SQL container and fails on any red test
- run: sqlcmd -S localhost -d AppDb -Q "EXEC tSQLt.RunAll" -b   # -b: nonzero exit on failure
```

---

## Check D — Happy-path-only (TSQ-004)

A procedure that `RAISERROR`s on invalid input or rolls back on a rule violation needs a test
asserting that path, not just the success case. Use `tSQLt.ExpectException` for the error branches.

```sql
EXEC tSQLt.ExpectException @ExpectedMessage = 'Discount exceeds maximum';
EXEC dbo.ApplyDiscount @OrderId = 1, @RequestedPct = 200;  -- must raise, not silently clamp
```

---

## Check E — Duplicated setup (TSQ-005)

Repeated `FakeTable` + seed blocks across every test in a class should factor into a
`SetUp`-named procedure (tSQLt runs a class's `SetUp` before each test) or a shared helper.
Advisory — flag when the same 5+ line seed is copy-pasted across three or more tests.

---

## Read budget

≤ 10 files: the procedures/functions/triggers under review and their test class(es), plus the CI
step that runs them. Reference `sql-schema-design` (SCH-005, objects under source control) and
`sql-migration-safety` for how the objects are deployed rather than re-deriving them. Budgets
bound exploration, not quality — if a procedure calls another that also needs a `SpyProcedure`,
read it and say why.
