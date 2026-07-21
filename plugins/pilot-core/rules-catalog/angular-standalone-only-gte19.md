---
id: angular-standalone-only-gte19
title: No NgModule Declarations in Angular 19+ Projects
appliesTo: angular
severity: warn
standard: angular-style
---
Angular 19 makes standalone components, directives, and pipes the default. Projects
targeting Angular 19 or later MUST NOT introduce new `@NgModule` declarations.
Existing NgModule-based code should be migrated when the file is touched.

**Why:** NgModule creates an indirect scope that the Angular compiler must resolve,
hurts tree-shaking (the module graph prevents dead-code elimination at the component
level), and is the root cause of most "not part of any NgModule" runtime errors.
Standalone APIs compose directly through `imports: []` on the component decorator,
removing the indirection entirely.

**BAD (Angular 19+)**
```typescript
@NgModule({
  declarations: [OrderListComponent],
  imports: [CommonModule, MatTableModule],
  exports: [OrderListComponent]
})
export class OrderListModule { }
```

**GOOD**
```typescript
// Standalone component — imports listed directly, no NgModule wrapper needed
@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [CommonModule, MatTableModule],
  templateUrl: './order-list.component.html',
})
export class OrderListComponent { }
```

**Migration path:** `ng generate @angular/core:standalone` migrates existing NgModules.
Run it per-module, verify with `ng build --configuration production` after each pass.

**Detect version:** check `package.json` for `"@angular/core": "^19.*"` (or `>=19`)
before raising this finding. The hook advisory fires regardless — reviewers apply
judgement for projects still on Angular 18 with a pending upgrade.

Cross-reference: `angular-signals-reactive`, `angular-testing-strategy`.
