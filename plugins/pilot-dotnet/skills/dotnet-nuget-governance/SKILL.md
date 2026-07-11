---
name: dotnet-nuget-governance
description: Reviews .NET package hygiene distinct from pilot-core's dependency-supply-chain policy. Flags no Central Package Management in multi-project solutions, inconsistent PackageReference versions, no packages.lock.json for deterministic restores, deprecated packages with no replacement plan, and multi-target incompatibilities. Outputs pilot-dotnet nuget-governance standard IDs.
when_to_use: Central Package Management, Directory.Packages.props, packages.lock.json, RestorePackagesWithLockFile, PackageReference version drift, dotnet list package deprecated, dotnet list package outdated, multi-targeting, TargetFrameworks, NuGet governance, transitive dependency drift, floating package version
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| NUG-001 | P1 | Central Package Management not adopted in a multi-project solution |
| NUG-002 | P1 | PackageReference versions duplicated/inconsistent across .csproj files |
| NUG-003 | P0 | No packages.lock.json, so CI and local restores can resolve different transitive versions |
| NUG-004 | P2 | Deprecated/unlisted NuGet package referenced with no tracked replacement plan |
| NUG-005 | P1 | Multi-targeted library references a package incompatible with one of its target frameworks |

---

## Check A — No Central Package Management in a multi-project solution (NUG-001)

### Detection

Look for a solution with more than one `.csproj` and no `Directory.Packages.props` at the
repository root with `ManagePackageVersionsCentrally` enabled. Without CPM, every project
declares its own package versions independently, so there is no single source of truth for
"what version of `Newtonsoft.Json` does this solution use" — two projects can silently drift
to different versions of the same package, and a security patch bump in one project doesn't
propagate to siblings.

### BAD — every project pins its own version independently

```xml
<!-- Api.csproj -->
<PackageReference Include="Newtonsoft.Json" Version="13.0.1" />

<!-- Worker.csproj -->
<PackageReference Include="Newtonsoft.Json" Version="13.0.3" /> <!-- silently different version -->
```

### GOOD — Directory.Packages.props centralizes every version

```xml
<!-- Directory.Packages.props at the solution root -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>
```

```xml
<!-- Api.csproj and Worker.csproj both just reference the package, no version -->
<PackageReference Include="Newtonsoft.Json" />
```

---

## Check B — PackageReference versions duplicated/inconsistent (NUG-002)

### Detection

Even with CPM adopted, check whether a project overrides the centrally-pinned version with
its own `Version` attribute (`VersionOverride` is the only sanctioned escape hatch, and it
should be rare and justified). Without CPM at all, grep every `.csproj` for the same package
name and diff the version strings — any project that only got bumped in isolation is silent
drift waiting to cause a "works on my machine" transitive conflict.

### BAD — one project still hardcodes a version despite CPM being set up elsewhere

```xml
<!-- Directory.Packages.props pins Serilog to 3.1.1 for the whole solution -->

<!-- but ReportingService.csproj overrides it inline, unnoticed in review -->
<PackageReference Include="Serilog" Version="2.12.0" />
```

### GOOD — every project defers to the central version, no ad-hoc overrides

```xml
<!-- ReportingService.csproj -->
<PackageReference Include="Serilog" />
<!-- Version comes solely from Directory.Packages.props; any exception requires an explicit,
     reviewed VersionOverride with a comment explaining why. -->
```

---

## Check C — No packages.lock.json (NUG-003)

### Detection

Check whether `<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>` is set and
whether a `packages.lock.json` is committed alongside each project. Without a lock file,
`dotnet restore` re-resolves the full transitive dependency graph against whatever the NuGet
feed currently serves — a developer restoring today can get a different transitive version
than CI restored yesterday (a new patch release of a deep transitive package), so "it built
in CI" and "it builds locally" silently diverge, and a build that was reproducible on Monday
may not be reproducible on Friday.

### BAD — no lock file, restore is non-deterministic across time and machines

```xml
<PropertyGroup>
  <TargetFramework>net9.0</TargetFramework>
  <!-- no RestorePackagesWithLockFile — dotnet restore re-resolves transitive graph every time -->
</PropertyGroup>
```

### GOOD — lock file pins the full resolved graph, committed to source control

```xml
<PropertyGroup>
  <TargetFramework>net9.0</TargetFramework>
  <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
</PropertyGroup>
```

```
# packages.lock.json is generated by `dotnet restore` and committed.
# CI runs `dotnet restore --locked-mode`, which fails the build instead of silently
# re-resolving if the lock file and the project's references have drifted apart.
```

---

## Check D — Deprecated/unlisted package with no replacement plan (NUG-004)

### Detection

Check whether `dotnet list package --deprecated` (and `--vulnerable`) is run anywhere in CI
or as a scheduled check. A package the NuGet gallery has marked deprecated or unlisted
(author-abandoned, superseded, or found to have a critical flaw) still resolves and restores
fine — nothing fails the build — so it can sit referenced indefinitely with no one tracking
that it needs to be swapped out, until the day it's pulled from the feed entirely or a CVE
lands with no upstream fix coming.

### BAD — a deprecated package referenced with no tracking, no CI check ever run

```xml
<!-- CommonServiceLocator was marked deprecated by its maintainers years ago;
     nothing in this repo's CI ever runs `dotnet list package --deprecated` to catch it -->
<PackageReference Include="CommonServiceLocator" Version="2.0.6" />
```

### GOOD — deprecation scan wired into CI with a tracked replacement

```yaml
# .github/workflows/nuget-governance.yml
- name: Check for deprecated and vulnerable packages
  run: |
    dotnet list package --deprecated --format json > deprecated.json
    dotnet list package --vulnerable --include-transitive --format json > vulnerable.json
    # A script fails the build if either report is non-empty for a package with
    # no corresponding tracked issue (see pilot-core dependency-supply-chain for the
    # solution-wide SLA/SBOM policy this feeds into).
```

```xml
<!-- Replacement already tracked and scheduled in issue #482 -->
<PackageReference Include="Microsoft.Extensions.DependencyInjection" Version="9.0.0" />
```

---

## Check E — Multi-targeted library with a per-TFM-incompatible package (NUG-005)

### Detection

For a library with `<TargetFrameworks>net8.0;net9.0</TargetFrameworks>` (or targeting both a
current and an older LTS), check whether every referenced package genuinely supports every
listed target framework, rather than only the highest one the developer tested against. A
package built against a newer BCL surface can restore and compile fine under a multi-target
build (the compile-time reference assembly resolves) yet throw `MissingMethodException` or
`TypeLoadException` at runtime on the older TFM, because the actual runtime assembly shipped
for that TFM doesn't contain the API — a failure mode invisible until deployed, since neither
`dotnet build` nor `dotnet test` (if tests only run on the newer TFM) catches it.

### BAD — package only actually supports net9.0, but the library multi-targets net8.0 too

```xml
<PropertyGroup>
  <TargetFrameworks>net8.0;net9.0</TargetFrameworks>
</PropertyGroup>

<ItemGroup>
  <!-- ships a net9.0 runtime asset with only a netstandard2.0 fallback that's missing
       the API this code actually calls; compiles fine, throws MissingMethodException
       at runtime only when loaded under net8.0 -->
  <PackageReference Include="Some.Net9OnlyFeature.Package" Version="2.0.0" />
</ItemGroup>
```

### GOOD — CI runs tests against every declared TFM so incompatibility fails the build, not production

```xml
<PropertyGroup>
  <TargetFrameworks>net8.0;net9.0</TargetFrameworks>
</PropertyGroup>
```

```yaml
# CI matrix runs the test suite against BOTH target frameworks, not just the newest,
# so a MissingMethodException on net8.0 surfaces as a failing build instead of a
# production incident:
strategy:
  matrix:
    tfm: [net8.0, net9.0]
steps:
  - run: dotnet test --framework ${{ matrix.tfm }}
```
