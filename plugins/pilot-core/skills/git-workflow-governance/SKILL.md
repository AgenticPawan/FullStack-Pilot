---
name: git-workflow-governance
description: Reviews branching strategy, PR size/review policy, and merge hygiene at the process level — distinct from the repo's always-conventional-commits rule, which governs commit MESSAGE format, not branching or review process. Flags no documented branching strategy, no enforced PR size guidance, no required-review/branch-protection rule on the default branch, long-lived feature branches with no rebase cadence, and no documented squash/merge/rebase policy. Outputs findings with pilot-core git-workflow-governance standard IDs.
when_to_use: branching strategy, trunk-based development, GitFlow, GitHub Flow, PR size, pull request size limit, branch protection, required reviewers, direct push to main, long-lived branch, feature branch drift, merge conflict, squash merge, rebase merge, merge commit policy, git bisect, git blame
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| GWF-001 | P1 | No documented branching strategy |
| GWF-002 | P1 | No enforced PR size guidance |
| GWF-003 | P0 | No required-review/branch-protection rule on the default branch |
| GWF-004 | P2 | Long-lived feature branch with no rebase/merge-from-main cadence |
| GWF-005 | P2 | No documented squash-vs-merge-vs-rebase policy |

This skill governs the branching, PR-review, and merge-strategy *process* — how work
flows into the default branch. It does not govern commit message format, which is already
enforced by this repo's `always-conventional-commits` rule; that rule and this skill are
complementary, not overlapping.

---

## Check A — No documented branching strategy (GWF-001)

### Detection

Check for a documented, agreed branching model (trunk-based, GitFlow, GitHub Flow) in a
CONTRIBUTING.md or team wiki. Without one, contributors improvise: some branch off `main`
per feature and merge quickly, others keep a branch alive for weeks accumulating unrelated
commits, and a few branch off other feature branches. The result is a divergent branch
graph that's painful to merge and impossible to reason about from `git log --graph` alone.

### BAD — no stated strategy; branch naming and lifetime are ad hoc

```markdown
<!-- CONTRIBUTING.md -->
## Contributing
Fork or branch, make your changes, open a PR.
<!-- No guidance on branch lifetime, base branch, or when to branch off another branch. -->
```

### GOOD — an explicit, named strategy

```markdown
<!-- CONTRIBUTING.md -->
## Branching strategy: Trunk-based development

- All feature branches fork from `main` and merge back into `main`.
- Branches are short-lived: open a PR within 2-3 days of starting, even in draft state.
- Never branch off another feature branch — branch off `main` directly. If you need
  another branch's work, wait for it to merge or coordinate a shared integration branch.
- Long-running initiatives use feature flags (see `dotnet-feature-flags`/`angular-*`
  equivalents) instead of long-lived branches, so `main` stays releasable at all times.
```

---

## Check B — No enforced PR size guidance (GWF-002)

### Detection

Check whether the repo documents (and CI optionally enforces) a target PR diff size.
Without a stated limit, PRs mixing a refactor, a new feature, and an unrelated bug fix in
a single 1,400-line diff get rubber-stamped, because reviewing them line-by-line is
infeasible within a normal review budget — real defects hide in the reviewer's fatigue,
not because the reviewer didn't try.

### BAD — no size guidance; a single PR touches 40 files and three concerns

```markdown
<!-- PR #512: "Various fixes" -->
+1,438 −612 across 41 files.
Includes: a new export feature, an unrelated null-ref fix in the order pipeline,
and a dependency bump.
<!-- Reviewer approves after a skim; the null-ref fix's edge case is never actually verified. -->
```

### GOOD — documented size guidance, with a CI comment when exceeded

```yaml
# .github/workflows/pr-size-check.yml
name: PR size check
on: pull_request
jobs:
  size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const { additions, changed_files } = context.payload.pull_request;
            if (additions > 400 || changed_files > 20) {
              await github.rest.issues.createComment({
                ...context.repo, issue_number: context.issue.number,
                body: "This PR is large (>400 lines / >20 files). Consider splitting " +
                      "unrelated concerns (refactor vs feature vs fix) into separate PRs."
              });
            }
```

---

## Check C — No required-review/branch-protection rule (GWF-003)

### Detection

Check the default branch's protection settings for a required-reviewer rule and a block
on direct pushes. Without branch protection, "PR review is our process" is only a social
convention — anyone with push access can bypass it entirely, intentionally or by muscle
memory (`git push origin main` instead of pushing a branch), and no review ever happens
for that change.

### BAD — no branch protection configured; a direct push to main ships unreviewed

```bash
# No branch protection rule exists on `main`.
git push origin main
# Succeeds immediately — no PR, no review, no status checks required.
```

### GOOD — branch protection requires PR review and passing checks before merge

```yaml
# Configured via repo settings / API — required for the `main` branch:
# - Require a pull request before merging
# - Require at least 1 approving review
# - Require status checks to pass (validate.mjs, tests) before merging
# - Do not allow direct pushes, including from admins
```

---

## Check D — Long-lived feature branch with no rebase cadence (GWF-004)

### Detection

Check for feature branches that have diverged from `main` for an extended period (many
days/weeks of unmerged main commits ahead of the branch point) with no periodic
rebase/merge-from-main. The longer a branch goes without integrating upstream changes, the
more likely its eventual merge produces a painful, high-risk conflict resolution done
under time pressure right before shipping — often by whoever merges last, not by the
people who best understand each conflicting change.

### BAD — a feature branch three weeks old, never synced with main

```bash
git log --oneline main..feature/big-redesign | wc -l   # 47 commits on the branch
git log --oneline feature/big-redesign..main | wc -l   # 63 commits it never picked up
# Merge day: dozens of conflicting hunks across files neither author has looked at recently.
```

### GOOD — periodic rebase keeps the branch current and conflicts small and frequent

```markdown
<!-- CONTRIBUTING.md -->
For any feature branch open longer than 2 days: rebase onto (or merge from) `main` at
least once per day. Resolve small conflicts as they appear instead of one large conflict
at merge time. If a feature genuinely needs weeks, break it into smaller PRs behind a
feature flag rather than keeping one long-lived branch.
```

---

## Check E — No documented squash/merge/rebase policy (GWF-005)

### Detection

Check whether the repo has settled on one merge method (squash-merge, merge-commit, or
rebase-merge) for PRs into the default branch, applied consistently. Mixed strategies
across PRs produce an inconsistent commit graph — some PRs collapse into one commit, others
keep every intermediate "wip" commit, others rewrite history via rebase — which makes
`git bisect` unreliable (it may land on an intermediate, broken "wip" commit) and
`git blame` noisy (blame points at a squash commit instead of the meaningful original one).

### BAD — merge method left to whichever button the merger clicks that day

```
PR #201: merged via "Create a merge commit" — 14 "wip" commits now permanent in history
PR #202: merged via "Squash and merge" — one clean commit
PR #203: merged via "Rebase and merge" — original commits preserved, no merge commit
<!-- git bisect against this history unpredictably lands on broken intermediate commits. -->
```

### GOOD — one method chosen and enforced via repo settings

```markdown
<!-- CONTRIBUTING.md -->
## Merge policy
All PRs merge via **squash-merge**. The squashed commit message follows the
Conventional Commits format (see `always-conventional-commits`) and is edited to
summarize the PR as a whole, not concatenate every "wip"/"fix typo" commit.

Repo setting: only "Squash and merge" is enabled for this repository; "Create a merge
commit" and "Rebase and merge" are disabled in branch settings.
```
