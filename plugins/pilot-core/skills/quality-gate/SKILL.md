---
name: quality-gate
description: Seven-phase verification pipeline Claude runs before declaring any feature done across the full Angular/.NET/SQL/Azure stack. Phases: (1) Build — dotnet build + ng build, zero errors; (2) Analyzers — dotnet format --verify-no-changes + ng lint; (3) Antipatterns — antipattern-guard scan on changed files; (4) Tests — dotnet test + ng test --watch=false, no new failures; (5) Security — secrets, open firewall rules, unprotected endpoints; (6) Migrations — ef migrations list, no unapplied pending; (7) Diff review — git diff --stat main, confirm intended scope.
when_to_use: done, ready to ship, before PR, feature complete, /fsp-verify, quality gate, final check, verify, is this ready, all checks, pre-commit verification, before merge, ship it
---

## When to Run

Run `/fsp-verify` before declaring any feature done, before opening a PR, or after any batch of changes that span more than one file.

---

## Phase 1 — Build (zero errors)

```bash
dotnet build --no-restore 2>&1 | tail -5
ng build --configuration development 2>&1 | tail -10
```

**Pass criteria**: exit 0, zero errors. Warnings are documented but do not block.
**On failure**: stop here. Fix build errors before proceeding — subsequent phases are meaningless with a broken build.

---

## Phase 2 — Analyzers (style & lint)

```bash
dotnet format --verify-no-changes 2>&1
ng lint 2>&1
```

**Pass criteria**: no formatting violations. Lint warnings are documented.
**On failure**: run `dotnet format` or `ng lint --fix`, then re-check.

---

## Phase 3 — Antipattern Scan

Check changed `.ts`, `.cs`, and migration files against `knowledge/stack-antipatterns.md`:
- Angular: subscribe without cleanup, `: any` types, `console.log` in non-test files
- .NET: `new HttpClient()`, `async void`, `.Result`, `Console.WriteLine` in non-test files
- SQL: `SELECT *` in queries, missing tenant filter

The `antipattern-guard.js` hook already catches writes; this phase catches anything that was pre-existing in changed files.

**Pass criteria**: no new antipatterns introduced by the current changeset.

---

## Phase 4 — Tests (no new failures)

```bash
dotnet test --no-build --logger "console;verbosity=minimal" 2>&1
ng test --watch=false --browsers=ChromeHeadless 2>&1
```

**Pass criteria**: same or better pass rate than the baseline in `.claude/last-test-run.md`. A new test added and passing counts as an improvement.
**On failure**: list the failing test names and the error. Do not proceed until failures are understood (flake vs. real regression).

---

## Phase 5 — Security Spot Check

1. Grep changed files for hardcoded secrets (`password=`, `apiKey=`, `-----BEGIN`). The `secret-guard.js` hook should have caught these — this is a double-check.
2. Grep changed `.bicep` files for `allowBlobPublicAccess: true`, `allowAllWindowsAzureIps`.
3. Grep new ASP.NET Core endpoints for missing `[Authorize]` on non-public routes.
4. Check new Angular routes for missing permission guards.

**Pass criteria**: no new open findings. Existing known findings must be listed, not silently ignored.

---

## Phase 6 — Migration Safety

Only runs if any `Migrations/*.cs` file changed:

```bash
dotnet ef migrations list --no-build 2>&1
```

**Pass criteria**: `dotnet ef migrations list` shows no `(Pending)` migration that is not the one just added. A migration added in this session that hasn't been applied to dev is expected — flag it as "new, requires `dotnet ef database update` in dev before testing".

If a migration drops a column or table, confirm it is soft-deleting (not hard-deleting) or that a compensating migration exists.

---

## Phase 7 — Diff Review

```bash
git diff --stat main 2>&1
```

Read the stat output and answer:
- Are there files in the diff that shouldn't be (test fixtures, generated files, `.vs/`, `obj/`)?
- Is the scope of change consistent with the feature description?
- Are there changes in more than one stack that should have been separate commits?

**Pass criteria**: the diff is scoped as intended. Flag any unintended file changes before the user opens a PR.

---

## Output Format

```
## /fsp-verify — Quality Gate Report

Phase 1 Build:         ✅ PASS  (or 🔴 FAIL — <error summary>)
Phase 2 Analyzers:     ✅ PASS  (or ⚠️ WARN — <lint issues>)
Phase 3 Antipatterns:  ✅ PASS  (or ⚠️ WARN — <findings>)
Phase 4 Tests:         ✅ PASS  47/47 (or 🔴 FAIL — <N> new failures)
Phase 5 Security:      ✅ PASS  (or 🔴 BLOCK — <finding>)
Phase 6 Migrations:    ✅ PASS  (or ⚠️ WARN — <pending>)
Phase 7 Diff:          ✅ CLEAN (or ⚠️ WARN — <unintended files>)

Overall: READY FOR PR  (or NOT READY — fix phases: <list>)
```

A single 🔴 FAIL or 🔴 BLOCK in any phase means the feature is NOT ready for PR. Fix and re-run.
