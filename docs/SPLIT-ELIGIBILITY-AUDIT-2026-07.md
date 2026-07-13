# Plugin split-eligibility audit — 2026-07-12

> **Re-affirmed 2026-07-12 (`/audit-plugin` pre-submission pass).** That pass re-raised
> pilot-core's breadth (pipeline engine + standalone cross-cutting review skills) as a Low
> single-responsibility finding (S1). The KEEP-AS-IS verdict below stands: those skills are
> genuinely cross-stack and pilot-core is the shared base every other plugin depends on, so
> a split would permanently fragment the dependency graph for no proportional gain. The four
> seam skills added in that pass (`auth-token-contract` in pilot-core, `angular-realtime`,
> `azure-keyvault-appconfig`, `sql-hadr-failover`) are each cross-references *into* existing
> siblings — they reinforce the "glue, not bundle" reasoning, not weaken it. Counts below
> updated accordingly.

Submission-readiness review ahead of proposing FullStack Pilot to
`anthropics/claude-plugins-official`. Question answered, **per plugin**: should it be
split into multiple plugins before submission?

The test is **not** skill count. A 30-skill plugin covering one coherent domain is fine;
a 15-skill plugin spanning three unrelated domains is a split candidate. The operative
question for every cluster is: *would a team reasonably want to install this cluster
without the others?* High cross-dependency (shared agents, shared base skills, hooks or
cross-references spanning clusters) argues **against** a split even when the domains look
distinct.

## Method

For each plugin: (1) read every `SKILL.md` frontmatter description — not filenames;
(2) group skills into domain clusters (≥2 skills to count); (3) assess cross-cluster
dependency; (4) check whether one reviewer/implementor/support agent trio is shared
across all skills (splitting means duplicating or re-scoping that trio — a real cost,
not a file move); (5) verdict; (6) for any split, name the seam and flag what breaks.

## Verdict table

| Plugin | Skills | Domain clusters found | Cross-dependency | Verdict | Proposed split |
|---|---|---|---|---|---|
| pilot-core | 22 | Pipeline engine; cross-stack governance | Very high — foundation for all four other plugins | **KEEP AS-IS** | None |
| pilot-angular | 32 | a11y/motion; UI-UX & design system; state; platform (SSR/PWA/config); data/contract; real-time; workspace | High — one trio, dense cross-refs | **KEEP AS-IS** | None |
| pilot-dotnet | 57 | architecture; data/EF; API contract; auth/security; async/messaging; resilience; observability; feature tail | Very high — clean-arch base + single reviewer trio | **KEEP AS-IS** (closest call) | None recommended |
| pilot-sql | 9 | schema / query / migration / security / HA — one domain | High | **KEEP AS-IS** | None |
| pilot-azure | 14 | IaC/naming; security & WAF; ops/observability; cost — one domain | High | **KEEP AS-IS** | None |

## Per-plugin reasoning

### pilot-core (22 skills) — KEEP AS-IS
Two visible clusters: the **pipeline engine** (`stack-detection`, `pilot-scaffold`,
`foundation-bootstrap`, `fsp-build-orchestration`, `audit-orchestration`,
`batched-remediation`, `convention-learner`, `mcp-discovery`) that *is* the `/fsp-*`
command runtime and the delivery-team agents; and **cross-stack governance**
(`api-design-standards`, `architecture-decision-records`, `ci-secret-scanning`,
`dependency-supply-chain`, `dependency-license-compliance`, `git-workflow-governance`,
`incident-response-runbook`, `load-performance-testing`, `local-dev-onboarding`,
`search-integration`, `test-data-management`, `auth-token-contract`).

The governance skills exist *because* they glue the other plugins together —
`dependency-supply-chain` layers on `audit-orchestration`; `api-design-standards` ties
dotnet pagination/versioning to Angular's generated client; `load-performance-testing`
ties to `azure-slo-error-budget`; `incident-response-runbook` sits on
`azure-observability`. Every other plugin consumes pilot-core's `stack-profile.json`,
commands, agents, and the marketplace's only `hooks.json`. This is the foundation, not a
bundle — unsplittable.

### pilot-angular (32 skills) — KEEP AS-IS
Several sub-domains (a11y/motion, UI-UX & design system, signals vs NgRx state, SSR/PWA/
runtime-config platform, HTTP/contract, Nx/monorepo workspace), but **all govern one
artifact: the Angular/TypeScript frontend**. They share one trio
(`@angular-reviewer/-implementor/-support`, the last bundling Playwright) and are written
as a web of cross-references ("distinct from angular-security", "counterpart to
dotnet-error-handling"). No team wants Angular a11y without Angular state governance.

### pilot-dotnet (57 skills) — KEEP AS-IS (closest call)
Genuine clusters exist — architecture/standards, data/EF, API contract, auth/security,
**async/messaging** (the most self-contained: outbox, saga, messaging, webhooks, realtime,
notifications, background-jobs, reporting-etl, idempotency), resilience/caching,
observability, and a long feature tail. But cross-dependency is very high anyway: every
cluster is anchored on `dotnet-clean-architecture`; the `@dotnet-reviewer` description
enumerates all 57 as a single review pass; a single controller diff routinely touches
auth + validation + error-handling + dto-mapping at once. The skills are deliberately
authored as "distinct from dotnet-X" siblings. Splitting triplicates the reviewer/
implementor/support trio and shreds those cross-references. High count reflects domain
depth, not sprawl.

*If a split were ever forced,* the only defensible seam is an async/eventing extraction
(`pilot-dotnet-messaging`: outbox, saga, messaging, webhooks, realtime, notifications,
background-jobs, idempotency, reporting-etl). What breaks: the shared trio needs
duplicating/re-scoping; the reviewer mega-description and dozens of "distinct from
dotnet-X" references dangle; a new `marketplace.json` entry + `plugin.json` manifest is
required; and pilot-core skills that name dotnet skills by ID (`api-design-standards`,
orchestration) need path updates. Not justified.

### pilot-sql (9 skills) — KEEP AS-IS
Schema design, injection defense, migration safety, multitenancy, performance review,
PII data protection, index maintenance, backup/recovery, database-tier HA/failover — a
single SQL Server / EF Core domain with one trio. No split axis.

### pilot-azure (14 skills) — KEEP AS-IS
CAF naming, security baseline, WAF review, Bicep patterns, observability, CI/CD security,
DR/multi-region, cost/FinOps, AKS, API Management, landing zone, SLO/error-budget,
container-image security — a single Azure/IaC domain with one trio. No split axis.

## Summary

**No plugin should be split before submission.** The only plugin whose raw count invites
a split — pilot-dotnet at 57 skills — fails the test in the opposite direction: every
skill governs the same artifact (an ASP.NET Core solution), sits on a shared
`dotnet-clean-architecture` foundation, is reviewed by a single trio whose value is
seeing the whole backend in one pass, and is wired to its siblings by design. The same
logic keeps pilot-angular (31) intact. pilot-core looks like two clusters but is the
command runtime, agent roster, and cross-stack glue the other four install *against* —
architecturally unsplittable. pilot-sql and pilot-azure are single domains well under any
size concern. Net: high skill counts here reflect domain depth, not domain sprawl — all
five ship as-is.
