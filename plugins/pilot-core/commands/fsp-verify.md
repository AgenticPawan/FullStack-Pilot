---
description: Run the 7-phase quality gate (build, lint, antipatterns, tests, security, migrations, diff) before declaring a feature done or opening a PR.
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

## Output

A pass/fail/warn status for each phase, then an overall `READY FOR PR` or `NOT READY` verdict.

A single 🔴 FAIL in any phase means the feature is not ready. Fix the reported issue and re-run `/fsp-verify`.

## Notes

- Skip Phase 6 if no migration files changed this session.
- Skip `ng` phases if `angular.json` does not exist in the project.
- Skip `dotnet` phases if no `.sln` or `.csproj` exists.
- Run after any batch of cross-file changes, not just at "done" time.
