---
name: angular-lint-governance
description: Reviews ongoing ESLint/Prettier enforcement in CI — distinct from angular-upgrade-path's one-time TSLint-to-ESLint migration event. Flags ESLint configured locally but not run as a required CI gate, missing @angular-eslint template-file linting, ESLint and Prettier fighting over stylistic rules with no eslint-config-prettier, no pre-commit hook (husky + lint-staged) catching errors before CI, blanket file-level eslint-disable comments instead of scoped justified disables, and no documented warning-vs-error severity policy. Outputs findings with pilot-angular lint-governance standard IDs.
when_to_use: ESLint, eslint config, angular-eslint, CI lint gate, required check, Prettier, eslint-config-prettier, husky, lint-staged, pre-commit hook, eslint-disable, blanket disable, lint severity, warning vs error, lint policy, template linting
applies_to: angular
---

<!-- Version index:
  @angular-eslint (flat config)   Angular 17+ default schematic (eslint.config.js)
  @angular-eslint (.eslintrc)     Angular 15-16 (legacy schematic, still supported)
  Flat ESLint config format       ESLint 9+ default; ESLint 8 supports it opt-in
-->

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| LNT-001 | P1 | ESLint configured locally/IDE-only, not run as a required CI gate |
| LNT-002 | P1 | No `@angular-eslint/*` template rules — `.html` files skipped entirely |
| LNT-003 | P2 | ESLint and Prettier rules conflict — no `eslint-config-prettier` |
| LNT-004 | P2 | No pre-commit hook (husky + lint-staged) catching errors before CI |
| LNT-005 | P1 | Blanket file-level `eslint-disable` instead of scoped, justified, line-level disables |
| LNT-006 | P2 | No documented severity policy distinguishing warnings from must-fix errors |

**Cross-reference:** `angular-upgrade-path` owns the one-time *migration* from TSLint to ESLint
(schematics, config translation, `tslint.json` removal). This skill governs the *ongoing
enforcement* of the ESLint setup once it exists — CI gating, template linting, Prettier
integration, pre-commit hooks, and disable-comment discipline.

---

## Check A — ESLint as a required CI gate (LNT-001)

### Detection
1. Confirm `package.json` has an `ng lint` / `eslint .` script.
2. Search CI workflow files (`.github/workflows/*.yml`, Azure Pipelines YAML) for a step that
   runs the lint script.
3. If the lint step exists but is not in the required-checks list for the branch-protection rule
   (or runs with `continue-on-error: true` / `|| true`), flag it — a lint failure must block
   merge, not just print a warning in the log.
4. If no CI lint step exists at all, flag LNT-001 as the primary finding — linting only happening
   in a developer's IDE means violations reach `main` unchecked.

### BAD — lint step present but failure is swallowed
```yaml
# .github/workflows/ci.yml
- name: Lint
  run: npm run lint || true   # non-zero exit is silently ignored — never blocks the PR
```

### GOOD — lint failure blocks the PR
```yaml
# .github/workflows/ci.yml
- name: Lint
  run: npm run lint            # non-zero exit fails the job
```
```yaml
# branch protection (repo settings / as-code via ruleset)
required_status_checks:
  contexts:
    - "CI / Lint"
    - "CI / Build"
    - "CI / Test"
```

---

## Check B — Angular-specific and template-file linting (LNT-002)

### Detection
1. Read `eslint.config.js` (flat config, v17+ default) or `.eslintrc.json` (legacy).
2. Confirm `@angular-eslint/eslint-plugin` (TypeScript rules) AND
   `@angular-eslint/eslint-plugin-template` (template rules) are both configured, with an
   override block targeting `*.html` files (and inline templates via `processor`).
3. Flag a config that only lints `.ts` files with the generic `@typescript-eslint` ruleset and
   has no override block at all for `.html` — meaning template-only issues (missing `track` in
   `@for`, banned `[innerHTML]` patterns already caught by other skills, accessibility attribute
   rules) go completely unchecked.

### BAD — TypeScript-only config, templates never linted
```javascript
// eslint.config.js
module.exports = tseslint.config(
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended, ...angular.configs.tsRecommended]
  }
  // no block for **/*.html — template files are never linted
);
```

### GOOD — TypeScript and template rule sets both configured
```javascript
// eslint.config.js
module.exports = tseslint.config(
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    rules: {
      '@angular-eslint/component-selector': ['error', { prefix: 'app', style: 'kebab-case' }]
    }
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/no-negated-async': 'error'
    }
  }
);
```

---

## Check C — Prettier integrated without fighting ESLint (LNT-003)

### Detection
1. Confirm both ESLint and Prettier are present (`.prettierrc`/`prettier` in `package.json` plus
   an ESLint config).
2. Confirm `eslint-config-prettier` is included last in the ESLint `extends`/config array so it
   disables stylistic ESLint rules (indent, quotes, semi) that overlap Prettier's formatting.
3. Flag a setup where both tools are present but `eslint-config-prettier` is absent — this causes
   `eslint --fix` and `prettier --write` to repeatedly overwrite each other's formatting choices,
   and CI lint failures that are purely stylistic disagreements rather than real issues.

### BAD — Prettier and ESLint fight over formatting
```javascript
// eslint.config.js — no eslint-config-prettier; stylistic rules stay active
module.exports = tseslint.config({
  files: ['**/*.ts'],
  extends: [...tseslint.configs.recommended],
  rules: { indent: ['error', 2], quotes: ['error', 'single'] } // conflicts with .prettierrc
});
```

### GOOD — eslint-config-prettier disables overlapping stylistic rules
```javascript
// eslint.config.js
const prettierConfig = require('eslint-config-prettier');

module.exports = tseslint.config(
  { files: ['**/*.ts'], extends: [...tseslint.configs.recommended] },
  prettierConfig // must be last — turns off stylistic rules Prettier already owns
);
```

---

## Check D — Pre-commit hook catching errors before CI (LNT-004)

### Detection
1. Check for `husky` and `lint-staged` in `devDependencies` and a `.husky/pre-commit` script.
2. Confirm `lint-staged` config runs `eslint --fix` and `prettier --write` scoped to staged files
   only (not a full-repo lint on every commit, which is slow).
3. Flag a repo with a CI lint gate (Check A) but no local pre-commit hook — every trivially
   preventable lint error (missing semicolon, unused import) burns a full CI cycle before the
   developer finds out.

### BAD — no pre-commit hook; every typo costs a CI round-trip
```json
// package.json — no husky, no lint-staged; nothing runs locally before push
{
  "scripts": { "lint": "eslint ." }
}
```

### GOOD — husky + lint-staged catch issues before they leave the developer's machine
```json
// package.json
{
  "scripts": { "prepare": "husky" },
  "lint-staged": {
    "*.{ts,html}": ["eslint --fix"],
    "*.{ts,html,scss,json}": ["prettier --write"]
  }
}
```
```bash
# .husky/pre-commit
npx lint-staged
```

---

## Check E — Scoped, justified disables instead of blanket suppression (LNT-005)

### Detection
1. Search for `/* eslint-disable */` (no rule name — disables everything) at the top of a file.
2. Search for `// eslint-disable-line`/`// eslint-disable-next-line` usages with no rule name
   specified, or with a rule name but no adjacent justification comment.
3. Flag every blanket file-level disable found; recommend a scoped, rule-specific, line-level
   disable with a one-line reason instead.

### BAD — entire file's linting disabled, masking unrelated future violations
```typescript
/* eslint-disable */
// order.service.ts — disables ALL rules for the whole file, forever
export class OrderService {
  calculateTotal(items: any[]) { /* ... */ } // 'any' violation now permanently hidden
}
```

### GOOD — one line, one rule, one justification
```typescript
export class OrderService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party SDK returns untyped JSON
  calculateTotal(items: any[]) { /* ... */ }
}
```

---

## Check F — Documented severity policy: warnings vs. must-fix errors (LNT-006)

### Detection
1. Look for a documented policy (README, CONTRIBUTING.md, or comments in the ESLint config)
   distinguishing which rule violations are `'warn'` (advisory, tracked but non-blocking) versus
   `'error'` (must-fix, blocks CI).
2. Flag a config where every rule is `'error'` with no advisory tier at all (unworkable for
   teams migrating incrementally), OR where rules are `'warn'` with no plan/ownership for
   burning down the warning count — warnings that silently accumulate forever are equivalent to
   no rule at all.
3. Confirm CI reports the warning count somewhere visible (job summary, PR comment) even though
   warnings don't block merge, so the count doesn't grow unnoticed.

### BAD — no distinction, or warnings tracked nowhere
```javascript
// eslint.config.js — everything is 'warn'; nothing is ever actually enforced
rules: {
  '@typescript-eslint/no-explicit-any': 'warn',
  '@angular-eslint/template/no-negated-async': 'warn',
  'no-unused-vars': 'warn'
}
```

### GOOD — documented tiering with a visible warning budget
```javascript
// eslint.config.js
rules: {
  // Must-fix: blocks CI merge
  '@angular-eslint/template/no-negated-async': 'error',
  'no-unused-vars': 'error',
  // Advisory: tracked in the warning-budget dashboard, burned down incrementally per team OKR
  '@typescript-eslint/no-explicit-any': 'warn'
}
```
```yaml
# CI step reports the warning count so it stays visible, not silently growing
- name: Lint
  run: npm run lint -- --format=json --output-file=lint-report.json
- name: Publish warning count
  run: node scripts/report-lint-warnings.js lint-report.json
```

---

## Lint governance checklist

- [ ] `ng lint`/`eslint .` runs in CI as a required, blocking status check
- [ ] `@angular-eslint/eslint-plugin` and `@angular-eslint/eslint-plugin-template` are both configured with an `.html` override block
- [ ] `eslint-config-prettier` is included so ESLint and Prettier don't fight over stylistic rules
- [ ] `husky` + `lint-staged` catch lint/format errors on commit, before they reach CI
- [ ] No blanket file-level `eslint-disable` comments — disables are scoped, rule-specific, and justified
- [ ] A documented policy distinguishes advisory warnings from must-fix errors, with warning counts visible over time

---

## References

- Angular ESLint: https://github.com/angular-eslint/angular-eslint
- ESLint flat config: https://eslint.org/docs/latest/use/configure/configuration-files
- eslint-config-prettier: https://github.com/prettier/eslint-config-prettier
- husky: https://typicode.github.io/husky/
- lint-staged: https://github.com/lint-staged/lint-staged
