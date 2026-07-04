#!/usr/bin/env node
'use strict';
// PreToolUse hook — dangerous-pattern guard
// Checks the content being written against a user-extensible JSON pattern file.
// Operates ONLY on the file path in the tool payload — no repo-wide scans.
// Always exits 0 (fail open).

const fs = require('node:fs');
const path = require('node:path');

// CLAUDE_PLUGIN_ROOT is set by Claude Code at runtime; fall back for local dev / tests
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  || path.resolve(__dirname, '../..');

function loadPatterns() {
  try {
    const cfg = path.join(PLUGIN_ROOT, 'hooks', 'config', 'dangerous-patterns.json');
    return JSON.parse(fs.readFileSync(cfg, 'utf8')).patterns || [];
  } catch (_) {
    return [];
  }
}

// Detect whether the immediate project directory contains a net8+ .csproj.
// Does NOT recurse — reads only files in the provided directory.
function detectDotnetGte8(projectDir) {
  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    const csproj = entries.find(e => e.isFile() && e.name.endsWith('.csproj'));
    if (!csproj) return false;
    const xml = fs.readFileSync(path.join(projectDir, csproj.name), 'utf8');
    const m = xml.match(/<TargetFrameworks?>\s*([^<]+)\s*<\/TargetFrameworks?>/i);
    if (!m) return false;
    return m[1].split(';').some(fw => {
      const n = fw.trim().match(/^net(\d+)/i);
      return n && parseInt(n[1], 10) >= 8;
    });
  } catch (_) {
    return false; // fail open — can't determine version
  }
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

  // Scan ONLY the content being written — never the whole repo
  let content;
  if (toolName === 'Write') {
    content = String(input.content ?? '');
  } else if (toolName === 'Edit') {
    content = String(input.new_string ?? '');
  } else {
    process.exit(0);
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const patterns = loadPatterns();

  for (const pat of patterns) {
    if (!Array.isArray(pat.fileExtensions) || !pat.fileExtensions.includes(ext)) continue;

    if (pat.requireStackProfile) {
      const req = pat.requireStackProfile;
      if (req.dotnet === '>=8' && !detectDotnetGte8(projectDir)) continue;
    }

    let re;
    try {
      re = new RegExp(pat.pattern);
    } catch (_) {
      continue; // bad pattern in config — skip, don't crash
    }

    if (re.test(content)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `[pilot-core/dangerous-patterns] Blocked: ${pat.name}. ${pat.message}`,
        },
      }));
      process.exit(0);
    }
  }

  process.exit(0);
}

try {
  main();
} catch (_) {
  process.exit(0);
}
