---
name: sql-injection-defense
description: "Detects SQL injection risks in .NET + EF Core: flags FromSqlRaw with non-static string arguments, distinguishes safe FromSqlInterpolated from concatenated queries, reviews stored procedure EXEC patterns for dynamic SQL, and checks Dapper query strings for parameter hygiene. Maps all findings to CWE-89 / OWASP A03:2021 and emits them in the /fsp-audit findings schema. Defers query-optimization decisions to the dotnet-data plugin."
when_to_use: SQL injection, FromSqlRaw, FromSqlInterpolated, raw SQL, stored procedure, EXEC, sp_executesql, parameterized query, SQL concatenation, Dapper, CWE-89, OWASP A03, security audit
---

## Rule reference

| ID | Standard | Severity |
|----|----------|----------|
| sql-parameterized-queries | OWASP A03:2021 / CWE-89 | block |
| sql-no-fromsqlraw-dynamic | InternalPolicy | block |
| sql-stored-proc-hygiene | InternalPolicy | warn |

---

## Check A — FromSqlRaw with user-controlled input

`FromSqlRaw` is safe only with **fully static** string literals. Any concatenation or interpolation makes it a SQL injection sink.

### BAD — string concatenation (P0)

```csharp
// CWE-89: user input flows directly into raw SQL
var sql = "SELECT * FROM Orders WHERE Status = '" + status + "'";
return await _db.Orders.FromSqlRaw(sql).ToListAsync();

// Also bad — FormattableString constructed manually
var sql = string.Format("SELECT * FROM Users WHERE Name='{0}'", name);
_db.Users.FromSqlRaw(sql);
```

### BAD — string interpolation (P0)

```csharp
var sql = $"SELECT * FROM Users WHERE Name = '{name}'";
_db.Users.FromSqlRaw(sql);   // EF cannot parameterise this
```

### GOOD — EF Core LINQ (always preferred)

```csharp
var users = await _db.Users
    .Where(u => u.Name == name)
    .ToListAsync();
```

### GOOD — FromSqlInterpolated (when raw SQL is necessary)

```csharp
// EF Core converts the interpolation to DbParameters automatically
return await _db.Orders
    .FromSqlInterpolated($"SELECT * FROM Orders WHERE Status = {status}")
    .ToListAsync();
```

**Detection rule:** scan for `FromSqlRaw(` where the argument is not a `const` string or string literal without variable references. Any `+`, `$"..."`, `string.Format`, or `string.Concat` in the argument is a finding.

---

## Check B — ExecuteSqlRaw and ExecuteSqlInterpolated

Same split as above.

```csharp
// BAD: P0 — executes arbitrary SQL
await _db.Database.ExecuteSqlRaw($"DELETE FROM Logs WHERE UserId = {userId}");

// GOOD: EF Core converts to parameter
await _db.Database.ExecuteSqlInterpolated(
    $"DELETE FROM Logs WHERE UserId = {userId}");
```

---

## Check C — Stored procedure EXEC patterns

Dynamic stored procedure invocation is vulnerable when parameter values are concatenated into the EXEC string.

```csharp
// BAD: sp_executesql called with concatenated SQL
var cmd = $"EXEC sp_GetUser '{username}'";
await _db.Database.ExecuteSqlRaw(cmd);   // P0

// GOOD: stored proc called as fixed string with parameters
await _db.Database.ExecuteSqlInterpolated(
    $"EXEC sp_GetUser {username}");       // EF parameterises username
```

If `sp_executesql` is invoked from C# with a dynamic `@sql` argument built by concatenation, that is a separate P0 finding citing both the C# call site and the T-SQL pattern.

---

## Check D — Dapper (when used alongside EF Core)

```csharp
// BAD: string interpolation in Dapper query
var sql = $"SELECT * FROM Users WHERE Email = '{email}'";
var user = conn.QueryFirstOrDefault<User>(sql);

// GOOD: Dapper anonymous-object parameters
var user = conn.QueryFirstOrDefault<User>(
    "SELECT * FROM Users WHERE Email = @Email",
    new { Email = email });
```

---

## Finding output format

Emit one finding per injection site in the /fsp-audit schema:

```json
{
  "source": "semantic",
  "severity": "P0",
  "cwe": "CWE-89",
  "owasp": "A03:2021",
  "file": "src/Api/Repos/OrderRepository.cs",
  "line": 18,
  "title": "SQL injection via string concatenation into FromSqlRaw",
  "evidence": "var sql = \"SELECT * FROM Orders WHERE Status = '\" + status + \"'\";",
  "proposedFix": "Replace with FromSqlInterpolated($\"...{status}...\") or EF Core LINQ",
  "batchable": true,
  "confidence": "high"
}
```
