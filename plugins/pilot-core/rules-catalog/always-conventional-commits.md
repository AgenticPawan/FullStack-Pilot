---
id: always-conventional-commits
title: Conventional Commits
appliesTo: always
severity: advise
standard: InternalPolicy
---
All commits must follow Conventional Commits format: `<type>(<scope>): <subject>`. Types: feat, fix, docs, ci, chore, refactor, test, perf. Breaking changes use `!` or a `BREAKING CHANGE:` footer.

**BAD**
```
git commit -m "fix stuff"
git commit -m "WIP"
git commit -m "changes"
```

**GOOD**
```
git commit -m "fix(auth): handle token expiry before refresh window closes"
git commit -m "feat(payments): add Stripe webhook signature validation"
git commit -m "chore: bump Angular to 18.3"
```
