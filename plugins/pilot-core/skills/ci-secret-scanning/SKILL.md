---
name: ci-secret-scanning
description: Reviews CI-level secret scanning (gitleaks/trufflehog/GitHub Advanced Security) — the safety net beyond the local secret-guard.js hook, which never sees direct pushes or forked PRs. Flags no CI secret-scanning step, diff-only instead of full-history scans, no leak-to-rotation runbook, findings that don't fail the build, and no false-positive allowlist. Outputs pilot-core ci-secret-scanning standard IDs.
when_to_use: secret scanning, gitleaks, trufflehog, GitHub Advanced Security, secret detection, leaked credential, hardcoded API key, committed secret, git history scan, push protection, secret rotation, credential rotation runbook, scanner false positive, secret allowlist, baseline file
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| SCN-001 | P0 | No secret-scanning step anywhere in the CI pipeline |
| SCN-002 | P1 | Scanner configured to scan only the current commit/diff, not full git history |
| SCN-003 | P0 | Confirmed secret-leak finding has no automatic rotation runbook triggered |
| SCN-004 | P1 | Scanner findings are informational-only and don't fail the build/block merge |
| SCN-005 | P2 | No baseline/allowlist mechanism for known false positives |

This repo's own `secret-guard.js` PreToolUse hook (`plugins/pilot-core/hooks/hooks.json`)
is a *local* safety net: it inspects content right before Claude writes it, in Claude's own
session. It has no visibility into a human running `git push` directly, a merge commit
composed of multiple authors' changes, or a PR opened from an external contributor's fork —
none of that content ever passes through Claude's write path. This skill is the CI-level
layer that catches exactly those cases; it is a distinct defense, not a duplicate of the hook.

---

## Check A — No secret-scanning step in CI (SCN-001)

### Detection

Check the CI pipeline for any dedicated secret-scanning step (gitleaks, trufflehog, or
GitHub Advanced Security's native secret scanning). If the only defense present anywhere
is `secret-guard.js`, remember that hook is scoped to Claude's own writes — a teammate
pushing a branch directly, a merge commit, or an external PR from a fork all bypass it
completely, with nothing in CI to catch a real leaked credential before it lands on `main`.

### BAD — no scanning step; secret-guard.js is treated as sufficient coverage

```yaml
# .github/workflows/ci.yml
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
      # No secret scan. secret-guard.js only ever saw Claude's own writes in-session —
      # a direct push or an external fork's PR was never inspected by anything.
```

### GOOD — a dedicated CI secret-scanning step covering every push and PR

```yaml
# .github/workflows/secret-scan.yml
name: Secret scan
on: [push, pull_request]
jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Check B — Scanner scoped to diff only, not full history (SCN-002)

### Detection

Check whether the scanner is configured to scan the full git history at least once
(and on a recurring schedule) rather than only the incoming commit/diff on each PR. A
secret committed once, then "removed" in a later commit that simply deletes the line,
still exists forever in every earlier commit object — anyone who clones the repo and runs
`git log -p` can recover it. A diff-only scanner never re-examines that history and will
report the repo as clean forever.

### BAD — scanner only ever runs against the current PR diff

```yaml
- uses: gitleaks/gitleaks-action@v2
  with:
    # Shallow checkout — only the diff is visible, full history never scanned.
```

```bash
git checkout HEAD~3   # secrets.json accidentally committed here, "removed" one commit later
grep AKIA -r .         # the AWS key is still recoverable from this older commit
```

### GOOD — a full-history scan runs at least once and on a schedule, in addition to per-PR diff scans

```yaml
# .github/workflows/secret-scan-full-history.yml
name: Full history secret scan
on:
  schedule:
    - cron: "0 6 * * 1"   # weekly
  workflow_dispatch: {}
jobs:
  gitleaks-history:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # full history, not a shallow clone
      - run: gitleaks detect --source . --log-opts="--all"
```

---

## Check C — Confirmed leak has no rotation runbook (SCN-003)

### Detection

Check that a confirmed secret-scanning finding (not a false positive) automatically
triggers a documented rotation procedure — ties into `incident-response-runbook`'s
severity-to-response-time SLA (IR-002) and runbook-linking pattern (IR-001). Detecting a
leaked credential accomplishes nothing on its own: the credential is still valid and
usable by anyone who saw it (including in CI logs, PR history, or a fork) until it is
actually rotated. A finding that just sits in a security-tab alert with no forcing
function is functionally the same as not scanning at all.

### BAD — finding is filed, no one is required to actually rotate anything

```markdown
<!-- GitHub security alert: "Azure Storage connection string detected in commit abc123" -->
Status: Open
<!-- No linked runbook, no owner, no rotation deadline. Three weeks later, still open,
     and the connection string is still valid. -->
```

### GOOD — a confirmed finding triggers a runbook with a rotation SLA

```markdown
<!-- runbooks/secret-leak-response.md -->
## Confirmed secret leak

1. Treat the credential as compromised immediately — do not wait for "just in case."
2. Rotate the credential at its source (Key Vault, Azure Portal, provider dashboard)
   within the SEV1 mitigation window defined in `incident-response-runbook` (IR-002).
3. Revoke/replace the old credential everywhere it's referenced (App Settings,
   local .env templates, CI secrets).
4. Purge the secret from git history (BFG Repo-Cleaner / `git filter-repo`) — this is
   cleanup, not the fix; rotation in step 2 is what actually neutralizes the leak.
5. File a postmortem per `incident-response-runbook` IR-003 if the secret had
   production scope.
```

---

## Check D — Findings don't fail the build (SCN-004)

### Detection

Check whether a secret-scanning finding fails the CI job / blocks PR merge, versus being
reported informationally in a dashboard or annotation while the pipeline continues green.
An informational-only finding gets routinely ignored — over time, the team stops checking
the security tab, and a real leak ships in a merged PR indistinguishable from the noise.

### BAD — scan runs but never affects the pipeline's pass/fail result

```yaml
- name: Secret scan
  run: gitleaks detect --source . || true
  # Exit code is swallowed; the job — and the PR merge gate — is green regardless of findings.
```

### GOOD — a confirmed finding fails the job and blocks merge

```yaml
- name: Secret scan
  run: gitleaks detect --source . --exit-code 1
  # Non-zero exit fails this required status check; branch protection (see
  # git-workflow-governance GWF-003) blocks merge until it's resolved or allowlisted.
```

---

## Check E — No allowlist for known false positives (SCN-005)

### Detection

Check for a baseline/allowlist file covering intentional non-secrets that otherwise match
scanner patterns (test fixtures, example config values, documentation placeholders). Without
one, every scan run reports the same known false positives alongside any genuinely new
finding, and the team learns to skim past red output — real findings blend into the noise
and get dismissed along with the expected ones.

### BAD — the same three false positives fail every single scan run, forever

```
tests/fixtures/vulnerable-app/AUDIT-SPEC.md:42: potential secret detected (AKIAEXAMPLE...)
<!-- This is a documented example key in a test fixture, flagged on every run since day one.
     Reviewers now reflexively re-run the job without reading the output. -->
```

### GOOD — a maintained baseline suppresses known, reviewed false positives explicitly

```toml
# .gitleaks.toml
[allowlist]
description = "Known false positives, reviewed and re-confirmed quarterly"
paths = [
  '''tests/fixtures/vulnerable-app/AUDIT-SPEC.md''',  # intentional example key for a test fixture
]
regexes = [
  '''AKIAIOSFODNN7EXAMPLE''',  # AWS's own public documentation example key
]
```

```markdown
<!-- docs/SECRET-SCANNING.md -->
Allowlist entries must include a comment explaining *why* it's a false positive and are
reviewed quarterly — an unreviewed, growing allowlist is itself a red flag.
```
