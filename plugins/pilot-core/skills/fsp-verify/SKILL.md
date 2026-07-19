---
name: fsp-verify
description: Run the 7-phase quality gate (build, lint, antipatterns, tests, security, migrations, diff) before declaring a feature done or opening a PR.
when_to_use: /fsp-verify, quality gate, verify before PR, check everything, pre-PR check, verify changes, is this ready, run all checks, done, ready to ship, before merge, feature complete
---

Load the `quality-gate` skill and execute all seven phases against the current working branch.

## Phases

1. **Build** — `dotnet build` + `ng build`, zero errors required
2. **Analyzers** — `dotnet format --verify-no-changes` + `ng lint`
3. **Antipatterns** — scan changed files against `knowledge/stack-antipatterns.md`
4. **Tests** — `dotnet test` + `ng test --watch=false`, no new failures
5. **Security** — secrets, open firewall rules, unprotected endpoints
6. **Migrations** — `dotnet ef migrations list`, no unexpected pending migrations
7. **Diff review** — `git diff --stat main`, confirm intended scope
