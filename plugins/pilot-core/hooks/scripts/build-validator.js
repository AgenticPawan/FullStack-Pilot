#!/usr/bin/env node
'use strict';
// PreToolUse hook — pre-build validator
// Before a dotnet build or ng build command, verifies minimum project structure.
// Exits non-zero (deny) with a specific missing-item message if structure is absent.
// For non-build commands, exits 0 immediately. Always fails open on errors.

const fs = require('node:fs');
const path = require('node:path');

function isBuildCommand(cmd) {
  return /\bdotnet\s+build\b/.test(cmd) ||
         /\bng\s+build\b/.test(cmd) ||
         /\bdotnet\s+publish\b/.test(cmd);
}

function isDotnetCommand(cmd) {
  return /\bdotnet\b/.test(cmd);
}

function isAngularCommand(cmd) {
  return /\bng\s+build\b/.test(cmd);
}

// Walk up from dir looking for a file matching predicate, max `levels` levels.
function findUp(startDir, predicate, levels = 5) {
  let dir = startDir;
  for (let i = 0; i < levels; i++) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const found = entries.find(e => e.isFile() && predicate(e.name));
      if (found) return path.join(dir, found.name);
    } catch (_) { /* skip unreadable dirs */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Check if Angular code exists anywhere under cwd (shallow check for angular.json).
function angularProjectExists(cwd) {
  try {
    return fs.existsSync(path.join(cwd, 'angular.json'));
  } catch (_) {
    return false;
  }
}

function validateStructure(cwd, command) {
  const issues = [];

  if (isDotnetCommand(command)) {
    // .NET: solution file should be present
    const slnFile = findUp(cwd, n => n.endsWith('.sln'), 3);
    if (!slnFile) {
      const csprojFile = findUp(cwd, n => n.endsWith('.csproj'), 3);
      if (!csprojFile) {
        issues.push('No .sln or .csproj found near the working directory. Run from the solution root.');
      }
    }

    // Directory.Build.props is required for multi-project .NET solutions
    const dbp = findUp(cwd, n => n === 'Directory.Build.props', 4);
    if (!dbp && slnFile) {
      // Only warn if there are multiple projects (solution has >1 project)
      const slnContent = (() => { try { return fs.readFileSync(slnFile, 'utf8'); } catch(_) { return ''; } })();
      const projectCount = (slnContent.match(/Project\(/g) || []).length;
      if (projectCount > 1) {
        issues.push(
          'Directory.Build.props not found but the solution has multiple projects. ' +
          'Add Directory.Build.props to centralize TreatWarningsAsErrors, Nullable, and TargetFramework.'
        );
      }
    }
  }

  if (isAngularCommand(command) || angularProjectExists(cwd)) {
    // Angular: angular.json must be present
    if (!fs.existsSync(path.join(cwd, 'angular.json'))) {
      issues.push('angular.json not found. Run ng build from the Angular workspace root.');
    }

    // Exactly one lock file should be present (not both npm and yarn)
    const hasPackageLock = fs.existsSync(path.join(cwd, 'package-lock.json'));
    const hasYarnLock    = fs.existsSync(path.join(cwd, 'yarn.lock'));
    const hasPnpmLock    = fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'));

    const lockCount = [hasPackageLock, hasYarnLock, hasPnpmLock].filter(Boolean).length;
    if (lockCount === 0) {
      issues.push('No package lock file found (package-lock.json, yarn.lock, pnpm-lock.yaml). Run npm install first.');
    } else if (lockCount > 1) {
      issues.push(
        'Multiple package lock files found. Use only one package manager — ' +
        'delete the lock files not matching your active package manager.'
      );
    }
  }

  return issues;
}

function main() {
  let raw;
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_) {
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_) {
    process.exit(0);
  }

  // Only intercept Bash PreToolUse
  if ((payload.tool_name || '') !== 'Bash') process.exit(0);

  const command = String((payload.tool_input || {}).command || '');
  if (!isBuildCommand(command)) process.exit(0);

  const cwd = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const issues = validateStructure(cwd, command);

  if (issues.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `[pilot-core/build-validator] Pre-build check failed:\n  - ${issues.join('\n  - ')}`,
      },
    }));
    process.exit(0);
  }

  process.exit(0);
}

try {
  main();
} catch (e) {
  try {
    process.stderr.write(`[pilot-core/build-validator] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
  process.exit(0);
}
