---
id: angular-lt17-ngmodule
title: Angular <17 NgModule Conventions + Upgrade Advisory
appliesTo: angular<17
severity: advise
standard: InternalPolicy
---
> **⚠ EOL ADVISORY**: Angular 15 (end-of-life May 2024) and Angular 16 (end-of-life November 2024) are no longer supported by the Angular team. Run `/pilot-upgrade` to plan the migration to Angular 17+. Governance for EOL stacks is **upgrade pressure**, not blessing.

Maintain NgModule-based structure for consistency. Declare components in feature modules. Do not introduce standalone components without a clear module boundary plan.

**BAD**
```typescript
// Isolated standalone component introduced into an NgModule-based app
// without a migration plan — creates hybrid confusion
@Component({ standalone: true, imports: [CommonModule] })
export class FeatureComponent {}
```

**GOOD**
```typescript
// Keep NgModule pattern consistent until a full migration is planned
@NgModule({
  declarations: [FeatureComponent],
  imports: [SharedModule],
  exports: [FeatureComponent],
})
export class FeatureModule {}
```
