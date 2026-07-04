---
name: angular-i18n
description: Reviews Angular internationalization architecture — the frontend counterpart to dotnet-localization's XML-default-plus-DB-override model. Flags hardcoded UI strings with no i18n library wired, translation keys that don't share a common key space with the .NET DB-override table, locale-unaware date/number/currency formatting, missing RTL layout support, and locale switches that require a full page reload. Outputs findings with pilot-angular i18n standard IDs.
when_to_use: i18n, internationalization, localization Angular, angular localize, translation key, locale switching, RTL, right to left, DatePipe locale, CurrencyPipe locale, transloco, ngx-translate, dir attribute
applies_to: angular>=17
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| I18N-001 | P1 | Hardcoded UI strings with no i18n library wired |
| I18N-002 | P1 | Translation keys don't share a key space with the .NET DB-override table |
| I18N-003 | P2 | Dates/numbers/currency formatted with hardcoded locale instead of locale-aware |
| I18N-004 | P2 | No RTL layout support despite supporting a locale that requires it |
| I18N-005 | P3 | Locale switch requires a full page reload (advisory) |

---

## Check A — Hardcoded strings, no i18n library wired (I18N-001)

### Detection

Grep templates for literal English text in labels/buttons/messages with no
`| translate` pipe / `i18n` attribute / equivalent, and confirm a translation library
(`@angular/localize` or a runtime library such as Transloco) is actually installed and
configured. This is the same gap `angular-dynamic-forms` ADF-005 calls out for
descriptor-driven forms — it applies to every other template too, not just dynamic forms.

### BAD — hardcoded strings everywhere

```html
<button>Approve</button>
<p>Your order has been confirmed.</p>
```

### GOOD — every user-facing string resolved through the i18n pipe

```html
<button>{{ 'orders.approve' | translate }}</button>
<p>{{ 'orders.confirmed' | translate }}</p>
```

---

## Check B — Translation keys don't share a key space with the .NET DB-override table (I18N-002)

### Detection

Compare the Angular translation key namespace against the `.NET` `dotnet-localization`
DB-override table's `Key` column. If there's no documented shared convention (e.g., both
sides use `feature.subfeature.label` dot-notation and the same key literally appears in
both the Angular translation file and the DB override row for a shared string), an admin
correcting a translation in the DB-backed override tool has no way to know whether it
affects any given Angular string.

### BAD — Angular and .NET translation keys evolved independently, no shared convention

```typescript
// Angular: "customer_first_name"
```
```sql
-- .NET LocalizationOverrides table: Key = 'Customer.FirstNameLabel'
-- Same concept, no relationship between the two key strings.
```

### GOOD — one key convention shared across both stacks

```typescript
// Angular translation file
{ "customer.firstName": "First name" }
```
```sql
-- .NET LocalizationOverrides table
INSERT INTO LocalizationOverrides (Key, Culture, Value) VALUES ('customer.firstName', 'fr', 'Prénom');
-- Same key literal on both sides — an override to one is discoverable from the other.
```

Where a string is genuinely shared (e.g., a validation message rendered by both a
server-side email template and the Angular form, per `angular-dynamic-forms`), the .NET
API should expose it through a translations endpoint rather than each stack maintaining
an independent copy.

---

## Check C — Locale-unaware date/number/currency formatting (I18N-003)

### Detection

Grep templates for `DatePipe`/`CurrencyPipe`/`DecimalPipe` calls with a hardcoded locale
argument (`'en-US'`) instead of relying on the app's active `LOCALE_ID`, or raw
`toLocaleDateString()` calls with no locale parameter at all.

### BAD — hardcoded locale on every formatting call

```html
{{ order.total | currency:'USD':'symbol':'1.2-2':'en-US' }}
```

### GOOD — locale-aware, driven by the active LOCALE_ID

```typescript
providers: [{ provide: LOCALE_ID, useFactory: () => activeLocaleService.current() }]
```

```html
{{ order.total | currency }}  <!-- uses the app's active LOCALE_ID -->
```

---

## Check D — No RTL layout support (I18N-004)

### Detection

If the app supports a locale that requires right-to-left layout (Arabic, Hebrew), check
whether the root `<html>`/`<body>` sets `dir="rtl"` on locale switch, and whether component
styles use logical CSS properties (`margin-inline-start` instead of `margin-left`) rather
than physical properties that visually break when mirrored.

### BAD — no dir attribute, physical CSS properties throughout

```scss
.card { margin-left: 16px; } // breaks visually in RTL locales
```

```html
<html> <!-- no dir attribute set based on active locale -->
```

### GOOD — dir attribute driven by locale, logical CSS properties

```typescript
document.documentElement.dir = this.localeService.isRtl() ? 'rtl' : 'ltr';
```

```scss
.card { margin-inline-start: 16px; } // mirrors automatically under dir="rtl"
```

---

## Check E — Locale switch requires a full page reload (I18N-005, advisory)

### Detection

Confirm switching the active locale swaps translations at runtime (a runtime i18n library
loading a new translation bundle) rather than requiring `window.location.reload()` with a
different `?locale=` query param — the latter loses in-progress form state
(`angular-dynamic-forms`) and unsaved user input.
