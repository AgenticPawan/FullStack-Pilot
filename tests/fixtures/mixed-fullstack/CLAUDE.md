# crm-portal — Project Setup

## Stack

| Layer    | Technology                 | Version |
|----------|----------------------------|---------|
| Frontend | Angular (Standalone, SSR)  | 18      |
| Backend  | ASP.NET Core (Minimal)     | net8.0  |
| Database | SQL Server (EF Core)       | 8.0.4   |
| Infra    | Azure (Bicep, ACA)         | —       |

## Architecture

- Style: Clean Architecture — `FullStack.Api` → `FullStack.Domain`
- Multi-tenant: No
- Compliance: None
- Team size: 5–10 developers

## Frontend (Angular 18)

- Bootstrap: Standalone (`bootstrapApplication`)
- Change detection: Zone.js (zoneless not confirmed — see Open Questions)
- Test runner: Karma
- Signals: Yes · SSR: Yes (`@angular/ssr`) · ESLint + Prettier: Yes

## Backend (.NET 8 — Minimal API)

- Nullable: enabled · Implicit usings: enabled
- EF Core: 8.0.4 · MediatR: 12.2.0 · Resilience: 8.4.0
- Serilog: 8.0.0 · FluentValidation: 11.3.0 · OpenAPI: 6.5.0
- Test framework: xUnit (`tests/FullStack.Api.Tests`)

## Database

- EF Core Migrations: `src/FullStack.Api/Migrations/`
- Raw SQL files: `db/seed.sql`
- Connection strings: `src/FullStack.Api/appsettings.json` (Key Vault in prod)

## Azure / Infrastructure

- IaC: Bicep (`infra/main.bicep`)
- CI/CD: GitHub Actions (`.github/workflows/azure-deploy.yml`)
- Container: `Dockerfile`

## Build & Run Commands

```bash
# Frontend
npm install && ng serve               # dev server
ng test                               # unit tests (Karma)
ng build --configuration production   # production build

# Backend
dotnet restore
dotnet run --project src/FullStack.Api
dotnet test tests/FullStack.Api.Tests
dotnet ef database update --project src/FullStack.Api
```

## Governance Rules

Materialized rules → `.claude/rules/` (10 active):
- always-no-hardcoded-secrets, always-structured-logging, always-conventional-commits
- dotnet-gte8-resilience, dotnet-httpclient-factory, dotnet-efcore-projection
- angular-gte17-control-flow, angular-no-innerhtml
- sql-parameterized-queries, azure-managed-identity

Full catalog: `plugins/pilot-core/rules-catalog/`

## Open Questions

- Zone.js present in `package.json` but absent from `angular.json` polyfills[] — confirm whether zoneless is the intent.
