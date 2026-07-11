# Expected Drift Report — Angular 18 → 19 Simulation

This file shows the output `pilot-drift-check.mjs` produces when the project's
`package.json` is bumped to Angular 19 while `stack-profile.json` still records
`angular.majorVersion: 18`.

Run: `node plugins/pilot-core/templates/pilot-drift-check.mjs`
(with `package.json` = `drift-simulation/package.json` and
`stack-profile.json` = `drift-simulation/stack-profile.json` in the working directory)

---

## Simulated workflow console output

```
Drift detected: 2 item(s)
  - Angular major version: v18 → v19
  - .NET project removed or renamed: src/FullStack.Api/FullStack.Api.csproj → file not found
```

Note: the second item appears because the drift-simulation fixture is minimal and does
not include the .NET project files. In a real project checkout, `.csproj` files would
be present and this item would not appear.

---

## Simulated GitHub Issue body

```markdown
## Stack Drift Detected — 2026-07-04

Pilot drift detection found **1** change(s) since the last `stack-profile.json` update.

| Change | File | Delta | Recommended action |
|--------|------|-------|-------------------|
| Angular major version | package.json | `v18` → `v19` | Run `/fsp-init` to update stack-profile.json and activate new governance rules. |

---

**Next steps:**
1. Review the changes above.
2. Run `/fsp-init` in a Claude Code session on the default branch to update
   `stack-profile.json` and re-materialize governance rules.
3. Close this issue once `stack-profile.json` is committed.
```

---

## What `/fsp-init` does after drift is confirmed

When Angular major version drifts from 18 → 19:

1. `stack-profile.json` updated: `angular.majorVersion: 19`
2. Governance rule `angular-gte17-control-flow` remains active (still ≥17)
3. New Angular 19 rules from the rules catalog would be materialized
4. EOL advisory printed if the old version was 15 or 16 (not applicable here — 18 is current)
5. `conventions.md` tentative convention "Angular standalone with signals-first" may be
   upgraded to enforced if more component files are now present
6. `CLAUDE.md` stack table updated: `Angular (Standalone, SSR) | 19`

---

## How to run the simulation locally

```bash
# From the repo root — simulate against the drift-simulation fixture
cd tests/fixtures/drift-simulation
node ../../../plugins/pilot-core/templates/pilot-drift-check.mjs
```

Expected exit code: 0 (drift detection always exits 0 — drift is informational)
Expected `drift_detected` output variable: `true`
