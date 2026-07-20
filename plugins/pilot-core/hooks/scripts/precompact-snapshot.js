#!/usr/bin/env node
'use strict';
// PreCompact hook — audit findings snapshot.
// Prints a compact summary of open pilot findings before context compaction so
// Claude can re-anchor on them after the compact window resets.
// Kill-switch: set enable_governance_hooks=false in pilot-core userConfig.
// Always exits 0 — compaction must never be blocked by a snapshot failure.

const fs   = require('node:fs');
const path = require('node:path');

const MAX_PER_SEVERITY = 3; // lines shown per severity bucket before "…and N more"

function main() {
  if (process.env.CLAUDE_PLUGIN_OPTION_ENABLE_GOVERNANCE_HOOKS === 'false') {
    process.exit(0);
  }

  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const findingsPath = path.join(cwd, '.claude', 'pilot', 'audit', 'findings.json');

  if (!fs.existsSync(findingsPath)) process.exit(0);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  } catch (_) {
    process.exit(0);
  }

  // Accept both a bare array and { findings: [...] }
  const all = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.findings) ? parsed.findings : []);
  if (all.length === 0) process.exit(0);

  // Group by severity, preserving P0 > P1 > P2 > P3 order
  const ORDER = ['P0', 'P1', 'P2', 'P3'];
  const bySeverity = {};
  for (const f of all) {
    const sev = String(f.severity || 'P3');
    if (!bySeverity[sev]) bySeverity[sev] = [];
    bySeverity[sev].push(f);
  }

  const lines = [`[pilot-core] Open findings before compaction (${all.length} total):`];
  const keys = ORDER.filter(k => bySeverity[k]).concat(
    Object.keys(bySeverity).filter(k => !ORDER.includes(k)).sort());

  for (const sev of keys) {
    const items = bySeverity[sev];
    lines.push(`  ${sev}: ${items.length}`);
    items.slice(0, MAX_PER_SEVERITY).forEach(f => {
      lines.push(`    - [${f.id || '?'}] ${String(f.title || f.message || '').slice(0, 80)}`);
    });
    if (items.length > MAX_PER_SEVERITY) {
      lines.push(`    … and ${items.length - MAX_PER_SEVERITY} more`);
    }
  }
  lines.push('Run /fsp-audit for the full report.');

  process.stdout.write(JSON.stringify({ systemMessage: lines.join('\n') }));
}

try {
  main();
} catch (e) {
  try {
    process.stderr.write(
      `[pilot-core/precompact-snapshot] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
}
process.exit(0);
