#!/usr/bin/env node
'use strict';
// PostToolUse hook — formatter
// Runs Prettier on the touched file when .prettierrc exists in the project.
// Runs dotnet format --include <file> when .editorconfig + .csproj context exists.
// Operates ONLY on the file path in the tool payload.
// Always exits 0 (fail open) — formatting failure must never block the developer.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PRETTIER_CONFIGS = [
  '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs',
  '.prettierrc.mjs', '.prettierrc.yml', '.prettierrc.yaml',
  'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs',
];

function hasPrettierConfig(dir) {
  try {
    return PRETTIER_CONFIGS.some(f => fs.existsSync(path.join(dir, f)));
  } catch (_) {
    return false;
  }
}

function hasDotnetContext(dir) {
  try {
    if (!fs.existsSync(path.join(dir, '.editorconfig'))) return false;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.some(e => e.isFile() && e.name.endsWith('.csproj'));
  } catch (_) {
    return false;
  }
}

// Walk up from filePath up to 4 levels to find the nearest .sln or .csproj.
// No recursion downward — only upward traversal.
function findProjectFile(startDir) {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const found = entries.find(e => e.isFile() && (e.name.endsWith('.sln') || e.name.endsWith('.csproj')));
      if (found) return path.join(dir, found.name);
    } catch (_) {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// On Windows the npx launcher is `npx.cmd`; Node's spawn cannot resolve the bare `npx`
// shim (ENOENT), which silently disables formatting. Resolve the platform-correct binary.
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function runPrettier(filePath) {
  const r = spawnSync(NPX_BIN, ['--no-install', 'prettier', '--write', filePath], {
    encoding: 'utf8',
    timeout: 8000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0 && r.stderr) {
    process.stderr.write(`[pilot-core/formatter] prettier: ${r.stderr.slice(0, 200)}\n`);
  }
}

function runDotnetFormat(filePath) {
  const proj = findProjectFile(path.dirname(filePath));
  if (!proj) return;
  const r = spawnSync('dotnet', ['format', proj, '--include', filePath], {
    encoding: 'utf8',
    timeout: 8000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0 && r.stderr) {
    process.stderr.write(`[pilot-core/formatter] dotnet format: ${r.stderr.slice(0, 200)}\n`);
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

  const filePath = String((payload.tool_input || {}).file_path || '');
  if (!filePath) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || path.dirname(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isCs = ext === '.cs';

  if (isCs && hasDotnetContext(projectDir)) {
    runDotnetFormat(filePath);
  } else if (!isCs && hasPrettierConfig(projectDir)) {
    runPrettier(filePath);
  }

  process.exit(0);
}

try {
  main();
} catch (_) {
  process.exit(0);
}
