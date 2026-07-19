---
name: fsp-health
description: "Generate a graded A–F health report across Build, Tests, Security, Dependencies, Architecture, and Observability for the full stack."
when_to_use: /fsp-health, health report, project health, health check, grade my project, stack health, technical debt overview, overall status, what needs fixing, project score, is the project healthy
---

Load the `stack-health` skill and produce a health report card for the current project.

## Output

A graded report across six dimensions (A=4.0 GPA, F=0.0), an overall GPA, and a ranked top-3 recommendation list with the skill or command to address each gap.

## Stacks Assessed

- **.NET** (if `.sln` or `.csproj` present): Build, Tests, Security, Architecture, Observability
- **Angular** (if `angular.json` present): Build, Tests, Architecture (lint/types), Dependency hygiene
- **Azure** (if `.bicep` files present): Security posture (public access, missing locks)
