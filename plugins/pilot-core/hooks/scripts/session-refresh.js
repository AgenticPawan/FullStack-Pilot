#!/usr/bin/env node
'use strict';
// SessionStart hook — stack-profile staleness check.
// Warns if .claude/pilot/stack-profile.json is older than STALE_DAYS days so the
// user knows to re-run /fsp-init before relying on reviewer findings.
// Kill-switch: set enable_governance_hooks=false in pilot-core userConfig.
// Always exits 0 — a staleness check must never block session start.

const fs   = require('node:fs');
const path = require('node:path');

const STALE_DAYS = 7;

function main() {
  if (process.env.CLAUDE_PLUGIN_OPTION_ENABLE_GOVERNANCE_HOOKS === 'false') {
    process.exit(0);
  }

  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const profilePath = path.join(cwd, '.claude', 'pilot', 'stack-profile.json');

  if (!fs.existsSync(profilePath)) {
    // /fsp-init has not been run in this project — nothing to check.
    process.exit(0);
  }

  let stat;
  try {
    stat = fs.statSync(profilePath);
  } catch (_) {
    process.exit(0);
  }

  const profileMtime = stat.mtimeMs;
  const ageDays = (Date.now() - profileMtime) / (1000 * 60 * 60 * 24);

  // Check 1 — age-based staleness
  const stale = ageDays >= STALE_DAYS;

  // Check 2 — dependency manifest newer than profile.
  // Only reads filenames in the project root (no recursion) — bounded O(readdir).
  let newerManifest = null;
  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name !== 'package.json' && !e.name.endsWith('.csproj')) continue;
      try {
        const mtime = fs.statSync(path.join(cwd, e.name)).mtimeMs;
        if (mtime > profileMtime) { newerManifest = e.name; break; }
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore — readdir failure is non-fatal */ }

  if (stale || newerManifest) {
    const reasons = [];
    if (stale) reasons.push(`stack-profile.json is ${Math.floor(ageDays)} day(s) old`);
    if (newerManifest) reasons.push(`${newerManifest} was modified after the last scan`);
    process.stdout.write(JSON.stringify({
      systemMessage:
        `[pilot-core] Stack profile may be outdated (${reasons.join('; ')}). ` +
        'Run /fsp-init to refresh stack detection — new frameworks or packages ' +
        'may not appear in reviewer findings.',
    }));
  }
}

try {
  main();
} catch (e) {
  try {
    process.stderr.write(
      `[pilot-core/session-refresh] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
}
process.exit(0);
