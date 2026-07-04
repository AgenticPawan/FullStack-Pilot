---
name: dependency-license-compliance
description: Reviews open-source license risk — a legal-compliance concern distinct from dependency-supply-chain's vulnerability/version-pinning focus. Flags no license scanning in the dependency pipeline, a copyleft (GPL/AGPL) dependency pulled into proprietary code with no legal review, no documented license allow-list/deny-list policy, and license metadata missing from the SBOM already generated for release artifacts. Outputs findings with pilot-core license-compliance standard IDs.
when_to_use: open source license, GPL, AGPL, copyleft, license scanning, license allow-list, SPDX, dependency license audit, license compliance, proprietary code contamination
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| LIC-001 | P1 | No license scanning in the dependency pipeline |
| LIC-002 | P0 | Copyleft (GPL/AGPL) dependency in proprietary code with no legal review |
| LIC-003 | P1 | No documented license allow-list/deny-list policy |
| LIC-004 | P2 | License metadata missing from the SBOM |

This is the legal-compliance sibling to `dependency-supply-chain`'s security-vulnerability
scanning — a dependency can be perfectly secure and still create real legal exposure if
its license terms conflict with how the code is distributed.

---

## Check A — No license scanning in the pipeline (LIC-001)

### Detection

Check whether CI runs a license scanner (`dotnet-project-licenses`, `license-checker` for
npm, or a commercial SCA tool's license module) against the dependency tree. Without one,
nobody actually knows what licenses are in the transitive dependency graph until someone
manually audits it — which in practice means never, until a legal question forces it.

### BAD — no license scanning anywhere in CI

```yaml
# .github/workflows/ci.yml
- run: dotnet restore
- run: dotnet build
- run: dotnet test
# No license scan step — the transitive dependency tree's license mix is unknown.
```

### GOOD — license scan as a CI step, findings routed the same way as vulnerability findings

```yaml
- run: dotnet tool install --global dotnet-project-licenses
- run: dotnet-project-licenses -i ./MyApp.sln --json -o licenses-report.json
- run: npx license-checker --json --out licenses-report-npm.json
# Both reports feed into the same audit-orchestration findings.json pipeline.
```

---

## Check B — Copyleft dependency with no legal review (LIC-002)

### Detection

Check the license scan output for GPL/AGPL/LGPL (or other copyleft) licenses on a
dependency linked into proprietary, closed-source code with no documented legal review
of that specific usage. GPL's copyleft terms can require derivative works to also be
open-sourced under the same license — pulling a GPL library into a proprietary product
without legal sign-off is a real, not hypothetical, exposure.

### BAD — a GPL-licensed library used with no review

```xml
<PackageReference Include="Some.Gpl.Licensed.Library" Version="2.1.0" />
<!-- No note anywhere that legal reviewed and approved this specific usage. -->
```

### GOOD — either avoided, or explicitly reviewed and documented

```markdown
<!-- docs/LICENSE-EXCEPTIONS.md -->
`Some.Gpl.Licensed.Library` (GPLv3): reviewed by legal 2026-03-01. Used only in an
internal tooling script never distributed to customers — GPL's copyleft terms trigger
on distribution, not internal use, per counsel's guidance. Re-review required if this
tool is ever packaged for external distribution.
```

---

## Check C — No documented license allow-list/deny-list (LIC-003)

### Detection

Check for a documented policy stating which license families are pre-approved (MIT,
Apache 2.0, BSD — the common permissive licenses) versus which require review (any
copyleft license) versus which are outright disallowed. Without one, every new
dependency's license is a one-off judgment call by whichever engineer happens to add it.

### BAD — no policy, license acceptability decided ad-hoc per dependency

```
<!-- No documented stance — whether a new dependency's license is "fine" is whatever
     the engineer adding it assumes, with no consistent bar applied. -->
```

### GOOD — an explicit policy the license scanner (Check A) is configured against

```markdown
<!-- docs/LICENSE-POLICY.md -->
**Pre-approved (no review needed):** MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0
**Requires legal review before use:** LGPL-*, MPL-2.0
**Disallowed without an explicit, documented exception (see LICENSE-EXCEPTIONS.md):** GPL-*, AGPL-*
```

```yaml
# CI enforces the policy directly — license scanner fails the build on a disallowed license
- run: dotnet-project-licenses -i ./MyApp.sln --allowed-license-types allowed-licenses.json --fail-on-missing
```

---

## Check D — License metadata missing from the SBOM (LIC-004)

### Detection

Check whether the SBOM `dependency-supply-chain` DSC-004 already requires includes
license information per component, not just name/version. A CVE disclosure needs the
version inventory; a license audit (triggered by an acquisition, a customer's legal
team, or a new distribution channel) needs the license inventory — the same SBOM
generation step can capture both if configured to.

### BAD — SBOM has versions but no license field populated

```xml
<!-- bom.xml component entries have name/version but licenses left empty —
     answering "what licenses do we ship" still requires a separate manual audit. -->
```

### GOOD — SBOM generation configured to include license metadata

```yaml
- run: dotnet CycloneDX ./MyApp.sln -o ./sbom --json
# CycloneDX's component schema includes a licenses field when license metadata is
# available from the package registry — verify it's populated, not left as null.
```
