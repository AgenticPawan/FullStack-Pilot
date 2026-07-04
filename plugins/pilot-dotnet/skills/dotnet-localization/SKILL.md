---
name: dotnet-localization
description: Reviews ASP.NET Core localization architecture. Flags a resx/XML-only translation layer with no DB-override, an IStringLocalizer implementation that doesn't fall back to XML defaults when no DB row exists, a DB localization table missing a unique (Key, Culture) constraint or caching, ad-hoc per-controller culture resolution instead of RequestLocalizationOptions, and missing-key values silently rendering blank. Outputs findings with pilot-dotnet localization standard IDs.
when_to_use: localization, IStringLocalizer, RequestLocalizationOptions, resx, XML localization, culture fallback, DB override translation, Accept-Language, missing translation key, i18n, resource file, culture resolution
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| LOC-001 | P1 | Only XML/resx strings used — no DB-override layer for runtime translation edits |
| LOC-002 | P1 | Custom `IStringLocalizer` doesn't fall back to XML defaults when no DB row exists |
| LOC-003 | P2 | DB localization table missing a unique `(Key, Culture)` constraint or caching |
| LOC-004 | P2 | Culture resolution done ad-hoc per controller instead of `RequestLocalizationOptions` |
| LOC-005 | P3 | Missing key in both DB and XML renders blank instead of a documented fallback (advisory) |

---

## Check A — No DB-override layer over XML defaults (LOC-001)

### Detection

1. Check whether translated strings come only from `.resx`/XML resource files with no DB-backed override table.
2. Flag this when the team has expressed a need to patch a mistranslation or add a locale-specific override without a redeploy — XML files should hold the *default* values (deployed with the app, safe fallback, reviewable in source control), and a DB table should hold *overrides* that take precedence when present.

### BAD — resx only, no override path

```csharp
public class OrderMessages
{
    // Only source: Resources/OrderMessages.resx / OrderMessages.fr.resx
    // Changing a single mistranslated string requires a full redeploy.
}
```

### GOOD — XML defaults + DB override table

```xml
<!-- Resources/OrderMessages.xml (default values, shipped with the app) -->
<resources culture="en">
  <entry key="Order.Confirmed">Your order has been confirmed.</entry>
</resources>
```

```sql
-- LocalizationOverrides(Key, Culture, Value) — empty until an admin overrides a string
```

---

## Check B — IStringLocalizer doesn't fall back to XML (LOC-002)

### Detection

Read the custom `IStringLocalizer` implementation. Confirm it queries the DB override table first, and when no row exists for `(key, culture)`, falls back to the XML-loaded default rather than returning an empty string or throwing.

### BAD — DB miss returns empty string, XML default never consulted

```csharp
public LocalizedString this[string name]
{
    get
    {
        var value = _dbOverrides.GetValueOrDefault($"{name}:{_culture}");
        return new LocalizedString(name, value ?? string.Empty, resourceNotFound: value is null);
        // XML default is loaded but never referenced here.
    }
}
```

### GOOD — DB override, then XML default, in that order

```csharp
public LocalizedString this[string name]
{
    get
    {
        if (_dbOverrides.TryGetValue((name, _culture), out var overridden))
            return new LocalizedString(name, overridden, resourceNotFound: false);

        if (_xmlDefaults.TryGetValue((name, _culture), out var fallback))
            return new LocalizedString(name, fallback, resourceNotFound: false);

        return new LocalizedString(name, name, resourceNotFound: true); // see Check E for the "notFound" contract
    }
}
```

---

## Check C — DB localization table missing constraint/caching (LOC-003)

### Detection

1. Check the `LocalizationOverrides` (or equivalent) EF configuration for a unique index on `(Key, Culture)` — without it, duplicate rows can silently shadow each other depending on query order.
2. Check whether lookups are cached (`IMemoryCache`, loaded once per culture at startup with invalidation on admin edit) versus querying the DB on every localized-string access.

### BAD — no unique constraint, queried per lookup

```csharp
modelBuilder.Entity<LocalizationOverride>(e =>
{
    e.HasKey(x => x.Id);
    // No unique index on (Key, Culture) — duplicates possible, and every This[name] call queries the DB.
});
```

### GOOD — unique constraint + cached load

```csharp
modelBuilder.Entity<LocalizationOverride>(e =>
{
    e.HasKey(x => x.Id);
    e.HasIndex(x => new { x.Key, x.Culture }).IsUnique();
});

// Loaded into an IMemoryCache entry per culture at startup, invalidated when the admin
// endpoint (see dotnet-dynamic-configuration CFG-005 pattern) saves a change.
```

---

## Check D — Culture resolution ad-hoc per controller (LOC-004)

### Detection

Grep controllers for manual `CultureInfo.CurrentCulture = ...` assignment or reading `Accept-Language` directly, instead of a single `RequestLocalizationOptions` pipeline (`app.UseRequestLocalization(...)`) with a consistent provider order (query string override → user preference cookie → `Accept-Language` header → default).

### BAD — each controller resolves culture independently

```csharp
[HttpGet]
public IActionResult Get()
{
    var lang = Request.Headers["Accept-Language"].FirstOrDefault() ?? "en";
    CultureInfo.CurrentUICulture = new CultureInfo(lang); // duplicated per controller, inconsistent
}
```

### GOOD — centralized RequestLocalizationOptions pipeline

```csharp
builder.Services.Configure<RequestLocalizationOptions>(options =>
{
    var supported = new[] { "en", "fr", "de" };
    options.SetDefaultCulture("en")
        .AddSupportedCultures(supported)
        .AddSupportedUICultures(supported);
    options.RequestCultureProviders = new IRequestCultureProvider[]
    {
        new QueryStringRequestCultureProvider(),
        new CookieRequestCultureProvider(),
        new AcceptLanguageHeaderRequestCultureProvider(),
    };
});

app.UseRequestLocalization();
```

---

## Check E — Missing key renders blank with no documented fallback (LOC-005, advisory)

### Detection

Confirm the contract for a key missing from *both* the DB override and the XML defaults: it should fall back to a neutral culture (e.g., `en`) or render the key name itself for visibility during development/QA, rather than silently rendering an empty string that looks like a broken UI to an end user.
