---
name: Skill request
about: Propose a new skill or agent for an existing plugin
title: "[skill-request] "
labels: enhancement
---

## Plugin

Which plugin should this live in? If none fit, say so — it may need a new plugin.

## What should the skill do

## When should Claude invoke it

Trigger phrases / situations (this becomes the skill's `when_to_use` frontmatter field).

## Evidence / citation

Per [CONTRIBUTING.md](../../docs/CONTRIBUTING.md#evidence-requirements), every skill rule
needs a traceable source — a Microsoft Learn URL, WCAG success criterion, CWE/OWASP ID,
RFC, or a specific code pattern. What's the citation here?

## Version gating (if applicable)

Does this only apply above/below a specific framework version? See the
`angular-gte17-*` / `angular-lt17-*` convention in `rules-catalog/`.

## Example BAD/GOOD pair (if this is an enforcement-style skill)

```
// BAD
...

// GOOD
...
```
