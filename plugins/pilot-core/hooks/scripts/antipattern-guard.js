#!/usr/bin/env node
'use strict';
// PreToolUse hook — multi-stack antipattern guard
// Scans content being written for code quality antipatterns across Angular, .NET, and SQL.
// Complements dangerous-patterns.js (security) and secret-guard.js (secrets).
// Action is always 'warn' (advisory) — never blocks. Exit 0 always (fail open).

const fs = require('node:fs');
const path = require('node:path');

// Per-extension advisory patterns.
// { ext: string[], re: RegExp, name: string, message: string }
const ADVISORIES = [
  // ── Angular / TypeScript ──────────────────────────────────────────────────
  {
    ext: ['.ts'],
    re: /\bconsole\.(log|warn|error|debug|info)\s*\(/,
    name: 'CONSOLE_LOG_IN_TS',
    message:
      'console.log/warn/error in TypeScript — use structured telemetry (inject a logger service) ' +
      'instead of console. Remove before committing.',
    skipIfPathContains: ['.spec.', '.test.', '/test/', '/tests/', '/e2e/'],
  },
  {
    ext: ['.ts'],
    re: /\.subscribe\s*\(/,
    name: 'SUBSCRIBE_WITHOUT_TAKEUNTILDESTROYED',
    message:
      'subscribe() detected. Ensure the subscription is cleaned up via takeUntilDestroyed(this.destroyRef) ' +
      'or async pipe. Uncleaned subscriptions cause memory leaks.',
    skipIfContentContains: ['takeUntilDestroyed', 'takeUntil(', 'async pipe'],
  },
  {
    ext: ['.ts'],
    re: /\bngOnDestroy\b/,
    name: 'NGONDESTROY_BOILERPLATE',
    message:
      'ngOnDestroy detected. Angular 16+ prefers takeUntilDestroyed(this.destroyRef) over ' +
      'a Subject+ngOnDestroy pattern for subscription cleanup.',
    skipIfPathContains: ['.spec.', '.test.'],
  },
  {
    ext: ['.ts', '.html'],
    re: /:\s*any\b/,
    name: 'ANY_TYPE_IN_ANGULAR',
    message:
      ': any type weakens Angular\'s type safety. Use a concrete interface, unknown, or a generic type instead.',
    skipIfPathContains: ['.spec.', '.test.', 'd.ts'],
  },
  // ── .NET / C# ─────────────────────────────────────────────────────────────
  {
    ext: ['.cs'],
    re: /\bnew\s+HttpClient\s*\(/,
    name: 'NEW_HTTPCLIENT_DIRECT',
    message:
      'new HttpClient() causes socket exhaustion. Inject IHttpClientFactory and call ' +
      'factory.CreateClient() instead.',
  },
  {
    ext: ['.cs'],
    re: /\bConsole\s*\.\s*(?:Write|WriteLine)\s*\(/,
    name: 'CONSOLE_WRITELINE_IN_CS',
    message:
      'Console.WriteLine in non-test C# — use ILogger<T> with structured message templates instead.',
    skipIfPathContains: ['.Tests.', '.Test.', 'Tests/', 'Program.cs'],
  },
  {
    ext: ['.cs'],
    re: /\basync\s+void\b(?!\s*\w+\s*\(.*\bEventArgs\b)/,
    name: 'ASYNC_VOID',
    message:
      'async void swallows exceptions. Return Task instead. Exception: event handlers (EventArgs parameter).',
  },
  {
    ext: ['.cs'],
    re: /\.Result\b|\.GetAwaiter\(\)\.GetResult\(\)/,
    name: 'SYNC_OVER_ASYNC',
    message:
      '.Result and .GetAwaiter().GetResult() cause deadlocks in ASP.NET Core contexts. Use await throughout.',
  },
  // ── SQL / Migrations ──────────────────────────────────────────────────────
  {
    ext: ['.cs'],
    re: /SELECT\s+\*/i,
    name: 'SELECT_STAR_IN_MIGRATION',
    message:
      'SELECT * in a migration or query file — select only the columns you need. ' +
      'SELECT * breaks when columns are added or reordered.',
    skipIfPathContains: ['.spec.', '.test.'],
  },
];

function isSkipped(entry, filePath, content) {
  if (entry.skipIfPathContains) {
    for (const fragment of entry.skipIfPathContains) {
      if (filePath.replace(/\\/g, '/').includes(fragment)) return true;
    }
  }
  if (entry.skipIfContentContains) {
    for (const fragment of entry.skipIfContentContains) {
      if (content.includes(fragment)) return true;
    }
  }
  return false;
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

  const toolName = payload.tool_name || '';
  const input = payload.tool_input || {};
  const filePath = String(input.file_path || '');
  const ext = path.extname(filePath).toLowerCase();

  let content;
  if (toolName === 'Write') {
    content = String(input.content ?? '');
  } else if (toolName === 'Edit') {
    content = String(input.new_string ?? '');
  } else if (toolName === 'MultiEdit') {
    content = Array.isArray(input.edits)
      ? input.edits.map((e) => String((e && e.new_string) ?? '')).join('\n')
      : '';
  } else {
    process.exit(0);
  }

  const warnings = [];

  for (const entry of ADVISORIES) {
    if (!entry.ext.includes(ext)) continue;
    if (isSkipped(entry, filePath, content)) continue;
    if (!entry.re.test(content)) continue;
    warnings.push(`${entry.name}: ${entry.message}`);
  }

  if (warnings.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
        permissionDecisionReason: '[pilot-core/antipattern-guard] Advisory only — not blocked.',
      },
      systemMessage:
        `[pilot-core/antipattern-guard] ${warnings.length} code quality advisory(s) in ${path.basename(filePath)}:\n  - ` +
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
    process.stderr.write(`[pilot-core/antipattern-guard] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
  process.exit(0);
}
