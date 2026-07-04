---
name: dotnet-shared-libraries
description: Reviews internal shared/common class libraries (e.g. Company.Shared) for structure and string-extension conventions — flags ad-hoc string extensions scattered outside a central StringExtensions class, missing null-guards on extension "this" parameters, god-utility libraries mixing unrelated concerns, informal versioning via copy-paste or cross-solution ProjectReference instead of a versioned NuGet package, and duplicated utility logic reimplemented per-project. Outputs findings with pilot-dotnet shared-libraries standard IDs.
when_to_use: shared library, common library, StringExtensions, extension method, null guard, god utility, NuGet package, semantic versioning, ProjectReference, slug generation, truncate ellipsis, mask email, mask phone
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| SL-001 | P2 | String extension methods added ad-hoc instead of centralized in StringExtensions |
| SL-002 | P1 | Extension method doesn't null-guard its "this" parameter |
| SL-003 | P2 | Shared library growing into a god-utility mixing unrelated concerns |
| SL-004 | P2 | Shared library versioned informally instead of published as a semver NuGet package |
| SL-005 | P3 | Duplicated utility logic reimplemented per-project instead of reused |

---

## Check A — Centralized StringExtensions

### Detection

1. Grep the solution for `static class` definitions containing string extension methods (`this string ...`) outside of a single, designated `StringExtensions` class in the shared library.
2. If string extension methods are found scattered across unrelated classes (e.g., inside a controller or a random helper class) → SL-001.

### BAD — string extensions scattered ad-hoc

```csharp
// Defined inside OrderController.cs — unrelated to controller responsibility
public static class OrderControllerHelpers
{
    public static string ToTitleCase(this string value) =>
        CultureInfo.CurrentCulture.TextInfo.ToTitleCase(value.ToLower());
}

// Defined inside a completely different file, InvoiceService.cs
public static class InvoiceStringHelpers
{
    public static string Truncate(this string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength] + "...";
}
```

### GOOD — centralized in the shared library

```csharp
// Company.Shared/Extensions/StringExtensions.cs
namespace Company.Shared.Extensions;

public static class StringExtensions
{
    public static string ToTitleCase(this string value) =>
        string.IsNullOrWhiteSpace(value)
            ? value
            : CultureInfo.CurrentCulture.TextInfo.ToTitleCase(value.ToLowerInvariant());

    public static string Truncate(this string value, int maxLength) =>
        string.IsNullOrEmpty(value) || value.Length <= maxLength
            ? value
            : value[..maxLength] + "...";
}
```

---

## Check B — Null-guarding the "this" parameter

### Detection

1. Inspect each string extension method for a null/empty check on its `this string` parameter before dereferencing it (`.Length`, `.ToLower()`, indexing, etc.).
2. If calling the method on a null string throws `NullReferenceException` instead of returning a defined, documented result → SL-002.

### BAD — no null guard, throws on null input

```csharp
public static class StringExtensions
{
    public static string ToTitleCase(this string value) =>
        CultureInfo.CurrentCulture.TextInfo.ToTitleCase(value.ToLower());
        // value.ToLower() throws NullReferenceException when value is null
}

// Call site:
string? name = null;
var titled = name.ToTitleCase(); // boom
```

### GOOD — null-guarded with a defined behavior and nullable annotations

```csharp
public static class StringExtensions
{
    /// <summary>Returns title case, or the original value if null/whitespace.</summary>
    public static string? ToTitleCase(this string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        return CultureInfo.CurrentCulture.TextInfo.ToTitleCase(value.ToLowerInvariant());
    }
}

// Call site is now safe and the nullable annotation makes intent explicit at compile time.
string? name = null;
string? titled = name.ToTitleCase(); // returns null, no exception
```

---

## Check C — God-utility library (advisory)

### Detection

1. Inspect the shared library's namespace/folder structure. If a single project or namespace mixes string extensions, date helpers, HTTP client wrappers, and business/domain logic with no separation → SL-003.
2. Recommend splitting into focused packages/namespaces (e.g., `Company.Shared.Extensions`, `Company.Shared.Http`, `Company.Shared.Time`) rather than one monolithic `Company.Utilities` project.

### BAD — one project, unrelated concerns mixed together

```
Company.Shared/
  StringExtensions.cs
  DateHelpers.cs
  HttpClientFactory.cs
  OrderPricingCalculator.cs   // business logic has no place in a generic shared utility lib
  EmailTemplateRenderer.cs
```

### GOOD — separated, focused namespaces/packages

```
Company.Shared.Extensions/
  StringExtensions.cs
  DateTimeExtensions.cs

Company.Shared.Http/
  ResilientHttpClientFactory.cs

Company.Shared.Time/
  DateHelpers.cs

// Business logic (OrderPricingCalculator, EmailTemplateRenderer) lives in its own
// domain-specific project, not the generic shared library.
```

---

## Check D — Informal versioning

### Detection

1. Check whether the shared library is referenced across unrelated solutions via a raw `<ProjectReference>` (requiring the consuming repo to have the shared source checked out) or via copy-pasted files, rather than a versioned package reference.
2. If no `.nuspec`/`<PackageId>`/`<Version>` metadata exists and no internal feed (Azure Artifacts, GitHub Packages) is configured → SL-004.

### BAD — cross-solution ProjectReference, no versioning

```xml
<!-- In an unrelated solution's .csproj, reaching across repos via relative path -->
<ItemGroup>
  <ProjectReference Include="..\..\..\CompanySharedRepo\Company.Shared\Company.Shared.csproj" />
</ItemGroup>
```

### GOOD — published as a versioned internal NuGet package

```xml
<!-- Company.Shared.csproj -->
<PropertyGroup>
  <PackageId>Company.Shared</PackageId>
  <Version>2.3.1</Version>
  <Authors>Platform Team</Authors>
  <GeneratePackageOnBuild>true</GeneratePackageOnBuild>
</PropertyGroup>
```

```xml
<!-- Consuming project's .csproj — references the published package -->
<ItemGroup>
  <PackageReference Include="Company.Shared" Version="2.3.1" />
</ItemGroup>
```

```yaml
# .github/workflows/publish-shared.yml — publish on tag push, semver-driven
- name: Pack and push
  run: |
    dotnet pack Company.Shared/Company.Shared.csproj -c Release -o ./nupkg
    dotnet nuget push ./nupkg/*.nupkg --source "CompanyFeed" --api-key ${{ secrets.NUGET_API_KEY }}
```

---

## Check E — Duplicated utility logic across projects

### Detection

1. Search multiple project repositories/solutions for near-identical implementations of common utilities: slug generation, truncate-with-ellipsis, masking a value (email/phone) for display.
2. If the same logic exists independently in 2+ projects instead of being pulled from the shared extensions library → SL-005.

### BAD — reimplemented per-project

```csharp
// Project A
public static string MaskEmail(string email)
{
    var atIndex = email.IndexOf('@');
    if (atIndex <= 1) return email;
    return email[0] + new string('*', atIndex - 1) + email[atIndex..];
}

// Project B — same logic reimplemented independently, subtly different edge-case handling
public static string HideEmail(string address)
{
    var parts = address.Split('@');
    return parts[0].Substring(0, 1) + "***@" + parts[1];
}
```

### GOOD — single implementation reused from the shared library

```csharp
// Company.Shared/Extensions/StringExtensions.cs
namespace Company.Shared.Extensions;

public static class StringExtensions
{
    public static string MaskEmail(this string? email)
    {
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@'))
        {
            return email ?? string.Empty;
        }

        var atIndex = email.IndexOf('@');
        if (atIndex <= 1)
        {
            return email;
        }

        return $"{email[0]}{new string('*', atIndex - 1)}{email[atIndex..]}";
    }

    public static string ToSlug(this string value) =>
        string.IsNullOrWhiteSpace(value)
            ? string.Empty
            : Regex.Replace(value.ToLowerInvariant().Trim(), @"[^a-z0-9]+", "-").Trim('-');
}

// Every project references Company.Shared and calls email.MaskEmail() / title.ToSlug()
// instead of reimplementing the logic locally.
```
