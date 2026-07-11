---
name: convention-learner
description: Samples the current codebase (≤50 files, ignore lists apply) and writes detected house conventions — naming, folder layout, error-handling shape, DI registration style, test naming — to .claude/pilot/knowledge/conventions.md. Enforcement threshold: every convention requires ≥3 distinct evidence paths (file:line); fewer evidence paths → listed as tentative with no enforcement weight. Never invents conventions not evidenced in the code.
when_to_use: Run via /fsp-learn --conventions or when the user asks to detect conventions, learn naming patterns, document project structure, or update conventions.md. Also triggered after /fsp-init to capture patterns the profile does not cover.
disable-model-invocation: true
---

<!-- CONSTRAINTS -->
<!-- MAX FILES: 50 total reads across all steps. Prioritise manifests and entry points. -->
<!-- IGNORE: node_modules/ bin/ obj/ dist/ .git/ packages/ .angular/ .cache/ -->
<!-- EVIDENCE RULE: every convention entry must cite ≥3 distinct (file:line) paths. -->
<!-- INVENTION RULE: never state a convention without evidence. Tentative = <3 paths. -->
<!-- OUTPUT: PROJECT_ROOT/.claude/pilot/knowledge/conventions.md (overwrite on each run) -->

---

## Step 0 — Establish scope

Set `PROJECT_ROOT` to the current working directory of the user's project. Read
`PROJECT_ROOT/.claude/pilot/stack-profile.json` to know which stacks are present and
which directories to prioritise.

Allocate the 50-file budget:
- .NET: up to 20 files — `Program.cs`, `*.csproj` (all), representative service/controller/repo files
- Angular: up to 15 files — `angular.json`, `package.json`, representative component/service files
- SQL: up to 5 files — one migration, seed files
- Azure: up to 5 files — `*.bicep`, workflow YAMLs
- Tests: up to 5 files — test class samples

---

## Step 1 — Naming conventions

For each stack present:

### .NET naming
1. Glob `**/*.csproj` (max 10). Extract project names. Detect pattern: `<Namespace>.<Layer>`,
   `<Namespace>.<Layer>.<Sublayer>`, flat single-namespace, etc.
2. Glob `**/Controllers/**/*.cs`, `**/Services/**/*.cs`, `**/Repositories/**/*.cs` (max 5 each).
   Extract class names. Detect suffix conventions: `Controller`, `Service`, `Repository`,
   `Handler`, `Validator`, `Query`, `Command`.
3. Read any 3 representative `.cs` class files. Detect method naming: `PascalCase`, `camelCase`
   for private fields (`_fieldName` vs `fieldName` vs `m_fieldName`).

### Angular naming
1. Read `angular.json`. Extract project name and prefix.
2. Glob `**/*.component.ts` (max 5). Detect selector prefix (e.g. `app-`, `crm-`).
3. Glob `**/*.service.ts`, `**/*.pipe.ts`, `**/*.directive.ts` (max 3 each). Confirm naming suffixes.

Compile `naming` evidence map: for each pattern found, record all (file:line) instances.

---

## Step 2 — Folder layout

1. List top-level directories (no recursion): record names and purpose mapping.
2. Check for: `src/`, `tests/`, `infra/`, `db/`, `docs/`, `scripts/`.
3. Within `src/` (if present): list immediate subdirectories. Detect: `<Solution>.<Layer>` pattern,
   feature-folder pattern (`Features/`), or flat-all-in-one.
4. Within `tests/` (if present): check whether test projects mirror source projects
   (e.g. `FullStack.Api.Tests` mirrors `FullStack.Api`).
5. For Angular: check whether components are in `src/app/features/`, `src/app/shared/`, or
   directly under `src/app/`.

Record each layout observation as a convention with the directory paths as evidence.

---

## Step 3 — DI registration style

Read `Program.cs` (or `Startup.cs` if present). Detect:
- **Assembly-scanning**: `RegisterServicesFromAssemblyContaining`, `AddValidatorsFromAssemblyContaining`, `AddMediatR`
- **Manual explicit registration**: `services.AddScoped<IService, Service>()`
- **Extension methods**: `services.AddMyFeature()` calls (look for custom extension methods)
- **Autofac / Scrutor** module patterns

For each style found, record the specific call site as evidence. If the project uses both
scanning and manual registration, record both as separate conventions.

---

## Step 4 — Error-handling shape

Read up to 5 controller/handler/endpoint files. Detect:
- **Result pattern**: `Result<T>`, `OneOf<Success, Error>`, `IResult` returns
- **Exception-based**: `try/catch` with `throw`, reliance on middleware
- **ProblemDetails**: `TypedResults.Problem(...)`, `Results.ValidationProblem(...)`
- **FluentValidation middleware**: `AddFluentValidationAutoValidation` in Program.cs

For each endpoint, note return type and error path. Compile evidence paths.

---

## Step 5 — Test naming

Read up to 5 test class files. Detect:
- **Class naming**: `<TargetClass>Tests`, `<TargetClass>Specs`, `When<Scenario>`
- **Method naming**: `Should_<Expected>_When_<Condition>`, `<Method>_<Scenario>_<Expected>`,
  `Given_<State>_When_<Action>_Then_<Result>` (GWT)
- **Test toolchain**: xUnit/NUnit/MSTest, NSubstitute/Moq/FakeItEasy, Mvc.Testing/TestServer

---

## Step 6 — Evaluate evidence and write conventions.md

For each detected convention:
1. Count distinct `(file:line)` evidence paths.
2. If ≥ 3 → `status: enforced`
3. If 1–2 → `status: tentative` — listed for awareness only, not cited in code reviews

Write `PROJECT_ROOT/.claude/pilot/knowledge/conventions.md` (full overwrite):

```markdown
# House Conventions — <project-name>

_Generated by convention-learner on <ISO date>. Re-run `/fsp-learn --conventions` after major refactors._

---

## Naming

### <Convention title> — <enforced | tentative>

**Pattern:** <description>

**Evidence** (<N> paths):
- `<file>:<line>` — <quote or brief description>
- `<file>:<line>` — <quote or brief description>
- `<file>:<line>` — <quote or brief description>
[additional paths if present]

> ⚠ Tentative — only <N> evidence path(s) found. Not enforced until ≥3 are confirmed.
[show warning only for tentative conventions]

---

## Folder Layout

[same structure]

---

## DI Registration

[same structure]

---

## Error Handling

[same structure]

---

## Test Conventions

[same structure]

---

## Revision history

| Date | Change |
|------|--------|
| <ISO date> | Initial detection (<N> enforced, <N> tentative) |
```

---

## Step 7 — Output

Print in chat:

```
## Conventions written

conventions.md → .claude/pilot/knowledge/conventions.md

Enforced (<N>):  <comma-separated list of convention titles>
Tentative (<N>): <comma-separated list> — need more evidence before enforcing

Re-run this skill after adding components/services to confirm tentative conventions.
```

Do not make any code changes. Read-only except for writing conventions.md.
