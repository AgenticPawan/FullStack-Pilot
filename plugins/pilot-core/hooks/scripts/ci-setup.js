#!/usr/bin/env node
'use strict';
// Setup hook — CI validation gate.
// Fires when Claude Code starts with --init-only or --init/--maintenance in -p mode.
// Runs scripts/validate.mjs from the repo root and surfaces the result so CI scripts
// see plugin-health issues without needing a separate validate step.
// Kill-switch: set enable_governance_hooks=false in pilot-core userConfig.

const { spawnSync } = require('node:child_process');
const fs   = require('node:fs');
const path = require('node:path');

function main() {
  if (process.env.CLAUDE_PLUGIN_OPTION_ENABLE_GOVERNANCE_HOOKS === 'false') {
    process.exit(0);
  }

  // validate.mjs lives at repo-root/scripts/validate.mjs.
  // CLAUDE_PLUGIN_ROOT resolves to <repo-root>/plugins/pilot-core/ (install or local).
  const pluginRoot   = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '../..');
  const validateScript = path.resolve(pluginRoot, '../../scripts/validate.mjs');

  if (!fs.existsSync(validateScript)) {
    // Running outside the FullStack-Pilot repo (e.g. installed in a user project) — skip.
    process.exit(0);
  }

  const repoRoot = path.dirname(path.dirname(validateScript));
  const result   = spawnSync('node', [validateScript], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    cwd: repoRoot,
  });

  const ok     = result.status === 0;
  const output = ((result.stdout || '') + (result.stderr || '')).trim().slice(0, 2000);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Setup',
      additionalContext:
        ok
          ? '[pilot-core/ci-setup] Plugin validator: all checks passed.'
          : `[pilot-core/ci-setup] Plugin validator found issues (fix before merging):\n${output}`,
    },
  }));
}

try {
  main();
} catch (e) {
  try {
    process.stderr.write(`[pilot-core/ci-setup] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
}
process.exit(0);
