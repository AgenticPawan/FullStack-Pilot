---
name: dependency-supply-chain
description: Defines the triage and patch-cadence policy layered over audit-orchestration's raw dotnet/npm vulnerability scanner output. Flags no severity-to-patch-cadence SLA, direct dependencies pinned to a floating/wildcard version range, no private-feed/allow-list policy for third-party packages, and no SBOM generated for release artifacts. Outputs findings with pilot-core dependency-supply-chain standard IDs.
when_to_use: dependency vulnerability, npm audit, dotnet list package vulnerable, SBOM, software bill of materials, patch cadence, version pinning, floating version, private NuGet feed, private npm registry, Dependabot, transitive dependency, supply chain security
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| DSC-001 | P0 | No documented severity-to-patch-cadence SLA for vulnerable dependencies |
| DSC-002 | P1 | Direct dependency pinned to a floating/wildcard version range |
| DSC-003 | P1 | No private-feed/allow-list policy for third-party packages |
| DSC-004 | P2 | No SBOM generated for release artifacts |

This skill defines the *policy* layer that `audit-orchestration`'s scanner output
(`dotnet list package --vulnerable`, `npm audit`) feeds into — the scanners detect a
vulnerable package exists; this skill governs what happens next.

---

## Check A — No severity-to-cadence SLA (DSC-001)

### Detection

Check for a documented policy stating how quickly a vulnerable dependency must be patched
once `audit-orchestration` reports it, keyed to the same CVSS-derived severity tiers
(`audit-orchestration`'s P0–P3). Without a stated SLA, a critical dependency finding sits
in a backlog indefinitely with no forcing function — this is how a known, publicly
disclosed CVE stays unpatched in production for months.

### BAD — findings.json accumulates vulnerable-dependency entries with no response clock

```markdown
<!-- No SLA anywhere. VULN-014 (a P0 finding from npm audit) has been open for 87 days. -->
```

### GOOD — an explicit SLA tied to the existing severity scale

```markdown
<!-- docs/DEPENDENCY-POLICY.md -->
| Severity (from audit-orchestration) | Patch SLA |
|---|---|
| P0 (CVSS ≥ 9.0) | Patch or mitigate within 24 hours of detection |
| P1 (CVSS 7.0–8.9) | Patch within 7 days |
| P2 (CVSS 4.0–6.9) | Patch in the next sprint |
| P3 (CVSS < 4.0) | Batched into routine dependency-update PRs |

A P0/P1 finding with no available patched version yet gets a documented mitigation
(WAF rule, feature-flag kill switch — see `dotnet-feature-flags`) instead of silence.
```

---

## Check B — Direct dependency pinned to a floating version range (DSC-002)

### Detection

Grep `.csproj`/`package.json` for direct (not transitive) dependencies using a floating
range (`Version="8.*"`, NuGet's floating `8.0.*`, npm's `^`/`~` ranges on a security-
sensitive package) instead of an exact pinned version. A floating range means a `dotnet
restore`/`npm install` run on two different days can silently pull two different
versions — including a compromised version published to the registry between those runs
(the exact supply-chain attack pattern behind incidents like `event-stream`/`ua-parser-js`).

### BAD — floating version range on a direct dependency

```json
{
  "dependencies": { "some-critical-lib": "^3.1.0" }
}
```

```xml
<PackageReference Include="Some.Critical.Package" Version="3.*" />
```

### GOOD — exact pinned version, bumped deliberately via a reviewed PR

```json
{
  "dependencies": { "some-critical-lib": "3.1.4" }
}
```

```xml
<PackageReference Include="Some.Critical.Package" Version="3.1.4" />
```

A lockfile (`package-lock.json`, `packages.lock.json` with
`<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>`) is committed so
transitive dependency versions are also reproducible, not just direct ones.

---

## Check C — No private-feed/allow-list policy (DSC-003)

### Detection

Check whether package restore is configured to pull exclusively from a trusted source
(a private NuGet feed / npm registry with an internal allow-list and typosquat
protection) or falls back to the public registry with no gate — a classic dependency-
confusion attack publishes a malicious package under an internal-sounding name to the
public feed, and an unscoped restore config resolves to the attacker's package instead
of the internal one.

### BAD — no scoping, public feed resolves anything by name

```xml
<!-- nuget.config -->
<packageSources>
  <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  <!-- No internal feed prioritized; a package named "Acme.Internal.Auth" published
       publicly by an attacker would resolve here if it doesn't exist internally yet. -->
</packageSources>
```

### GOOD — internal feed prioritized, public feed scoped or disabled for internal-name prefixes

```xml
<!-- nuget.config -->
<packageSources>
  <clear />
  <add key="internal-feed" value="https://pkgs.dev.azure.com/acme/_packaging/internal/nuget/v3/index.json" />
  <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
</packageSources>
<packageSourceMapping>
  <packageSource key="internal-feed">
    <package pattern="Acme.*" />
  </packageSource>
  <packageSource key="nuget.org">
    <package pattern="*" />
  </packageSource>
</packageSourceMapping>
```

---

## Check D — No SBOM generated for release artifacts (DSC-004)

### Detection

Check the CI/CD release pipeline for a Software Bill of Materials generation step
(`dotnet CycloneDX`, `syft`, GitHub's native dependency-graph SBOM export). Without one,
answering "are we affected by this newly disclosed CVE" requires manually cross-checking
every service's dependency tree instead of querying a generated artifact inventory.

### BAD — no SBOM step in the release workflow

```yaml
# .github/workflows/release.yml
- run: dotnet publish -c Release
- run: docker build -t myapp:${{ github.sha }} .
# No SBOM generated — a new CVE disclosure means manually auditing every service.
```

### GOOD — SBOM generated and attached to the release artifact

```yaml
- run: dotnet tool install --global CycloneDX
- run: dotnet CycloneDX ./MyApp.sln -o ./sbom
- uses: actions/upload-artifact@v4
  with:
    name: sbom
    path: ./sbom/bom.xml
```
