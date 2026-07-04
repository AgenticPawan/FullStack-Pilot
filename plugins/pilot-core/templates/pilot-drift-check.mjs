#!/usr/bin/env node
// pilot-drift-check.mjs
// Compares current package.json + *.csproj versions against .claude/pilot/stack-profile.json.
// Emitted to PROJECT_ROOT/.github/scripts/pilot-drift-check.mjs by /pilot-init.
// Outputs GitHub Actions step outputs: drift_detected (true/false) and drift_body (markdown).

import fs from 'node:fs';
import path from 'node:path';

const ROOT   = process.cwd();
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT ?? '/dev/null';

// ─── Load saved profile ───────────────────────────────────────────────────────

const profilePath = path.join(ROOT, '.claude', 'pilot', 'stack-profile.json');
if (!fs.existsSync(profilePath)) {
  setOutput('drift_detected', 'false');
  console.log('No stack-profile.json found — skipping drift check.');
  process.exit(0);
}

const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const driftItems = [];

// ─── Angular drift ────────────────────────────────────────────────────────────

if (profile.angular) {
  const pkgPath = path.join(ROOT, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const corePkg = allDeps['@angular/core'] ?? null;

    if (corePkg) {
      const currentMajor = parseInt(corePkg.replace(/[^0-9]/, ''), 10);
      if (!isNaN(currentMajor) && currentMajor !== profile.angular.majorVersion) {
        driftItems.push({
          category: 'Angular major version',
          saved: `v${profile.angular.majorVersion}`,
          current: `v${currentMajor}`,
          file: 'package.json',
          action: currentMajor > profile.angular.majorVersion
            ? 'Run `/pilot-init` to update stack-profile.json and activate new governance rules.'
            : 'Downgrade detected — verify intentional.',
        });
      }
    }

    // Check for new security-relevant devDependencies
    const securityPackages = [
      '@angular-eslint/eslint-plugin',
      '@angular-eslint/template-parser',
    ];
    for (const sp of securityPackages) {
      if (allDeps[sp] && !profile.angular.eslint) {
        driftItems.push({
          category: 'New Angular ESLint dependency',
          saved: 'eslint: false',
          current: `${sp} detected`,
          file: 'package.json',
          action: 'Run `/pilot-init` to activate angular-eslint governance rules.',
        });
      }
    }
  }
}

// ─── .NET drift ───────────────────────────────────────────────────────────────

if (profile.dotnet) {
  for (const savedProject of profile.dotnet.projects ?? []) {
    const csprojPath = path.join(ROOT, savedProject.path);
    if (!fs.existsSync(csprojPath)) {
      driftItems.push({
        category: '.NET project removed or renamed',
        saved: savedProject.path,
        current: 'file not found',
        file: savedProject.path,
        action: 'Run `/pilot-init` to update the project list.',
      });
      continue;
    }

    const content = fs.readFileSync(csprojPath, 'utf8');

    // TargetFramework drift
    const tfMatch = content.match(/<TargetFramework>(.*?)<\/TargetFramework>/);
    if (tfMatch && tfMatch[1] !== savedProject.targetFramework) {
      driftItems.push({
        category: '.NET target framework upgraded',
        saved: savedProject.targetFramework,
        current: tfMatch[1],
        file: savedProject.path,
        action: 'Run `/pilot-init` to update profile and check for new governance rules.',
      });
    }

    // Key package version drift
    const packageChecks = [
      { key: 'efCore',            nuget: 'Microsoft.EntityFrameworkCore' },
      { key: 'resilience',        nuget: 'Microsoft.Extensions.Resilience' },
      { key: 'mediatR',           nuget: 'MediatR' },
    ];

    for (const { key, nuget } of packageChecks) {
      const pkgMatch = content.match(new RegExp(`Include="${nuget}"[^/]*Version="([^"]+)"`));
      if (pkgMatch) {
        const currentVersion = pkgMatch[1];
        const savedVersion   = savedProject.packages?.[key] ?? null;
        if (savedVersion && currentVersion !== savedVersion) {
          driftItems.push({
            category: `NuGet package updated: ${nuget}`,
            saved: savedVersion,
            current: currentVersion,
            file: savedProject.path,
            action: 'Verify compatibility. Run `/pilot-audit` to check for new vulnerability advisories.',
          });
        }
      } else if (savedProject.packages?.[key]) {
        // Package was in the profile but is no longer in the project
        driftItems.push({
          category: `NuGet package removed: ${nuget}`,
          saved: savedProject.packages[key],
          current: 'not found in csproj',
          file: savedProject.path,
          action: 'Confirm intentional removal. Update stack-profile.json via `/pilot-init`.',
        });
      }
    }
  }

  // New .csproj files not in the profile
  const allCsproj = findFiles(ROOT, '.csproj', ['node_modules', 'bin', 'obj', 'dist', '.git']);
  const savedPaths = new Set(profile.dotnet.projects.map(p => path.normalize(path.join(ROOT, p.path))));
  for (const f of allCsproj) {
    if (!savedPaths.has(path.normalize(f))) {
      driftItems.push({
        category: 'New .NET project added',
        saved: 'not in stack-profile.json',
        current: path.relative(ROOT, f),
        file: path.relative(ROOT, f),
        action: 'Run `/pilot-init` to profile this project and apply governance rules.',
      });
    }
  }
}

// ─── Build drift report ───────────────────────────────────────────────────────

if (driftItems.length === 0) {
  setOutput('drift_detected', 'false');
  console.log('No drift detected.');
  process.exit(0);
}

const repoUrl = `https://github.com/${process.env.GITHUB_REPOSITORY ?? 'owner/repo'}`;
const runUrl  = `${repoUrl}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`;

const rows = driftItems.map(d =>
  `| ${d.category} | ${d.file} | \`${d.saved}\` → \`${d.current}\` | ${d.action} |`
).join('\n');

const body = `## Stack Drift Detected — ${new Date().toISOString().slice(0, 10)}

Pilot drift detection found **${driftItems.length}** change(s) since the last \`stack-profile.json\` update.

| Change | File | Delta | Recommended action |
|--------|------|-------|-------------------|
${rows}

---

**Next steps:**
1. Review the changes above.
2. Run \`/pilot-init\` in a Claude Code session on the default branch to update \`stack-profile.json\` and re-materialize governance rules.
3. Close this issue once \`stack-profile.json\` is committed.

[View workflow run](${runUrl})
`;

setOutput('drift_detected', 'true');
setOutput('drift_body', body);
console.log(`Drift detected: ${driftItems.length} item(s)`);
driftItems.forEach(d => console.log(`  - ${d.category}: ${d.saved} → ${d.current}`));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setOutput(name, value) {
  fs.appendFileSync(GITHUB_OUTPUT, `${name}=${value}\n`);
}

function findFiles(dir, ext, skipDirs) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.includes(entry.name)) results.push(...findFiles(path.join(dir, entry.name), ext, skipDirs));
    } else if (entry.name.endsWith(ext)) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}
