---
name: local-dev-onboarding
description: Reviews how quickly and consistently a new developer can get a full-stack local environment (Angular + .NET API + SQL Server + Azure emulators) running. Flags no single documented clone-and-run quick-start, no docker-compose (or equivalent) bringing up backing services together, local configuration diverging from CI/staging, no seeded local database available out of the box, no documented minimum tool-version matrix, and onboarding docs that go stale silently with no check confirming they still work. Outputs findings with pilot-core local-dev-onboarding standard IDs.
when_to_use: local dev setup, onboarding, clone and run, docker-compose, Azurite, SQL Server emulator, dev environment, works on my machine, tool version matrix, seeded database, quick start, CONTRIBUTING.md, stale onboarding docs
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| LDO-001 | P1 | No single documented "clone and run" quick-start path |
| LDO-002 | P1 | No docker-compose (or equivalent) bringing up backing services together |
| LDO-003 | P1 | Local configuration diverges from what CI/staging uses |
| LDO-004 | P2 | No seeded local database/reference data available out of the box |
| LDO-005 | P2 | No documented minimum tool-version matrix |
| LDO-006 | P2 | Onboarding docs go stale silently with no check they still work |

A new developer's first hour on a full-stack Angular + .NET + SQL Server + Azure project
sets the tone for how the whole team experiences the codebase's health. This skill treats
"can someone new get the app running today, without pinging three people" as a governance
concern in its own right, not a nice-to-have.

---

## Check A — No single documented "clone and run" quick-start (LDO-001)

### Detection

Check for a top-level `README.md` or `CONTRIBUTING.md` with an explicit, ordered
quick-start sequence (clone, install, configure, run) that takes a new developer from zero
to a running app. Its absence shows up as tribal knowledge — a new hire pinging three
different people for three different missing steps, each of whom only knows their own
corner of the stack.

### BAD — no consolidated setup doc; steps are scattered or unwritten

```markdown
<!-- README.md -->
# OrdersPlatform

A full-stack app. Ask in #orders-eng if you need help getting set up.
<!-- No steps at all. New developers reconstruct the setup by asking around. -->
```

### GOOD — one ordered quick-start covering the whole stack

```markdown
<!-- README.md -->
## Quick Start

1. `git clone https://github.com/org/orders-platform.git`
2. `cp .env.example .env` (see docs/dev-config.md for what each value means)
3. `docker compose up -d` — brings up SQL Server, Azurite, and Redis (see Check B)
4. `cd api && dotnet ef database update && dotnet run` — seeds and runs the API
5. `cd web && npm install && npm start` — runs the Angular dev server
6. Open http://localhost:4200 — log in with the seeded dev account (see docs/dev-config.md)

Total time from clone to running app: ~10 minutes on a clean machine.
```

---

## Check B — No docker-compose bringing up backing services together (LDO-002)

### Detection

Check for a `docker-compose.yml` (or equivalent) that starts every backing service the app
needs — SQL Server, Azurite (Storage emulator), Redis, a Service Bus emulator — as a single
step. Its absence forces each developer to install and configure every service manually,
which reliably produces environment drift between machines even on the same team.

### BAD — no compose file; each service is a separate manual install

```markdown
<!-- setup notes, tribal knowledge only -->
Install SQL Server Developer Edition locally. Also install Azurite via npm globally.
Configure both to run on startup. Ports may vary by machine.
```

### GOOD — one command brings up every backing service, pinned and consistent

```yaml
# docker-compose.yml
services:
  sql-server:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      ACCEPT_EULA: "Y"
      SA_PASSWORD: "${SQL_SA_PASSWORD}"
    ports: ["1433:1433"]

  azurite:
    image: mcr.microsoft.com/azure-storage/azurite:3.30.0
    ports: ["10000:10000", "10001:10001", "10002:10002"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

```
docker compose up -d
# SQL Server, Azurite, and Redis are all running with the same versions
# every developer and CI runner uses.
```

---

## Check C — Local configuration diverges from CI/staging (LDO-003)

### Detection

Compare local `.env`/`appsettings.Development.json` defaults against what CI and staging
actually use (connection string format, port numbers, feature-flag defaults). Divergence
here is the classic source of "works on my machine, fails in CI" — a local SQL Server
running on a nonstandard port, or a local-only feature flag that's off everywhere else.

### BAD — local config uses a different connection-string shape than CI/staging

```json
// appsettings.Development.json
{ "ConnectionStrings": { "Orders": "Server=localhost,14330;Database=Orders;Trusted_Connection=True;" } }
```

```yaml
# CI uses a completely different shape, discovered only when a CI-only bug appears
env:
  ORDERS_CONNECTION: "Server=tcp:sql-server,1433;Database=Orders;User Id=sa;Password=${{ secrets.SQL_PW }};"
```

### GOOD — local config mirrors CI/staging's shape, differing only in the secret value

```json
// appsettings.Development.json — same shape as CI/staging, generated from .env.example
{ "ConnectionStrings": { "Orders": "Server=tcp:localhost,1433;Database=Orders;User Id=sa;Password=${SQL_SA_PASSWORD};" } }
```

```markdown
<!-- docs/dev-config.md -->
Local, CI, and staging all use the same TCP connection-string shape and the same
default port (1433, from docker-compose in Check B). Only the password/secret differs.
```

---

## Check D — No seeded local database out of the box (LDO-004)

### Detection

Check whether running the setup sequence leaves the local database populated with usable
reference data (a few customers, orders, an admin login) versus completely empty. An empty
database means a new developer can't exercise most real features until they either write
data by hand or figure out the seeding step nobody documented. This ties directly into
`test-data-management`'s synthetic-data-seeding guidance (Check B there) — the same
synthetic seed data built for safe lower-environment refreshes is the natural default for
local onboarding too.

### BAD — `dotnet run` starts an API against a schema with zero rows

```
dotnet ef database update
dotnet run
# API starts, but every list screen in the Angular app renders empty.
# New developer has no way to see what a populated order list even looks like
# without manually inserting rows first.
```

### GOOD — the same migration step seeds synthetic reference data automatically

```csharp
// Program.cs (Development environment only)
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<OrdersDbContext>();
    db.Database.Migrate();
    if (!db.Orders.Any())
    {
        db.Orders.AddRange(OrderSeedData.Generate(50)); // same Faker-based seed as
        db.SaveChanges();                                // test-data-management Check B
    }
}
```

---

## Check E — No documented minimum tool-version matrix (LDO-005)

### Detection

Check for a stated minimum-version table (Node, .NET SDK, Angular CLI, SQL Server edition)
versus letting each developer install whatever version they happen to have. Version
mismatches (Node 18 vs 20, .NET 8 vs 9 SDK) reliably produce bugs that only reproduce on
some machines and waste hours before anyone thinks to check tool versions at all.

### BAD — no version guidance anywhere; everyone installs "whatever's current"

```markdown
<!-- README.md -->
Install Node, .NET, and Angular CLI, then run npm install.
<!-- No versions specified. Two developers on Node 18 and Node 22 respectively
     hit different, unreproducible build errors. -->
```

### GOOD — an explicit, enforced version matrix

```markdown
<!-- docs/dev-config.md -->
| Tool          | Minimum version | Enforced by |
|---------------|-----------------|-------------|
| Node.js       | 20.x LTS        | `.nvmrc`, `engines` in package.json |
| .NET SDK      | 9.0             | `global.json` |
| Angular CLI   | 18.x            | package.json devDependency |
| SQL Server    | 2022 (via docker-compose, Check B) | pinned image tag |
```

```json
// package.json
{ "engines": { "node": ">=20.0.0 <21.0.0" } }
```

---

## Check F — Onboarding docs go stale silently (LDO-006)

### Detection

Check whether there's any mechanism — a CI job that runs the documented quick-start
end-to-end, or a periodic manual review — confirming the onboarding steps still work as
the stack evolves. Without one, a docker-compose version bump or a renamed environment
variable quietly breaks the quick-start, and nobody notices until the next new hire hits
it and assumes they made a mistake.

### BAD — onboarding docs haven't been touched in a year despite three stack upgrades since

```
docs/CONTRIBUTING.md   (last updated 14 months ago)
docker-compose.yml     (SQL Server image bumped twice since; compose file never
                        re-verified against the doc's stated steps)
<!-- No CI job or scheduled review ever re-runs the documented steps from scratch. -->
```

### GOOD — a scheduled CI job proves the quick-start still works, from a clean checkout

```yaml
# .github/workflows/onboarding-check.yml
name: Onboarding quick-start check
on:
  schedule:
    - cron: '0 6 * * 1' # weekly
  pull_request:
    paths: ['docker-compose.yml', 'README.md', 'docs/dev-config.md']
jobs:
  quick-start:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker compose up -d
      - run: cd api && dotnet ef database update && dotnet run &
      - run: cd web && npm install && npm start &
      - run: npx wait-on http://localhost:4200 http://localhost:5000/health
      # If the documented quick-start no longer produces a running app,
      # this job fails before a new developer discovers it the hard way.
```
