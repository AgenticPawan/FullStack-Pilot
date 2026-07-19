---
description: Generate a graded A–F health report across Build, Tests, Security, Dependencies, Architecture, and Observability for the full stack.
---

Load the `stack-health` skill and produce a health report card for the current project.

## Output

A graded report across six dimensions (A=4.0 GPA, F=0.0), an overall GPA, and a ranked top-3 recommendation list with the skill or command to address each gap.

## Stacks Assessed

- **.NET** (if `.sln` or `.csproj` present): Build, Tests, Security, Architecture, Observability
- **Angular** (if `angular.json` present): Build, Tests, Architecture (lint/types), Dependency hygiene
- **Azure** (if `.bicep` files present): Security posture (public access, missing locks)
- **SQL** (if EF Core migrations present): Architecture compliance (antipatterns)

## Usage

Run `/fsp-health` any time to get a snapshot. Typical triggers:
- Before a production release
- After a batch of `/fsp-fix` runs to measure improvement
- During sprint planning to prioritize technical debt
- As part of `/fsp-audit` follow-up

## Notes

- Reads `.claude/pilot/audit/findings.json` for security posture if `/fsp-audit` was run recently.
- Reads `.claude/last-test-run.md` for test coverage proxy (written by the test-analyzer hook).
- Does not run `dotnet build` or `ng build` itself — uses last known build state. Run `/fsp-verify` first if you want a live build check before the health report.
