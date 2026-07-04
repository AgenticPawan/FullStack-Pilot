---
name: Rule proposal
about: Propose a new rule for the pilot-core rules-catalog (materialized into a project's .claude/rules/)
title: "[rule-proposal] "
labels: rules-catalog
---

## Rule name

Follows the `rules-catalog` naming convention, e.g. `angular-gte17-*`, `dotnet-lt8-*`,
`always-*` for stack-independent rules.

## What it enforces

## Version gate

Which stack + version range triggers this rule via `stack-profile.json`? (`always`,
or e.g. `angular >= 17`, `dotnet < 8`)

## Why (citation required)

Link the Microsoft Learn page, framework changelog, CWE/OWASP entry, or other source
that justifies this as a rule rather than a style preference.

## Example violation and fix

```
// Violates the rule
...

// Complies
...
```

## Risk if this rule is wrong

What happens to a project if this rule is over-applied (false positive) or misses a case
it should catch (false negative)? `pilot-scaffold` materializes rules into real projects'
`.claude/rules/`, so a bad rule here has real blast radius.
