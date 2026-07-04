#!/usr/bin/env node
// Hook test runner — zero external dependencies.
// Each test sends a JSON payload to a hook script via stdin and checks stdout/exit.

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPTS_DIR = join(ROOT, 'plugins/pilot-core/hooks/scripts');
const PLUGIN_ROOT = join(ROOT, 'plugins/pilot-core');

let passed = 0;
let failed = 0;

// ── Infrastructure ────────────────────────────────────────────────────────────

function runHook(script, inputObj, extraEnv = {}) {
  const r = spawnSync('node', [join(SCRIPTS_DIR, script)], {
    input: JSON.stringify(inputObj),
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...extraEnv },
  });
  let json = null;
  try { json = JSON.parse(r.stdout || ''); } catch (_) {}
  return { exit: r.status, json, stderr: r.stderr || '', stdout: r.stdout || '' };
}

function check(label, result, expectBlock) {
  const decision = result.json?.hookSpecificOutput?.permissionDecision;
  const blocked = result.exit === 0 && decision === 'deny';
  const ok = expectBlock ? blocked : (!blocked && result.exit === 0);
  if (ok) {
    console.log(`    ✓ ${label}`);
    passed++;
  } else {
    console.error(`    ✗ ${label}`);
    console.error(`      exit=${result.exit} decision=${decision || 'none'} stderr=${result.stderr.slice(0, 120)}`);
    failed++;
  }
}

// Build a Write or Edit PreToolUse payload
function pre(toolName, filePath, content, isEdit = false) {
  const toolInput = isEdit
    ? { file_path: filePath, old_string: '', new_string: content }
    : { file_path: filePath, content };
  return { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, cwd: os.tmpdir() };
}

// ── secret-guard tests ────────────────────────────────────────────────────────

console.log('\n  secret-guard');

check('blocks connection string password (Write)',
  runHook('secret-guard.js', pre('Write', '/p/appsettings.json',
    '{"ConnectionStrings":{"Db":"Server=s;Database=d;Password=Sup3rSecr3t!"}}')),
  true);

check('blocks URL with embedded credentials (mongodb)',
  runHook('secret-guard.js', pre('Write', '/p/db.ts',
    'const uri = "mongodb://admin:SecretPassw0rd@cluster.example.net/db";')),
  true);

check('blocks API key assignment',
  runHook('secret-guard.js', pre('Write', '/p/config.ts',
    'const apiKey = "sk-abc123defghijklmn456opqrstuvwxyz";')),
  true);

check('blocks JWT token literal',
  runHook('secret-guard.js', pre('Write', '/p/auth.ts',
    'const t="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";')),
  true);

check('blocks PEM private key',
  runHook('secret-guard.js', pre('Write', '/p/key.pem',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----')),
  true);

check('blocks high-entropy password assignment (Edit)',
  runHook('secret-guard.js', pre('Edit', '/p/config.ts',
    'password: "H@rdcodedP@ssw0rd123456!"', true)),
  true);

check('passes clean TypeScript (no secrets)',
  runHook('secret-guard.js', pre('Write', '/p/hello.ts',
    'export function greet(name: string): string { return `Hello, ${name}!`; }')),
  false);

check('passes environment variable reference (not a literal secret)',
  runHook('secret-guard.js', pre('Write', '/p/config.ts',
    'const password = process.env.DB_PASSWORD;')),
  false);

check('passes connection string with ${VAR} placeholder (not a literal secret)',
  runHook('secret-guard.js', pre('Write', '/p/appsettings.json',
    '{"ConnectionStrings":{"Db":"Server=s;Database=d;Password=${DB_PASSWORD}"}}')),
  false);

check('passes empty content',
  runHook('secret-guard.js', pre('Write', '/p/empty.ts', '')),
  false);

check('fails open on malformed input (no crash)',
  runHook('secret-guard.js', { not_a_valid_payload: true }),
  false);

// ── dangerous-patterns tests ──────────────────────────────────────────────────

console.log('\n  dangerous-patterns');

check('blocks innerHTML assignment in .ts',
  runHook('dangerous-patterns.js', pre('Write', '/p/app.component.ts',
    'this.el.nativeElement.innerHTML = userInput;')),
  true);

check('blocks innerHTML assignment in .html',
  runHook('dangerous-patterns.js', pre('Write', '/p/template.html',
    '<script>el.innerHTML = untrustedData;</script>')),
  true);

check('does NOT block safe Angular [innerHTML] binding in .html',
  runHook('dangerous-patterns.js', pre('Write', '/p/template.html',
    '<div [innerHTML]="sanitizedContent"></div>')),
  false);

check('blocks SQL string concatenation in .cs',
  runHook('dangerous-patterns.js', pre('Write', '/p/UserRepo.cs',
    'var sql = "SELECT * FROM Users WHERE Id = " + userId;')),
  true);

check('passes DateTime.Now in .cs without dotnet>=8 context (fail open)',
  runHook('dangerous-patterns.js', pre('Write', '/p/Service.cs',
    'var now = DateTime.Now;'),
    { CLAUDE_PROJECT_DIR: os.tmpdir() }),
  false);

// Create a temp dir with a net8 .csproj to simulate dotnet>=8 project
const tmpDotnet8 = mkdtempSync(join(os.tmpdir(), 'pilot-core-d8-'));
writeFileSync(join(tmpDotnet8, 'MyApp.csproj'),
  '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>' +
  '<TargetFramework>net8.0</TargetFramework>' +
  '</PropertyGroup></Project>');

check('blocks DateTime.Now in .cs when dotnet>=8 .csproj detected',
  runHook('dangerous-patterns.js', pre('Write', join(tmpDotnet8, 'Service.cs'),
    'var now = DateTime.Now;'),
    { CLAUDE_PROJECT_DIR: tmpDotnet8 }),
  true);

check('passes clean .cs file',
  runHook('dangerous-patterns.js', pre('Write', '/p/Clean.cs',
    'public class MyService { public void Run() { _logger.LogInformation("started"); } }')),
  false);

check('passes .ts file without innerHTML',
  runHook('dangerous-patterns.js', pre('Write', '/p/safe.ts',
    'this.renderer.setProperty(el, "textContent", value);')),
  false);

check('does NOT apply .ts patterns to .cs files',
  runHook('dangerous-patterns.js', pre('Write', '/p/View.cs',
    'el.innerHTML = value; // C# view engine, not subject to the .ts rule')),
  false);

// ── formatter tests ───────────────────────────────────────────────────────────

console.log('\n  formatter');

function postPay(filePath) {
  return { hook_event_name: 'PostToolUse', tool_name: 'Write',
    tool_input: { file_path: filePath }, cwd: os.tmpdir() };
}

const fmtNoConfig = runHook('formatter.js', postPay('/tmp/hello.ts'));
check('exits 0 when no prettier config present', fmtNoConfig, false);

const fmtEmptyPath = runHook('formatter.js',
  { hook_event_name: 'PostToolUse', tool_name: 'Write',
    tool_input: { file_path: '' }, cwd: os.tmpdir() });
check('exits 0 with empty file_path (graceful skip)', fmtEmptyPath, false);

const fmtBadJson = runHook('formatter.js', { corrupted: true });
check('exits 0 on malformed payload (fail open)', fmtBadJson, false);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${'─'.repeat(50)}`);
const total = passed + failed;
console.log(`  ${passed}/${total} hook tests passed${failed ? ` — ${failed} FAILED` : ''}`);
if (failed > 0) process.exit(1);
