#!/usr/bin/env node
'use strict';
// PreToolUse hook — secret guard
// Scans ONLY the content being written for known secret patterns.
// Emits the pattern NAME on match, never the secret value.
// Always exits 0 (fail open) — a crash here must never block the developer.

const fs = require('node:fs');

const PATTERNS = [
  {
    name: 'URL_EMBEDDED_CREDENTIALS',
    // scheme://user:password@host  (password must be 4+ non-whitespace, non-@ chars)
    re: /(?:https?|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:@\s]{1,64}:[^@\s]{4,}@/i,
  },
  {
    name: 'CONNECTION_STRING_WITH_PASSWORD',
    // password=value in ADO.NET / connection-string format — not a placeholder.
    // Excludes: <placeholder>, %env%, {value}, ${VAR}, @VAR, whitespace-only values.
    re: /(?:password|pwd)=(?![<{%$@\s\\])[^\s;'"\\]{4,}/i,
  },
  {
    name: 'API_KEY_ASSIGNMENT',
    // apiKey / api_key / api-key = "value"  (8+ chars, not a template expression)
    re: /\b(?:api[_-]?key|api[_-]?secret)\s*[:=]\s*["'][^"'$`{<>]{8,}["']/i,
  },
  {
    name: 'JWT_TOKEN',
    // Three base64url segments — standard JWT shape
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    name: 'PEM_PRIVATE_KEY',
    re: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/,
  },
  {
    name: 'HIGH_ENTROPY_SECRET_ASSIGNMENT',
    // variable name screams "secret" + long literal string (not a template/env ref)
    re: /\b(?:secret|password|passwd|pwd|token)\s*[:=]\s*["'][^"'$`{<>\s]{12,}["']/i,
  },
  {
    name: 'AZURE_STORAGE_OR_SB_KEY',
    // AccountKey=<base64> (Storage) or SharedAccessKey=<base64> (Service Bus/Event Hub).
    // Requires a real 20+ char base64 value; excludes placeholders (<, {, %, $, @).
    re: /(?:AccountKey|SharedAccessKey)=(?![<{%$@\s])[A-Za-z0-9+/]{20,}={0,2}/i,
  },
  {
    name: 'AZURE_SAS_TOKEN',
    // SAS signature query component — sig=<url-encoded base64>, 40+ chars.
    re: /[?&]sig=(?![<{%$@\s])[A-Za-z0-9%+/]{40,}/i,
  },
  {
    name: 'AWS_ACCESS_KEY_ID',
    // AKIA/ASIA/AGPA/AIDA + 16 uppercase alphanumerics — AWS key-id shape.
    re: /\b(?:AKIA|ASIA|AGPA|AIDA)[0-9A-Z]{16}\b/,
  },
  {
    name: 'GITHUB_TOKEN',
    // ghp_/gho_/ghu_/ghs_/ghr_ personal/app/refresh tokens.
    re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  },
  {
    name: 'GOOGLE_API_KEY',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    name: 'SLACK_TOKEN',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    name: 'STRIPE_SECRET_KEY',
    re: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/,
  },
];

function main() {
  let raw;
  try {
    raw = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
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

  // Scan ONLY the content being written — never the whole repo
  let content;
  if (toolName === 'Write') {
    content = String(input.content ?? '');
  } else if (toolName === 'Edit') {
    content = String(input.new_string ?? '');
  } else if (toolName === 'MultiEdit') {
    // MultiEdit applies an array of {old_string, new_string} — scan every new value.
    content = Array.isArray(input.edits)
      ? input.edits.map((e) => String((e && e.new_string) ?? '')).join('\n')
      : '';
  } else {
    process.exit(0);
  }

  for (const { name, re } of PATTERNS) {
    if (re.test(content)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `[pilot-core/secret-guard] Blocked: ${name} pattern detected. ` +
            `Remove the literal secret and use environment variables or a secrets manager instead.`,
        },
      }));
      process.exit(0);
    }
  }

  process.exit(0); // clean — allow the write
}

try {
  main();
} catch (e) {
  // Fail open — a guard crash must never block the developer — but leave a breadcrumb on
  // stderr so a silent non-run is observable. Does not affect the permission flow.
  try {
    process.stderr.write(`[pilot-core/secret-guard] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
  process.exit(0);
}
