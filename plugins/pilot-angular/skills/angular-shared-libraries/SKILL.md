---
name: angular-shared-libraries
description: Structuring reusable Angular code across an app or Nx/Angular-CLI workspace — shared reactive-forms building blocks (form-group factories, centralized validators) and a generic typed paged/sortable/filterable DataTableComponent, extracted into proper workspace libraries with clean public APIs instead of duplicated per feature.
when_to_use: shared library, workspace library, libs folder, reusable form, form factory, custom validators, validators.ts, data table component, generic table, paging sorting filtering, ControlValueAccessor, barrel file, path mapping, relative import hell, empty state loading state
applies_to: angular>=17
---

<!-- Version index:
  Standalone components / signal inputs   Angular 17+
  Angular CDK Table                        all supported Nx/Angular-CLI versions
  Angular Material Table (MatTableDataSource) all supported versions
-->

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| ASL-001 | P2 | Form-group wiring/validation duplicated per feature instead of a shared factory/composable |
| ASL-002 | P2 | Custom validators reimplemented ad-hoc instead of centralized `validators.ts` |
| ASL-003 | P1 | Paged/sortable/filterable table reimplemented per feature instead of generic `DataTableComponent<T>` |
| ASL-004 | P2 | Table state (page/sort/filter) untyped `any` or scattered fields instead of a shared typed model |
| ASL-005 | P1 | Shared code lives inside one feature's folder, imported cross-feature via `../../../` instead of a workspace library |
| ASL-006 | P2 | No shared empty/loading/error-state template reused across table instances |

---

## Check A — Duplicated form-group wiring (ASL-001)

### Detection
1. Search feature components for repeated `FormGroup` construction with the same field set (e.g., `street`, `city`, `postalCode`, `country`) inline in each component's constructor/`ngOnInit`.
2. Flag when the same set of controls + validators appears in two or more feature directories.
3. Confirm a shared factory function or reusable `ControlValueAccessor` component exists in a shared forms library and is imported instead of re-declared.

### BAD — same address FormGroup rebuilt in every feature
```typescript
// customer-edit.component.ts
this.form = this.fb.group({
  street: ['', Validators.required],
  city: ['', Validators.required],
  postalCode: ['', [Validators.required, Validators.pattern(/^\d{5}$/)]],
  country: ['', Validators.required],
});
```

```typescript
// vendor-onboarding.component.ts
this.form = this.fb.group({
  street: ['', Validators.required],
  city: ['', Validators.required],
  postalCode: ['', [Validators.required, Validators.pattern(/^\d{5}$/)]], // duplicated
  country: ['', Validators.required],
});
```

### GOOD — shared factory in libs/shared-forms
```typescript
// libs/shared-forms/src/lib/address/address-form.factory.ts
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { inject } from '@angular/core';

export interface AddressFormValue {
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export function createAddressFormGroup(fb: FormBuilder): FormGroup<{
  street: import('@angular/forms').FormControl<string>;
  city: import('@angular/forms').FormControl<string>;
  postalCode: import('@angular/forms').FormControl<string>;
  country: import('@angular/forms').FormControl<string>;
}> {
  return fb.nonNullable.group({
    street: ['', Validators.required],
    city: ['', Validators.required],
    postalCode: ['', [Validators.required, Validators.pattern(/^\d{5}$/)]],
    country: ['', Validators.required],
  });
}
```

```typescript
// customer-edit.component.ts
import { createAddressFormGroup } from '@myorg/shared-forms';

export class CustomerEditComponent {
  private readonly fb = inject(FormBuilder);
  readonly form = createAddressFormGroup(this.fb);
}
```

---

## Check B — Ad-hoc custom validators (ASL-002)

### Detection
1. Grep across feature directories for inline `ValidatorFn` implementations (e.g., a phone-format regex or a cross-field "passwords match" check) defined more than once.
2. Confirm a single `libs/shared-forms/src/lib/validators.ts` exports every custom validator, and features import from it rather than redefining.

### BAD — cross-field match validator redefined per feature
```typescript
// signup.component.ts
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const pw = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return pw === confirm ? null : { passwordsMismatch: true };
}
```

```typescript
// reset-password.component.ts
function checkPasswordsEqual(group: AbstractControl): ValidationErrors | null { // reimplemented
  const a = group.get('newPassword')?.value;
  const b = group.get('confirmNewPassword')?.value;
  return a === b ? null : { mismatch: true };
}
```

### GOOD — centralized validators.ts
```typescript
// libs/shared-forms/src/lib/validators.ts
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function matchFields(controlA: string, controlB: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const valueA = group.get(controlA)?.value;
    const valueB = group.get(controlB)?.value;
    return valueA === valueB ? null : { fieldsMismatch: { controlA, controlB } };
  };
}

export function phoneNumber(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const valid = /^\+?[1-9]\d{7,14}$/.test(control.value ?? '');
    return valid ? null : { phoneNumber: true };
  };
}
```

```typescript
// signup.component.ts
import { matchFields } from '@myorg/shared-forms';

this.form = this.fb.group(
  { password: [''], confirmPassword: [''] },
  { validators: matchFields('password', 'confirmPassword') },
);
```

---

## Check C — Reimplemented data table per feature (ASL-003)

### Detection
1. Search for multiple feature components each implementing their own paging/sorting/filtering template and handlers around `MatTableDataSource` or a raw CDK table.
2. Confirm a single generic `DataTableComponent<T>` exists in a shared UI library, accepting a typed `columns` config input and emitting state-change events, and every feature table wraps it instead of reimplementing.

### BAD — copy-pasted table per feature
```typescript
// orders-list.component.ts
@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [MatTableModule, MatPaginatorModule, MatSortModule],
  template: `
    <table mat-table [dataSource]="dataSource" matSort>
      <ng-container matColumnDef="id">
        <th mat-header-cell *matHeaderCellDef mat-sort-header>ID</th>
        <td mat-cell *matCellDef="let row">{{ row.id }}</td>
      </ng-container>
      <!-- repeated for every column, repeated again in invoices-list.component.ts -->
      <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
      <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
    </table>
    <mat-paginator [pageSizeOptions]="[10, 25, 50]" showFirstLastButtons></mat-paginator>
  `,
})
export class OrdersListComponent implements AfterViewInit {
  displayedColumns = ['id', 'customer', 'total'];
  dataSource = new MatTableDataSource(this.orders);
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }
}
```

### GOOD — one generic, typed DataTableComponent<T> in libs/shared-ui
```typescript
// libs/shared-ui/src/lib/data-table/data-table.model.ts
export interface ColumnConfig<T> {
  key: keyof T & string;
  label: string;
  sortable?: boolean;
}

export interface TableState {
  pageIndex: number;
  pageSize: number;
  sortField: string | null;
  sortDirection: 'asc' | 'desc' | null;
  filterText: string;
}
```

```typescript
// libs/shared-ui/src/lib/data-table/data-table.component.ts
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { ColumnConfig, TableState } from './data-table.model';

@Component({
  selector: 'app-data-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTableModule, MatPaginatorModule, MatSortModule],
  templateUrl: './data-table.component.html',
})
export class DataTableComponent<T extends Record<string, unknown>> {
  readonly rows = input.required<T[]>();
  readonly columns = input.required<ColumnConfig<T>[]>();
  readonly totalCount = input<number>(0);
  readonly state = input.required<TableState>();
  readonly stateChange = output<TableState>();

  protected onSortChange(sort: Sort): void {
    this.stateChange.emit({
      ...this.state(),
      sortField: sort.direction ? sort.active : null,
      sortDirection: sort.direction || null,
    });
  }

  protected onPageChange(event: PageEvent): void {
    this.stateChange.emit({
      ...this.state(),
      pageIndex: event.pageIndex,
      pageSize: event.pageSize,
    });
  }
}
```

```typescript
// orders-list.component.ts — wraps the shared table, no template duplication
@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [DataTableComponent],
  template: `
    <app-data-table
      [rows]="orders()"
      [columns]="columns"
      [state]="tableState()"
      (stateChange)="onStateChange($event)" />
  `,
})
export class OrdersListComponent {
  protected readonly columns: ColumnConfig<Order>[] = [
    { key: 'id', label: 'ID', sortable: true },
    { key: 'customer', label: 'Customer', sortable: true },
    { key: 'total', label: 'Total', sortable: true },
  ];
}
```

---

## Check D — Untyped table state (ASL-004)

### Detection
1. Search table-hosting components for `any`-typed state fields (`pageIndex: any`, `sort: any`) or scattered standalone properties instead of one typed state object.
2. Confirm every table instance reuses the shared `TableState` interface (Check C) via a signal, rather than redeclaring its own shape.

### BAD — scattered untyped state fields
```typescript
export class InvoicesListComponent {
  page: any = 0;
  size: any = 10;
  sortCol: any;
  sortDir: any;
  filter: any = '';
}
```

### GOOD — shared typed state signal
```typescript
import { signal } from '@angular/core';
import { TableState } from '@myorg/shared-ui';

export class InvoicesListComponent {
  protected readonly tableState = signal<TableState>({
    pageIndex: 0,
    pageSize: 10,
    sortField: null,
    sortDirection: null,
    filterText: '',
  });

  protected onStateChange(next: TableState): void {
    this.tableState.set(next);
    this.loadInvoices(next);
  }
}
```

---

## Check E — Shared code trapped in one feature's folder (ASL-005)

### Detection
1. Search for `import ... from '../../../'` (three or more `../` segments) crossing feature-module boundaries.
2. Confirm shared, feature-agnostic code lives under a workspace library (`libs/shared-ui`, `libs/shared-forms`) with a barrel `index.ts`, and is consumed via a path-mapped import (`@myorg/shared-ui`), not a relative path.
3. Check `tsconfig.base.json` (Nx) or `tsconfig.json` `paths` for the mapping.

### BAD — deep relative import reaching into another feature
```typescript
// features/invoices/invoice-detail.component.ts
import { DataTableComponent } from '../../../features/orders/components/data-table/data-table.component';
```

### GOOD — extracted to a library, imported via path mapping
```json
// tsconfig.base.json
{
  "compilerOptions": {
    "paths": {
      "@myorg/shared-ui": ["libs/shared-ui/src/index.ts"],
      "@myorg/shared-forms": ["libs/shared-forms/src/index.ts"]
    }
  }
}
```

```typescript
// libs/shared-ui/src/index.ts — public API barrel
export * from './lib/data-table/data-table.component';
export * from './lib/data-table/data-table.model';
export * from './lib/empty-state/empty-state.component';
```

```typescript
// features/invoices/invoice-detail.component.ts
import { DataTableComponent } from '@myorg/shared-ui';
```

---

## Check F — No shared empty/loading/error-state template (ASL-006)

### Detection
1. Check each feature's table wrapper for its own inline spinner/empty-message markup instead of a shared state component.
2. Confirm a single `EmptyStateComponent`/`LoadingStateComponent` (or a combined `@if`/`@switch` slot pattern) in the shared UI library is reused by every table instance.

### BAD — bespoke empty/loading markup per feature
```html
<!-- orders-list.component.html -->
@if (loading()) {
  <div class="spinner">Loading orders…</div>
} @else if (orders().length === 0) {
  <p>No orders found. Try adjusting your filters.</p>
}
```

```html
<!-- invoices-list.component.html -->
@if (isLoading()) {
  <mat-spinner diameter="24"></mat-spinner> <!-- different markup, same intent -->
} @else if (!invoices().length) {
  <span>Nothing here yet.</span>
}
```

### GOOD — shared state component reused everywhere
```typescript
// libs/shared-ui/src/lib/list-state/list-state.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';

@Component({
  selector: 'app-list-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="list-state list-state--loading" role="status" aria-live="polite">
        <mat-spinner diameter="32" />
        <span>Loading…</span>
      </div>
    } @else if (error()) {
      <div class="list-state list-state--error" role="alert">{{ error() }}</div>
    } @else if (isEmpty()) {
      <div class="list-state list-state--empty">{{ emptyMessage() }}</div>
    }
  `,
})
export class ListStateComponent {
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly isEmpty = input(false);
  readonly emptyMessage = input('No results found.');
}
```

```html
<!-- orders-list.component.html -->
<app-list-state [loading]="loading()" [isEmpty]="orders().length === 0" emptyMessage="No orders found." />
```

---

## Shared libraries checklist

- [ ] Repeated `FormGroup` shapes extracted into a shared factory/composable in `libs/shared-forms`
- [ ] Custom validators centralized in one `validators.ts`, imported everywhere they're needed
- [ ] Paged/sortable/filterable tables wrap a single generic `DataTableComponent<T>`, not copy-pasted
- [ ] Table paging/sort/filter state uses a shared typed `TableState` model, no `any`
- [ ] Shared code lives in a proper workspace library with an `index.ts` barrel and path-mapped import
- [ ] No `../../../`-style relative imports crossing feature-module boundaries
- [ ] Every table/list instance reuses one shared empty/loading/error-state component
