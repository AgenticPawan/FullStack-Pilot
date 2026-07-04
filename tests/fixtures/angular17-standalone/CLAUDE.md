# angular17-standalone — Project Setup

## Stack

| Layer    | Technology | Version |
|----------|------------|---------|
| Frontend | Angular    | 17      |

## Architecture

- Style: Single-page application (frontend only)
- Multi-tenant: No
- Compliance: None
- Team size: 1–4 developers

## Frontend (Angular 17)

- Bootstrap: Standalone (`bootstrapApplication`)
- Change detection: Zone.js (default)
- Test runner: Jest
- Signals: Yes · SSR: No · ESLint: Yes · Prettier: No

## Build & Run Commands

```bash
npm install && ng serve               # dev server
npm test                              # unit tests (Jest)
ng build --configuration production   # production build
```

## Governance Rules

Materialized rules → `.claude/rules/` (5 active):
- always-no-hardcoded-secrets, always-structured-logging, always-conventional-commits
- angular-gte17-control-flow, angular-no-innerhtml

Full catalog: `plugins/pilot-core/rules-catalog/`
