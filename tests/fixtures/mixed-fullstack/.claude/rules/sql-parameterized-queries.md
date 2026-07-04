---
id: sql-parameterized-queries
title: Parameterized Queries Only — No Raw SQL Concatenation
appliesTo: sql
severity: block
standard: OWASP-A03,CWE-89
---
All SQL queries must use parameterized inputs. String concatenation or interpolation into SQL is a severity=block violation. Use EF Core LINQ queries or `FromSqlInterpolated` (which is safe) — never `FromSqlRaw` with concatenated strings.

**BAD**
```csharp
// SQL injection: user input flows directly into the query string
var sql = $"SELECT * FROM Users WHERE Name = '{name}'";
db.Database.ExecuteSqlRaw(sql);

var raw = "SELECT * FROM Orders WHERE Id = " + orderId;
db.Database.ExecuteSqlRaw(raw);
```

**GOOD**
```csharp
// EF Core LINQ — always parameterized
var users = await db.Users.Where(u => u.Name == name).ToListAsync();

// Raw SQL when needed — use interpolated form (EF Core converts to parameters)
var order = await db.Orders
    .FromSqlInterpolated($"EXEC sp_GetOrder {orderId}")
    .FirstOrDefaultAsync();
```
