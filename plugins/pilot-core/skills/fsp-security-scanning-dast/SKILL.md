---
name: fsp-security-scanning-dast
description: Integrates ZAP (OWASP Zed Attack Proxy) baseline DAST scan into CI against a staging slot. Governs ZAP job setup in GitHub Actions, scan scope, alert thresholds, findings.json output for /fsp-audit, and suppression management. Cross-references ci-secret-scanning for the SAST complement.
when_to_use: DAST, dynamic application security testing, ZAP, OWASP ZAP, baseline scan, active scan, CI security scan, staging security test, automated security test, penetration test CI, alert threshold, ZAP rules, scan policy, security scan job
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| DAST-001 | P0 | No DAST job in any CI workflow for a public-facing application |
| DAST-002 | P0 | ZAP scan target is the production URL — staging slot must be used |
| DAST-003 | P1 | ZAP alert threshold set to `FAIL` only for `High` — `Medium` findings are ignored |
| DAST-004 | P1 | Scan scope includes authentication endpoints without an authenticated scan configured |
| DAST-005 | P2 | ZAP results not uploaded as workflow artifacts and not fed into `/fsp-audit` findings |
| DAST-006 | P2 | Suppression file (`zap-rules.tsv`) absent — all suppressed findings are invisible to audit |

Cross-reference: `ci-secret-scanning` (SAST complement).

---

## Check A — GitHub Actions job setup

Add to the deployment workflow **after** staging deploy, **before** production slot swap:

```yaml
# .github/workflows/deploy.yml
jobs:
  dast-scan:
    needs: deploy-staging
    runs-on: ubuntu-latest
    permissions:
      security-events: write   # for SARIF upload
    env:
      STAGING_URL: ${{ vars.STAGING_URL }}   # never the production URL
    steps:
      - name: ZAP Baseline Scan
        uses: zaproxy/action-baseline@v0.12.0   # pin to exact version
        with:
          target: ${{ env.STAGING_URL }}
          rules_file_name: .github/zap/zap-rules.tsv
          fail_action: true
          cmd_options: >
            -a
            -j
            -I
            -l WARN
            -z "-config replacer.full_list(0).description=auth
                -config replacer.full_list(0).enabled=true
                -config replacer.full_list(0).matchtype=REQ_HEADER
                -config replacer.full_list(0).matchstr=Authorization
                -config replacer.full_list(0).replacement=Bearer ${{ secrets.DAST_BEARER_TOKEN }}
                -config replacer.full_list(0).initiators="

      - name: Upload ZAP report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: zap-report
          path: report_html.html

      - name: Convert ZAP to findings.json
        if: always()
        run: node .github/zap/zap-to-findings.js   # see converter template below
```

**Never** point the scan at the production URL (DAST-002).

---

## Check B — Staging slot requirement

The scan must target a deployed staging slot or PR preview environment, not production.
The staging URL should be:
- Identical to production in code and config (apart from connection strings)
- Seeded with representative (anonymised) test data
- Protected from public traffic by IP allowlist or authentication (so ZAP is the only
  scanner reaching it)

Document the staging URL pattern in a `docs/staging.md` or in the workflow `vars`.

---

## Check C — Alert thresholds

```yaml
fail_action: true
cmd_options: "-l WARN"   # fail on WARN+ alerts (Medium and above)
```

Do NOT set the threshold to only fail on `High` alerts (DAST-003). Medium findings
include: missing CSP, clickjacking headers absent, cookies without HttpOnly/Secure.

For temporarily suppressed known-false-positives use the suppression file (Check E).

---

## Check D — Authenticated scan

Many routes are not reachable without authentication. An unauthenticated baseline
scan misses all protected endpoints.

Configure ZAP with a replacer rule to inject a bearer token (above), OR use a
context file with form-based login configuration. The `DAST_BEARER_TOKEN` secret
must be a dedicated test-user token, never a production admin token.

DAST-004 fires when the application's OpenAPI spec shows `securitySchemes: bearerAuth`
but no auth configuration appears in the ZAP `cmd_options`.

---

## Check E — Suppression management

```tsv
# .github/zap/zap-rules.tsv
# Format: rule_id<TAB>action<TAB>parameter<TAB>evidence<TAB>url<NEWLINE>
10038	IGNORE	Content-Security-Policy	""	https://staging.example.com/api/swagger
```

Rules:
- Every suppressed alert needs a comment above it in the file: `# reason: <why>`
- Suppressions are reviewed at each new major ZAP version bump
- Do not suppress `High` alerts without a linked ADR that documents the accepted risk

DAST-006 fires when no suppression file exists and ZAP rules file is not configured —
the scan has no baseline to compare against and every known false-positive will fail CI.

---

## Check F — findings.json bridge

Convert ZAP's XML/JSON report to the pilot findings schema so `/fsp-audit` can surface DAST results:

```js
// .github/zap/zap-to-findings.js (template — run as a post-scan step)
const fs = require('fs');
const report = JSON.parse(fs.readFileSync('report_json.json', 'utf8'));
const findings = [];
for (const site of report.site || []) {
  for (const alert of site.alerts || []) {
    const sev = alert.riskcode >= 3 ? 'P0' : alert.riskcode >= 2 ? 'P1' : 'P2';
    findings.push({
      id: `DAST-${alert.pluginid}`,
      severity: sev,
      title: alert.name,
      file: alert.instances?.[0]?.uri || 'cross-cutting',
      standard: `DAST-${alert.riskcode >= 3 ? '001' : '003'}`,
      status: 'OPEN',
      agent: 'fsp-security-scanning-dast'
    });
  }
}
const existing = fs.existsSync('.claude/pilot/audit/findings.json')
  ? JSON.parse(fs.readFileSync('.claude/pilot/audit/findings.json', 'utf8'))
  : [];
const merged = [...existing.filter(f => !f.agent?.includes('dast')), ...findings];
fs.mkdirSync('.claude/pilot/audit', { recursive: true });
fs.writeFileSync('.claude/pilot/audit/findings.json', JSON.stringify(merged, null, 2));
```
