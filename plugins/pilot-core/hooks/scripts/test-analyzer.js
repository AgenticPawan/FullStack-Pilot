#!/usr/bin/env node
'use strict';
// PostToolUse hook — test result analyzer
// After a Bash tool call that ran dotnet test or ng test, parses the output,
// produces a 3-line summary, and writes it to .claude/last-test-run.md.
// Always exits 0 (fail open) — never blocks the developer.

const fs = require('node:fs');
const path = require('node:path');

// Check whether the command looks like a test invocation
function isTestCommand(cmd) {
  return /\bdotnet\s+test\b/.test(cmd) || /\bng\s+test\b/.test(cmd);
}

// ── dotnet test parser ────────────────────────────────────────────────────────
// Looks for lines like: "Passed! - Failed: 0, Passed: 47, Skipped: 2, Total: 49"
function parseDotnetOutput(output) {
  let passed = 0; let failed = 0; let skipped = 0;
  const summaryRe = /Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+)/gi;
  let m;
  while ((m = summaryRe.exec(output)) !== null) {
    failed  += parseInt(m[1], 10);
    passed  += parseInt(m[2], 10);
    skipped += parseInt(m[3], 10);
  }
  if (passed + failed + skipped === 0) return null;
  return { passed, failed, skipped, runner: 'dotnet test' };
}

// ── ng test parser ────────────────────────────────────────────────────────────
// Karma / Jest JSON summary lines: "X specs, Y failures" or "Tests: X passed, Y failed"
function parseNgOutput(output) {
  let passed = 0; let failed = 0; let skipped = 0;

  // Karma: "X specs, Y failures, Z skipped"
  const karmaRe = /(\d+)\s+spec[s]?(?:,\s*(\d+)\s+failure[s]?)?(?:,\s*(\d+)\s+skipped)?/i;
  const km = karmaRe.exec(output);
  if (km) {
    const total = parseInt(km[1], 10);
    failed  = km[2] ? parseInt(km[2], 10) : 0;
    skipped = km[3] ? parseInt(km[3], 10) : 0;
    passed  = total - failed - skipped;
    if (passed + failed + skipped > 0) return { passed, failed, skipped, runner: 'ng test (Karma)' };
  }

  // Jest: "Tests: X passed, Y failed, Z skipped"
  const jestRe = /Tests:\s+(?:(\d+)\s+passed)?(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?/i;
  const jm = jestRe.exec(output);
  if (jm) {
    passed  = jm[1] ? parseInt(jm[1], 10) : 0;
    failed  = jm[2] ? parseInt(jm[2], 10) : 0;
    skipped = jm[3] ? parseInt(jm[3], 10) : 0;
    if (passed + failed + skipped > 0) return { passed, failed, skipped, runner: 'ng test (Jest)' };
  }

  return null;
}

function writeSummary(projectDir, summary, command) {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const status = summary.failed > 0 ? 'FAILED' : 'PASSED';
  const icon   = summary.failed > 0 ? '🔴' : '✅';

  const lines = [
    `# Last Test Run — ${timestamp}`,
    '',
    `**Runner:** ${summary.runner}`,
    `**Command:** \`${command.slice(0, 120)}\``,
    `**Result:** ${icon} ${status}`,
    '',
    `| Passed | Failed | Skipped | Total |`,
    `|--------|--------|---------|-------|`,
    `| ${summary.passed} | ${summary.failed} | ${summary.skipped} | ${summary.passed + summary.failed + summary.skipped} |`,
  ];

  try {
    const claudeDir = path.join(projectDir, '.claude');
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: false });
    fs.writeFileSync(path.join(claudeDir, 'last-test-run.md'), lines.join('\n') + '\n', 'utf8');
  } catch (_) {
    // Non-fatal — the summary goes to systemMessage regardless
  }

  return lines.join('\n');
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

  // Only intercept Bash PostToolUse
  if ((payload.tool_name || '') !== 'Bash') process.exit(0);

  const command = String((payload.tool_input || {}).command || '');
  if (!isTestCommand(command)) process.exit(0);

  // Output is in tool_response
  const output = String(
    payload.tool_response?.content?.[0]?.text ||
    payload.tool_response?.output ||
    payload.output ||
    ''
  );

  if (!output.trim()) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();

  // Try dotnet test first, then ng test
  let summary = parseDotnetOutput(output) || parseNgOutput(output);
  if (!summary) process.exit(0);

  const report = writeSummary(projectDir, summary, command);

  const status = summary.failed > 0 ? 'FAILED' : 'PASSED';
  process.stdout.write(JSON.stringify({
    systemMessage:
      `[pilot-core/test-analyzer] ${summary.runner} — ${status}: ` +
      `${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped. ` +
      `Summary → .claude/last-test-run.md`,
  }));

  process.exit(0);
}

try {
  main();
} catch (e) {
  try {
    process.stderr.write(`[pilot-core/test-analyzer] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
  process.exit(0);
}
