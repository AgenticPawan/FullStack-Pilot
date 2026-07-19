#!/usr/bin/env node
'use strict';
// PreToolUse hook — bash destructive command guard
// Intercepts Bash tool calls and blocks or warns on destructive operations.
// Covers git, database, Azure CLI, and Angular/npm destructive patterns.
// Always exits 0 (fail open) — a crash must never block the developer.

const fs = require('node:fs');

// Hard-blocked patterns: commands that can irreversibly destroy state.
// Each entry: { pattern: RegExp, message: string }
const DENY_PATTERNS = [
  {
    re: /git\s+push\s+(?:--force|-f)(?:\s|$)/,
    message: 'git push --force is blocked. Create a PR or ask for explicit confirmation.',
  },
  {
    re: /git\s+reset\s+--hard(?:\s|$)/,
    message: 'git reset --hard discards uncommitted work. Stash changes first if they matter.',
  },
  {
    re: /git\s+checkout\s+--\s*\./,
    message: 'git checkout -- . discards all unstaged changes. Use git stash if work should be saved.',
  },
  {
    re: /git\s+clean\s+(?:[^\s]*)?-f/,
    message: 'git clean -f permanently removes untracked files. Run git status first.',
  },
  {
    re: /\bDROP\s+TABLE\b/i,
    message: 'DROP TABLE detected outside a review context. Use EF Core migrations for schema removal.',
  },
  {
    re: /\bDELETE\s+FROM\s+\w+\s*(?:;|$)/i,
    message: 'DELETE without a WHERE clause will remove all rows. Add a WHERE clause or use TRUNCATE intentionally.',
  },
  {
    re: /az\s+(?:deployment|webapp|functionapp|containerapp)\s+(?:create|delete|update)\b.*--subscription/,
    message: 'Azure deployment command with --subscription detected. Verify you are targeting the correct environment and branch.',
  },
];

// Advisory warnings: suspicious but not categorically wrong.
const WARN_PATTERNS = [
  {
    re: /rm\s+-rf?\s+(?!.*(?:node_modules|bin|obj|dist|\.angular|\.cache|TestResults|\.vs|\/tmp|temp))/,
    message: 'rm -rf targeting a non-standard directory. Verify this is intentional.',
  },
  {
    re: /ng\s+build\s+(?:--configuration\s+production|--prod)/,
    message: 'Production Angular build detected. Confirm the correct environment configuration is active.',
  },
  {
    re: /dotnet\s+ef\s+database\s+drop/,
    message: 'dotnet ef database drop will destroy the database. Use migrations for controlled schema changes.',
  },
  {
    re: /npm\s+(?:install|ci)\s+--legacy-peer-deps/,
    message: '--legacy-peer-deps bypasses peer dependency validation. Ensure this is intentional.',
  },
];

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

  // Only intercept Bash tool calls
  if ((payload.tool_name || '') !== 'Bash') {
    process.exit(0);
  }

  const command = String((payload.tool_input || {}).command || '');
  if (!command.trim()) process.exit(0);

  // Hard deny — first match wins
  for (const { re, message } of DENY_PATTERNS) {
    if (re.test(command)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `[pilot-core/bash-guard] Blocked: ${message}`,
        },
      }));
      process.exit(0);
    }
  }

  // Advisory warnings — collect all, then surface
  const warnings = [];
  for (const { re, message } of WARN_PATTERNS) {
    if (re.test(command)) warnings.push(message);
  }

  if (warnings.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
        permissionDecisionReason: '[pilot-core/bash-guard] Advisory only — not blocked.',
      },
      systemMessage:
        `[pilot-core/bash-guard] ${warnings.length} advisory warning(s):\n  - ` +
        warnings.join('\n  - '),
    }));
    process.exit(0);
  }

  process.exit(0);
}

try {
  main();
} catch (e) {
  try {
    process.stderr.write(`[pilot-core/bash-guard] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
  process.exit(0);
}
