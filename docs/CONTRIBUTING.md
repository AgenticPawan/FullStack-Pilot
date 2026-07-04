# Contributing

Thanks for considering a contribution to FullStack Pilot. This document covers skill
authoring conventions; see [CLAUDE.md](../CLAUDE.md) for repo layout, hooks conventions,
and commit message format — read both before opening a PR.

## Before you start

1. Run `node scripts/validate.mjs` on a clean checkout so you know what "passing" looks
   like before your change.
2. One plugin or concern per PR. Don't bundle an `pilot-angular` skill fix with a
   `pilot-azure` rule change.
3. If you're touching `plugin.json` or `marketplace.json` schema fields, re-read
   ["Before any schema change"](../CLAUDE.md#before-any-schema-change) in CLAUDE.md first
   — the live docs are the authority, not memory of what the schema used to require.

## Skill authoring conventions

### Frontmatter contract

Every `SKILL.md` **must** begin with YAML frontmatter containing all three fields:

```yaml
---
name: <kebab-case-display-name>
description: <what it does and when Claude should use it>
when_to_use: <trigger phrases, e.g. "review angular component, check signal usage">
---
```

- `description` + `when_to_use` combined must not exceed 1024 characters —
  `scripts/validate.mjs` enforces this and fails CI if you exceed it.
- Add `disable-model-invocation: true` if the skill must only run when a user explicitly
  invokes it (never auto-triggered).
- Missing `description` is a hard CI failure, not a warning.

### Length limit

Keep the `SKILL.md` body under 400 lines. If you need more, that's a signal to split
reference material into a supporting file next to `SKILL.md` and link to it — don't
inline a 40-item table when a 5-row table plus a linked reference file will do.

### Evidence requirements

Every rule a skill enforces must be traceable to something a reader can verify:

- A specific file, line range, or code pattern the skill scans for
- A citation (Microsoft Learn URL, WCAG success criterion, CWE/OWASP ID, RFC) for *why*
  the rule exists — skills that assert a best practice with no citation get flagged in
  review
- Version-gating: if a rule only applies above/below a specific framework version, say
  so explicitly (see the `angular-gte17-*` / `angular-lt17-*` rules-catalog convention)

### BAD/GOOD pairs

Every enforcement-style skill (one that tells Claude to flag or fix something) should
include at least one BAD/GOOD code pair showing the violation and the fix side by side.
A skill that only describes a rule in prose, with no concrete before/after, is harder to
apply consistently and harder to review — reviewers should push back on skills that skip
this.

```typescript
// BAD — direct innerHTML bypasses Angular's built-in sanitization
this.el.nativeElement.innerHTML = untrustedHtml;

// GOOD — let Angular's template binding sanitize, or use DomSanitizer explicitly
// with a documented justification for the bypass
[innerHTML]="trustedHtml"
```

## Testing your change

- `node scripts/validate.mjs` must exit 0.
- If you added or changed a hook, add a case to `tests/hooks/run-tests.mjs` —
  `validate.mjs` runs this suite automatically and a broken hook fails CI.
- For a new skill, manually exercise it against one of the fixtures in `tests/fixtures/`
  (or add a new fixture if none fits) before opening the PR.

## Commit format

Follow [Conventional Commits](https://www.conventionalcommits.org/) as documented in
[CLAUDE.md](../CLAUDE.md#commit-conventions):

```
feat(pilot-<name>): add <skill|agent|hook> for <purpose>
fix(pilot-<name>): correct <what> in <component>
docs: update README or CLAUDE.md
ci: update validate workflow or scripts/validate.mjs
chore: bump versions in marketplace.json or plugin.json
```

## Proposing a new rule

If you're proposing a governance rule rather than a full skill, use the
`rule-proposal` issue template — it asks for the citation and evidence requirements
above before any code is written.
