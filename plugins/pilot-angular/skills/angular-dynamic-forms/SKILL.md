---
name: angular-dynamic-forms
description: Reviews JSON-schema-driven Angular reactive forms — a shared field-descriptor model driving FormGroup construction and template rendering. Flags hand-coded form fields where a descriptor should drive them, validation duplicated between descriptor and ad-hoc Validators, missing generic field renderers, enabled/disabled state set directly on FormControl, and hardcoded tooltips/labels instead of localization keys. Builds on angular-shared-libraries' form-factory guidance.
when_to_use: dynamic form, JSON-driven form, form schema, field descriptor, metadata-driven form, DynamicFormBuilder, DynamicFormField, form config, configurable validations, form field enabled disabled, tooltip localization, generic form renderer
applies_to: angular>=17
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| ADF-001 | P1 | Reactive form fields hand-coded per component instead of driven by a shared field-descriptor |
| ADF-002 | P1 | Validation rules duplicated between the JSON descriptor and ad-hoc `Validators.*` calls |
| ADF-003 | P2 | No generic `DynamicFormField`/renderer component — each feature hand-rolls its own template switch |
| ADF-004 | P2 | Field `enabled`/`disabled` toggled directly on the `FormControl` instead of driven from the descriptor |
| ADF-005 | P2 | Tooltip/label text hardcoded in the template instead of resolved from the descriptor's localization key |

This skill covers the *descriptor-driven* layer specifically. For the underlying shared
form-factory/`ControlValueAccessor`/validator-library patterns each descriptor field ultimately
uses, see `angular-shared-libraries` (ASL-001/ASL-002) — this skill doesn't re-explain those.

---

## The field-descriptor shape

```typescript
export interface FieldValidationRules {
  required?: boolean;
  pattern?: string;       // regex source, e.g. '^[0-9]{5}$'
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
}

export interface FormFieldDescriptor {
  id: string;                 // stable field key, used as the FormControl name
  name: string;                // display label (or a localization key — see ADF-005)
  type: 'text' | 'number' | 'select' | 'checkbox' | 'date';
  validations?: FieldValidationRules;
  enabled: boolean;
  localizationKey?: string;    // resolves name/tooltip/options through the i18n pipe
  tooltip?: string;
}
```

A form is a `FormFieldDescriptor[]` (typically fetched from an API or defined as a constant
per feature), translated into a `FormGroup` and rendered generically — see Checks A–C.

---

## Check A — Form fields hand-coded instead of descriptor-driven (ADF-001)

### Detection

1. Look for a feature component that constructs a `FormGroup` with an inline field list (name, validators, template markup) that could instead be data — especially where the same shape of form (varying only which fields appear, their labels, or validation rules) repeats across features or changes based on tenant/user-role configuration.
2. Flag when adding/removing/reordering a field requires a code change and redeploy instead of updating the descriptor data.

### BAD — fields and validators hardcoded per component

```typescript
// customer-edit.component.ts
this.form = this.fb.group({
  firstName: ['', [Validators.required, Validators.maxLength(50)]],
  email: ['', [Validators.required, Validators.pattern(/^[^\s@]+@[^\s@]+$/)]],
});
```

```html
<!-- customer-edit.component.html -->
<label for="firstName">First name</label>
<input id="firstName" formControlName="firstName" />

<label for="email">Email</label>
<input id="email" formControlName="email" />
```

### GOOD — descriptor drives both the FormGroup and the rendered fields

```typescript
const customerFormSchema: FormFieldDescriptor[] = [
  { id: 'firstName', name: 'Customer.FirstName', type: 'text', enabled: true,
    validations: { required: true, maxLength: 50 }, localizationKey: 'customer.firstName' },
  { id: 'email', name: 'Customer.Email', type: 'text', enabled: true,
    validations: { required: true, pattern: '^[^\\s@]+@[^\\s@]+$' },
    localizationKey: 'customer.email', tooltip: 'customer.emailTooltip' },
];

this.form = this.formSchemaService.buildFormGroup(customerFormSchema);
```

```html
<app-dynamic-form-field
  *ngFor="let field of customerFormSchema"
  [descriptor]="field"
  [control]="form.controls[field.id]" />
```

---

## Check B — Validation duplicated between descriptor and ad-hoc calls (ADF-002)

### Detection

Grep for `Validators.*` calls added directly against a `FormControl` in addition to the same
rule already present in a field's `validations` block — a sign the descriptor isn't the single
source of truth for validation.

### BAD — same rule declared twice, can drift

```typescript
const descriptor = { id: 'email', validations: { required: true, maxLength: 100 } };
// ...later, in the component:
this.form.get('email')!.addValidators(Validators.required); // duplicates the descriptor's rule
```

### GOOD — one translator function turns descriptor rules into Validators

```typescript
export function buildValidators(rules: FieldValidationRules = {}): ValidatorFn[] {
  const validators: ValidatorFn[] = [];
  if (rules.required) validators.push(Validators.required);
  if (rules.pattern) validators.push(Validators.pattern(rules.pattern));
  if (rules.minLength != null) validators.push(Validators.minLength(rules.minLength));
  if (rules.maxLength != null) validators.push(Validators.maxLength(rules.maxLength));
  if (rules.min != null) validators.push(Validators.min(rules.min));
  if (rules.max != null) validators.push(Validators.max(rules.max));
  return validators;
}

// FormSchemaService
buildFormGroup(descriptors: FormFieldDescriptor[]): FormGroup {
  const controls = Object.fromEntries(
    descriptors.map(d => [
      d.id,
      new FormControl({ value: '', disabled: !d.enabled }, buildValidators(d.validations)),
    ]),
  );
  return new FormGroup(controls);
}
```

---

## Check C — No generic field-renderer component (ADF-003)

### Detection

Check whether each feature's template hand-rolls its own `*ngIf`/`@switch` over field type
(text vs. select vs. checkbox) instead of a single shared `DynamicFormFieldComponent` that
every descriptor-driven form reuses.

### BAD — per-feature template switch reimplemented each time

```html
<ng-container *ngFor="let field of fields">
  <input *ngIf="field.type === 'text'" [formControlName]="field.id" />
  <select *ngIf="field.type === 'select'" [formControlName]="field.id">...</select>
  <!-- reimplemented in every feature that renders a dynamic form -->
</ng-container>
```

### GOOD — one shared renderer, imported everywhere

```typescript
@Component({
  selector: 'app-dynamic-form-field',
  standalone: true,
  template: `
    @switch (descriptor().type) {
      @case ('select') { <app-select-field [descriptor]="descriptor()" [control]="control()" /> }
      @case ('checkbox') { <app-checkbox-field [descriptor]="descriptor()" [control]="control()" /> }
      @default { <app-text-field [descriptor]="descriptor()" [control]="control()" /> }
    }
  `,
})
export class DynamicFormFieldComponent {
  descriptor = input.required<FormFieldDescriptor>();
  control = input.required<FormControl>();
}
```

---

## Check D — enabled/disabled set directly instead of from the descriptor (ADF-004)

### Detection

Grep for direct `control.enable()`/`control.disable()` calls scattered through component logic
that duplicate or fight the descriptor's `enabled` flag, letting descriptor state and runtime
form state drift out of sync.

### BAD — enable/disable state managed outside the descriptor

```typescript
if (this.userRole !== 'Admin') {
  this.form.get('discountPercent')?.disable(); // descriptor still says enabled: true
}
```

### GOOD — descriptor is the single source of truth, re-evaluated when it changes

```typescript
buildFormGroup(descriptors: FormFieldDescriptor[]): FormGroup {
  const controls = Object.fromEntries(
    descriptors.map(d => [d.id, new FormControl({ value: '', disabled: !d.enabled }, buildValidators(d.validations))]),
  );
  return new FormGroup(controls);
}

// Role-based visibility becomes a descriptor transform upstream of buildFormGroup,
// not an ad-hoc enable()/disable() call:
const descriptors = baseSchema.map(d =>
  d.id === 'discountPercent' ? { ...d, enabled: userRole === 'Admin' } : d);
```

---

## Check E — Tooltip/label hardcoded instead of localized (ADF-005)

### Detection

Check whether the rendered field's label/tooltip text is a literal string in the template
instead of resolved through the descriptor's `localizationKey` via the i18n pipe/service —
this bypasses whatever locale the app is currently rendering in.

### BAD — hardcoded English text in the template

```html
<label>First name</label>
<input [formControlName]="field.id" title="Enter the customer's legal first name" />
```

### GOOD — label/tooltip resolved from the descriptor's localization key

```html
<label>{{ field.localizationKey + '.label' | translate }}</label>
<input [formControlName]="field.id" [title]="(field.tooltip ?? '') | translate" />
```
