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

  const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
  if (ageDays >= STALE_DAYS) {
    process.stdout.write(JSON.stringify({
      systemMessage:
        `[pilot-core] stack-profile.json is ${Math.floor(ageDays)} day(s) old. ` +
        'Run /fsp-init to refresh stack detection — new frameworks or packages added ' +
        'since the last scan may not appear in reviewer findings.',
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
