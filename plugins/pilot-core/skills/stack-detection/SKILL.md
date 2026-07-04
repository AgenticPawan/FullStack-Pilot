---
name: stack-detection
description: Evidence-based technology-stack detector. Analyzes the current working repository for Angular (v15–20), .NET (net6–net11), SQL Server, and Azure presence. Every conclusion must cite a file path. Writes .claude/pilot/stack-profile.json then prints a summary table for user confirmation before any downstream governance runs.
when_to_use: Run when the user invokes /pilot-init, asks to detect the project stack, requests a stack profile, or when a governance skill needs stack context that has not yet been profiled.
---

<!-- CONSTRAINTS — enforce in every step -->
<!-- IGNORE LIST: node_modules/ bin/ obj/ dist/ .git/ packages/ .angular/ -->
<!-- FILE READ BUDGET: ≤50 source files total; prefer manifests over source -->
<!-- EVIDENCE RULE: every non-null claim MUST cite a relative file path in the evidence map -->
<!-- NEVER print connection string values — record file paths only -->

## Step 0 — Establish project root

Set `PROJECT_ROOT` to the current working directory of the **user's project** (not this plugin repo). All paths below are relative to `PROJECT_ROOT`.

---

## Step 1 — Angular detection

**Skip this phase and set `angular: null` if no `angular.json` exists at project root.**

1. Glob `angular.json` at project root. If absent → `angular: null`, skip to Step 2.
2. Read `angular.json`:
   - Extract `projects[*].schematics["@schematics/angular:component"].standalone` → if `true`, note standalone schematics default.
   - Extract build `options.polyfills` array → if `"zone.js"` absent, candidate for zoneless.
3. Read `package.json` at project root:
   - Extract `dependencies["@angular/core"]` → strip semver prefix → `majorVersion` (integer 15–20).
   - Check `dependencies` or `devDependencies` for `@angular/ssr` or `@nguniversal/express-engine` → `ssr: true`.
   - Check `devDependencies` for `@angular-eslint/` (any key starting with it) → `eslint: true`.
   - Check `devDependencies` for `prettier` → `prettier: true`.
   - Check `devDependencies` for `karma` → testRunner candidate `"karma"`.
   - Check `devDependencies` for `jest` or `jest-preset-angular` → testRunner candidate `"jest"`.
   - Check `devDependencies` for `vitest` → testRunner candidate `"vitest"`.
   - Check `devDependencies` for `@web/test-runner` → testRunner candidate `"web-test-runner"`.
   - First match wins; if none → `"unknown"`.
4. Read the bootstrap entry (`src/main.ts` or the `browser`/`main` field from angular.json build options):
   - Contains `bootstrapApplication(` → `bootstrapMode: "standalone"`.
   - Contains `bootstrapModule(` or `platformBrowserDynamic(` → `bootstrapMode: "ngmodule"`.
5. Grep `src/` for `NgModule` (limit: 20 files, stop on first hit). If found → note ngmodule usage in `unknowns` if `bootstrapMode` is already `"standalone"` (hybrid app).
6. Grep `src/` for any of `signal(`, `computed(`, `effect(` (limit: 50 files total across all three patterns, stop on first hit). If found → `signalsUsed: true`.
7. Grep `src/` for `provideExperimentalZonelessChangeDetection\|provideZonelessChangeDetection` (limit: 10 files). If found → `zoneless: true`.

Evidence keys to populate:
- `angular.majorVersion` → path to `package.json`
- `angular.bootstrapMode` → path to bootstrap entry file
- `angular.signalsUsed` → path of first file containing signal/computed/effect
- `angular.zoneless` → path of first file with zoneless provider (or `package.json` if polyfills absence was the signal)
- `angular.ssr` → `package.json`
- `angular.eslint` → `package.json`
- `angular.testRunner` → `package.json`

---

## Step 2 — .NET detection

**Skip and set `dotnet: null` if no `*.sln` or `*.csproj` files exist (excluding ignore list).**

1. Glob `**/*.sln` (exclude ignore list). Record each path.
2. Glob `**/*.csproj` (exclude ignore list, max 20 files). For each csproj:
   a. Read file content.
   b. Extract `<TargetFramework>` or `<TargetFrameworks>` → normalize to array.
   c. Extract all `<PackageReference Include="X" Version="Y"/>` entries.
   d. Extract `<Nullable>` → `nullable: true` if value is `"enable"`.
   e. Extract `<ImplicitUsings>` → `implicitUsings: true` if value is `"enable"`.
   f. Extract `<ProjectReference Include="..."/>` → `referencedProjects` array.
3. For each csproj directory, check `Program.cs`:
   - Contains `WebApplication.CreateBuilder` → `hostingModel: "minimal"`.
   - Contains `CreateHostBuilder` or `UseStartup<` → `hostingModel: "startup"`.
   - Absent or neither → `hostingModel: "unknown"`.
4. Also check whether `Startup.cs` exists in the csproj directory. If yes and hostingModel is `"unknown"`, set `"startup"`.
5. Map packages to roles (first matching version string wins; null if absent):
   - EF Core: `Microsoft.EntityFrameworkCore` (any variant).
   - MediatR: `MediatR`.
   - Resilience: `Polly` or `Microsoft.Extensions.Resilience`.
   - Serilog: `Serilog` (any variant).
   - FluentValidation: `FluentValidation` (any variant).
   - OpenAPI: `Swashbuckle.AspNetCore` or `Microsoft.AspNetCore.OpenApi`.
   - xUnit: `xunit`; NUnit: `NUnit`; MSTest: `MSTest.TestFramework` or `Microsoft.NET.Test.Sdk` with `MSTest`.
6. `testFramework` for a project = whichever test package is found (null if none).

Evidence keys:
- `dotnet.solutions` → first `.sln` path
- `dotnet.projects[n].targetFramework` → csproj path
- `dotnet.projects[n].hostingModel` → `Program.cs` path (or csproj if Startup.cs)

---

## Step 3 — SQL detection

**Set `sql: null` only if ALL four sub-checks below return empty.**

1. Glob `**/Migrations/*.cs` (exclude ignore list, max 5 paths). If found → `efCoreMigrations: true`, record parent `Migrations/` directory as `migrationsPath`.
2. Glob `**/*.sql` (exclude ignore list). Count only; do not read content. If count > 0 → `rawSqlFiles: true`.
3. Glob `**/*.sqlproj` (exclude ignore list). If found → `dacpac: true`.
4. Grep `**/appsettings*.json` for `"ConnectionStrings"` (record file path ONLY — never print values).
   Also grep `**/*.yml` and `**/*.env*` for `Server=` or `Data Source=` (record file paths only).
   All matched paths → `connectionStringLocations` array.

Evidence keys:
- `sql.efCoreMigrations` → first `Migrations/*.cs` path
- `sql.rawSqlFiles` → first `.sql` file path
- `sql.dacpac` → `.sqlproj` path
- `sql.connectionStringLocations[0]` → first matched config file

---

## Step 4 — Azure detection

**Set `azure: null` if ALL sub-checks below return empty.**

1. Glob `**/*.bicep` (exclude ignore list). Record paths → `bicepFiles`. If any → `bicep: true`.
2. Glob `**/azuredeploy.json` (exclude ignore list). If found → `armTemplates: true`.
3. Glob `**/azure-pipelines*.yml` (exclude ignore list). If found → `azurePipelines: true`.
4. Glob `.github/workflows/*.{yml,yaml}`. Read each (max 5 files). Search for any of:
   - `azure/login`, `azure/webapps-deploy`, `AzureWebApp@`, `AzureFunctionApp@`, `AzureStaticWebApp@`
   If found in any workflow → `githubActionsAzure: true`, record the workflow file path.
5. Glob `**/Dockerfile` and `**/Dockerfile.*` (exclude ignore list). Record paths.
6. Glob `**/docker-compose*.yml` (exclude ignore list). Record paths.

Evidence keys:
- `azure.bicep` → first `.bicep` file path
- `azure.armTemplates` → `azuredeploy.json` path
- `azure.azurePipelines` → `azure-pipelines*.yml` path
- `azure.githubActionsAzure` → workflow file path containing Azure action
- `azure.dockerfiles` → first Dockerfile path

---

## Step 5 — Build unknowns list

Add an entry to `unknowns` for each question detection could not answer, e.g.:
- "Could not determine Angular test runner (no karma/jest/vitest/web-test-runner in devDependencies)"
- "Multiple TargetFrameworks found in <project> — which is the primary deployment target?"
- "Zone.js absent from polyfills but no zoneless provider found — zoneless status unclear"
- "Connection strings detected in <file> — confirm they are not committed with real values"

---

## Step 6 — Write stack-profile.json

Create `.claude/pilot/` directory in `PROJECT_ROOT` if it does not exist (use Write tool to create the file; the directory will be created implicitly).

Write `PROJECT_ROOT/.claude/pilot/stack-profile.json` using this exact schema:

```json
{
  "detectedAt": "<ISO-8601 UTC timestamp>",
  "angular": {
    "majorVersion": 17,
    "bootstrapMode": "standalone",
    "zoneless": false,
    "signalsUsed": true,
    "ssr": false,
    "eslint": true,
    "prettier": false,
    "testRunner": "jest"
  },
  "dotnet": {
    "solutions": ["MySolution.sln"],
    "projects": [
      {
        "name": "MyApi.csproj",
        "path": "src/MyApi/MyApi.csproj",
        "targetFramework": "net8.0",
        "hostingModel": "minimal",
        "nullable": true,
        "implicitUsings": true,
        "packages": {
          "efCore": "8.0.4",
          "mediatR": null,
          "resilience": null,
          "serilog": null,
          "fluentValidation": null,
          "openApi": "6.5.0"
        },
        "testFramework": null,
        "referencedProjects": []
      }
    ]
  },
  "sql": {
    "efCoreMigrations": true,
    "migrationsPath": "src/MyApi/Migrations",
    "rawSqlFiles": false,
    "dacpac": false,
    "connectionStringLocations": ["src/MyApi/appsettings.json"]
  },
  "azure": {
    "bicep": true,
    "bicepFiles": ["infra/main.bicep"],
    "armTemplates": false,
    "azurePipelines": false,
    "githubActionsAzure": true,
    "githubActionsFiles": [".github/workflows/azure-deploy.yml"],
    "dockerfiles": ["Dockerfile"]
  },
  "evidence": {
    "angular.majorVersion": "package.json",
    "angular.bootstrapMode": "src/main.ts",
    "angular.signalsUsed": "src/app/app.component.ts",
    "angular.eslint": "package.json",
    "angular.testRunner": "package.json",
    "dotnet.solutions": "MySolution.sln",
    "dotnet.projects[0].targetFramework": "src/MyApi/MyApi.csproj",
    "dotnet.projects[0].hostingModel": "src/MyApi/Program.cs",
    "sql.efCoreMigrations": "src/MyApi/Migrations/20240101_InitialCreate.cs",
    "sql.connectionStringLocations[0]": "src/MyApi/appsettings.json",
    "azure.bicep": "infra/main.bicep",
    "azure.githubActionsAzure": ".github/workflows/azure-deploy.yml"
  },
  "unknowns": []
}
```

Omit example values; populate with actual detected data. Set stacks not detected to `null`.

---

## Step 7 — Print summary table and confirm

After writing the file, output:

```
## Stack Profile — <basename of PROJECT_ROOT>

| Stack   | Detected | Key Details                                         |
|---------|----------|-----------------------------------------------------|
| Angular | ✓ v17    | Standalone, Signals ✓, ESLint ✓, Jest, no SSR       |
| .NET    | ✗        |                                                     |
| SQL     | ✗        |                                                     |
| Azure   | ✗        |                                                     |

Profile written to: .claude/pilot/stack-profile.json

Does this look correct? Reply **YES** to proceed, or describe any corrections.
```

Use `✓` / `✗` for presence. Fill "Key Details" from detected fields.

**Do NOT run any downstream governance checks until the user explicitly confirms.**
