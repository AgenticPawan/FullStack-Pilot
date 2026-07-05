---
name: architecture-decision-records
description: Reviews whether significant architectural decisions are captured as Architecture Decision Records (ADRs) rather than living only in chat threads, PR descriptions, or the memories of whoever was in the room. Flags a significant decision made with no ADR recorded, ADRs not stored in a discoverable version-controlled location, no consistent lightweight ADR template, decisions never revisited or marked superseded once reversed, no process trigger defining when an ADR is required, and a PR that silently contradicts an existing ADR. Outputs findings with pilot-core architecture-decision-records standard IDs.
when_to_use: architecture decision record, ADR, docs/adr, decision log, why did we choose, technical decision documentation, superseded decision, RFC template, decision context and consequences, architecture review, tribal knowledge, decision trigger
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| DEC-001 | P1 | A significant architectural decision was made with no ADR recorded |
| DEC-002 | P2 | ADRs exist but aren't stored in a discoverable, version-controlled location |
| DEC-003 | P2 | No consistent lightweight ADR template (context/decision/consequences/alternatives) |
| DEC-004 | P1 | A reversed decision's ADR was never marked superseded |
| DEC-005 | P2 | No documented trigger for when an ADR is required |
| DEC-006 | P1 | A PR contradicts an existing ADR with no reference to revisiting/superseding it |

Code and git history explain *what* was built. Neither reliably explains *why* — why an
ORM was chosen over Dapper, why a monorepo over polyrepo, why a queue over a webhook. That
reasoning either gets written down deliberately, in one place, or it evaporates the moment
the person who made the call changes teams.

---

## Check A — Significant decision made with no ADR (DEC-001)

### Detection

Look for evidence of a significant, hard-to-reverse technical decision (choice of ORM,
auth provider, messaging pattern, monorepo vs polyrepo, a new cross-cutting library) with
no corresponding ADR — often visible as a large architectural PR whose description
mentions "after discussion we decided to go with X" but the discussion itself lived in a
Slack thread or a meeting nobody wrote up.

### BAD — the reasoning lives only in a merged PR's description

```markdown
<!-- PR #482: "Switch from Dapper to EF Core" -->
We talked about this in yesterday's sync, going with EF Core going forward.
<!-- No ADR. In six months, nobody merging a PR against this decision will know
     it was deliberate, what alternatives were considered, or why Dapper lost. -->
```

### GOOD — the same decision captured as a standalone ADR

```markdown
<!-- docs/adr/0007-orm-choice.md -->
# ADR-0007: Use EF Core as the standard ORM

## Status
Accepted

## Context
We have both Dapper and EF Core in use across services. New team members have to
learn two different data-access patterns for no functional benefit.

## Decision
Standardize on EF Core for all new services. Existing Dapper code is not migrated
retroactively unless the service is otherwise being rewritten.

## Consequences
Slower raw-query performance in a few hot paths (accepted trade-off; those paths
may still use FromSqlRaw per sql-injection-defense). Faster onboarding, one
migration/tooling story instead of two.

## Alternatives considered
Dapper (rejected: no built-in migrations); raw ADO.NET (rejected: too much boilerplate).
```

---

## Check B — ADRs not stored in a discoverable, version-controlled location (DEC-002)

### Detection

Check whether ADRs — if they exist at all — live in `docs/adr/` (or an equivalent
version-controlled path) alongside the code they govern, versus in a wiki with no link
from the repo, or a pinned Slack message. A decision record nobody can find when they need
it is barely better than no decision record.

### BAD — the "ADR" is a pinned message in a Slack channel that rotates people out over time

```
#eng-architecture (pinned):
"FYI we're standardizing on Azure Service Bus over raw HTTP webhooks for
inter-service events. — posted by @jordan, 14 months ago"
<!-- Not searchable from the repo, not versioned, gone the day the channel is archived. -->
```

### GOOD — ADR lives in the repo, linked from the README

```markdown
<!-- README.md -->
See [docs/adr/](docs/adr/) for a log of significant architectural decisions and why they were made.
```

```
docs/adr/
├── 0001-monorepo-vs-polyrepo.md
├── 0002-messaging-service-bus-over-webhooks.md
└── 0007-orm-choice.md
```

---

## Check C — No consistent ADR template (DEC-003)

### Detection

Compare the shape of existing ADRs against each other. Without a shared lightweight
template (Context / Decision / Consequences / Alternatives considered, at minimum), each
ADR ends up a different length and structure, making the set hard to skim and easy to
write inconsistently — some thorough, some a single unexplained sentence.

### BAD — every ADR has a different ad-hoc shape

```markdown
<!-- docs/adr/0002-messaging.md -->
We use Service Bus now. It's better than webhooks.
```

```markdown
<!-- docs/adr/0007-orm-choice.md -->
(a 3-page document with six subsections, diagrams, and a cost-benefit spreadsheet)
```

### GOOD — a shared template every ADR follows, whatever its length

```markdown
<!-- docs/adr/TEMPLATE.md -->
# ADR-NNNN: <short decision title>

## Status
Proposed | Accepted | Superseded by ADR-NNNN

## Context
<the problem/forces that made a decision necessary>

## Decision
<what was decided, stated plainly>

## Consequences
<what becomes easier, what becomes harder, trade-offs accepted>

## Alternatives considered
<options rejected and why>
```

---

## Check D — Reversed decision never marked superseded (DEC-004)

### Detection

For an ADR whose decision has since been reversed by a later change, check whether the
original ADR's `Status` was updated to `Superseded by ADR-NNNN`, versus left as `Accepted`
— a superseded ADR that still reads as current guidance actively misleads the next person
who finds it and follows it.

### BAD — ADR-0002 recommended Service Bus; ADR-0015 later moved to Event Grid, but ADR-0002 still says "Accepted"

```markdown
<!-- docs/adr/0002-messaging-service-bus-over-webhooks.md -->
## Status
Accepted
<!-- Actually replaced by ADR-0015 eight months ago. A new engineer reading ADR-0002
     today will build against Service Bus, believing it's still the standard. -->
```

### GOOD — the old ADR is explicitly marked superseded, pointing forward

```markdown
<!-- docs/adr/0002-messaging-service-bus-over-webhooks.md -->
## Status
Superseded by [ADR-0015](0015-event-grid-over-service-bus.md)
```

```markdown
<!-- docs/adr/0015-event-grid-over-service-bus.md -->
## Status
Accepted

## Context
ADR-0002 chose Service Bus. Since then, our event volume moved to a pattern
where Event Grid's pay-per-event model and native Azure resource event
integration outweigh Service Bus's ordering guarantees, which we don't rely on.
```

---

## Check E — No trigger defining when an ADR is required (DEC-005)

### Detection

Check for a documented rule stating what counts as "significant enough" to require an
ADR (e.g. "any decision affecting more than one team," "any decision that's expensive to
reverse"). Without one, teams either over-document trivial choices (an ADR for a variable
naming preference) or skip genuinely load-bearing ones (no ADR for switching the primary
datastore), and the inconsistency itself makes the ADR log less trustworthy as a source of
truth.

### BAD — no stated criteria; ADR-writing is arbitrary per author

```
docs/adr/0001-use-4-spaces-not-tabs.md
docs/adr/0002-team-lunch-schedule.md
<!-- Meanwhile: the switch from SQL Server to Cosmos DB for the Orders service
     six months ago has no ADR at all. -->
```

### GOOD — a documented trigger keeps the ADR log meaningful

```markdown
<!-- docs/adr/README.md -->
Write an ADR when a decision:
- affects more than one team or service, OR
- would be expensive/risky to reverse (data store, auth provider, messaging pattern), OR
- deliberately deviates from an existing ADR or documented convention.

Skip an ADR for reversible, single-team, low-blast-radius choices — a code review
comment or PR description is enough for those.
```

---

## Check F — PR silently contradicts an existing ADR (DEC-006)

### Detection

When a PR makes a change that runs counter to a decision already recorded in `docs/adr/`,
check whether the PR references the ADR being revisited (and, per Check D, whether that
ADR gets marked superseded) versus the contradiction going unremarked — reviewers who
haven't memorized every ADR won't necessarily notice the conflict unless the PR calls it
out.

### BAD — PR quietly reintroduces raw webhooks after ADR-0002 established Service Bus, with no mention of the ADR at all

```markdown
<!-- PR #710: "Add webhook endpoint for partner integration" -->
Adds a new /webhooks/partner-status endpoint for the Acme integration.
<!-- No mention that ADR-0002 established Service Bus as the standard inter-service
     event mechanism. Reviewers unfamiliar with ADR-0002 approve it without noticing
     the conflict; the codebase now has two competing patterns with no explanation. -->
```

### GOOD — PR calls out the conflict and either justifies an exception or supersedes the ADR

```markdown
<!-- PR #710: "Add webhook endpoint for partner integration" -->
Adds a new /webhooks/partner-status endpoint for the Acme integration.

Note: ADR-0002 established Service Bus as our standard for inter-service events.
This is intentionally an exception — Acme is an external partner that only
supports webhook delivery, not Service Bus. Internal event flows are unaffected.
See docs/adr/0002-messaging-service-bus-over-webhooks.md, Consequences section,
updated to note this external-partner carve-out.
```
