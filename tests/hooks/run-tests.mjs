#!/usr/bin/env node
// Hook test runner — zero external dependencies.
// Each test sends a JSON payload to a hook script via stdin and checks stdout/exit.

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
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

// Assert a NON-BLOCKING advisory: exit 0, permissionDecision 'defer' (not deny),
// and a systemMessage present so the developer actually sees the warning.
function checkWarn(label, result) {
  const decision = result.json?.hookSpecificOutput?.permissionDecision;
  const ok = result.exit === 0 && decision === 'defer'
    && typeof result.json?.systemMessage === 'string' && result.json.systemMessage.length > 0;
  if (ok) {
    console.log(`    ✓ ${label}`);
    passed++;
  } else {
    console.error(`    ✗ ${label}`);
    console.error(`      exit=${result.exit} decision=${decision || 'none'} systemMessage=${result.json?.systemMessage ? 'yes' : 'no'} stderr=${result.stderr.slice(0, 120)}`);
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

// Build a MultiEdit PreToolUse payload (edits[] of {old_string, new_string})
function preMulti(filePath, newStrings) {
  const edits = newStrings.map((s) => ({ old_string: '', new_string: s }));
  return {
    hook_event_name: 'PreToolUse', tool_name: 'MultiEdit',
    tool_input: { file_path: filePath, edits }, cwd: os.tmpdir(),
  };
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

// V2 — Azure / cloud-provider secret shapes.
// Fake secrets are assembled from fragments so this source file itself does not trip the
// secret-guard hook when it is committed; the runtime value still matches.
const AWS_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE';
const GH_TOKEN = 'ghp_' + '0123456789abcdefghij0123456789abcdef';
const AZ_ACCOUNT_KEY = 'AccountKey=' + 'abcdEFGH1234ijklMNOP5678qrstUVWX90abcdEFGH==';
const AZ_SAS_KEY = 'SharedAccessKey=' + 'abcdEFGH1234ijklMNOP5678qrstUVWX90abcd=';

check('blocks Azure Storage AccountKey connection string',
  runHook('secret-guard.js', pre('Write', '/p/appsettings.json',
    'DefaultEndpointsProtocol=https;AccountName=devstore;' + AZ_ACCOUNT_KEY + ';EndpointSuffix=core.windows.net')),
  true);

check('blocks Service Bus SharedAccessKey connection string',
  runHook('secret-guard.js', pre('Write', '/p/appsettings.json',
    'Endpoint=sb://ns.servicebus.windows.net/;SharedAccessKeyName=Root;' + AZ_SAS_KEY)),
  true);

check('blocks AWS access key id',
  runHook('secret-guard.js', pre('Write', '/p/aws.ts',
    'const id = "' + AWS_KEY + '";')),
  true);

check('blocks GitHub token',
  runHook('secret-guard.js', pre('Write', '/p/ci.ts',
    'const t = "' + GH_TOKEN + '";')),
  true);

check('blocks secret introduced via MultiEdit edits[]',
  runHook('secret-guard.js', preMulti('/p/config.ts',
    ['const region = "eastus";', 'const key = "' + AWS_KEY + '";'])),
  true);

check('passes AccountKey placeholder (not a literal secret)',
  runHook('secret-guard.js', pre('Write', '/p/appsettings.json',
    'AccountName=devstore;AccountKey=<your-account-key>')),
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

checkWarn('warns (non-blocking, defer) on DateTime.Now when dotnet>=8 .csproj detected',
  runHook('dangerous-patterns.js', pre('Write', join(tmpDotnet8, 'Service.cs'),
    'var now = DateTime.Now;'),
    { CLAUDE_PROJECT_DIR: tmpDotnet8 }));

check('deny wins over warn: SQL concat + DateTime.Now in same net8 .cs file blocks',
  runHook('dangerous-patterns.js', pre('Write', join(tmpDotnet8, 'Repo.cs'),
    'var t = DateTime.Now; var sql = "SELECT * FROM Users WHERE Id = " + id;'),
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

check('blocks innerHTML introduced via MultiEdit edits[]',
  runHook('dangerous-patterns.js', preMulti('/p/app.component.ts',
    ['const safe = 1;', 'this.el.nativeElement.innerHTML = userInput;'])),
  true);

// V4 — interpolated SQL (warn) and tightened concat (no constant-only false positive)
checkWarn('warns (non-blocking) on interpolated SQL sink',
  runHook('dangerous-patterns.js', pre('Write', '/p/Repo.cs',
    'ctx.Database.ExecuteSqlRaw($"DELETE FROM Logs WHERE Id = {id}");'),
    { CLAUDE_PROJECT_DIR: os.tmpdir() }));

check('passes benign interpolated string (no SQL shape)',
  runHook('dangerous-patterns.js', pre('Write', '/p/Log.cs',
    'var msg = $"Loaded {count} rows from cache";')),
  false);

check('passes constant-only SQL concatenation (no variable injected)',
  runHook('dangerous-patterns.js', pre('Write', '/p/Q.cs',
    'var sql = "SELECT * FROM " + "Users";')),
  false);

// V6 — ReDoS guard: a catastrophic pattern in (user-extensible) config is skipped, never run.
// Point the hook at a throwaway plugin root whose config carries a nested-unbounded-quantifier
// pattern. If the guard regressed, running "(a+)+$" over 50 'a's + "!" would backtrack past the
// 8s timeout (exit != 0); with the guard it returns instantly, unblocked, with a stderr breadcrumb.
const tmpRedos = mkdtempSync(join(os.tmpdir(), 'pilot-core-redos-'));
mkdirSync(join(tmpRedos, 'hooks', 'config'), { recursive: true });
writeFileSync(join(tmpRedos, 'hooks', 'config', 'dangerous-patterns.json'), JSON.stringify({
  patterns: [{
    name: 'catastrophic-test', pattern: '(a+)+$', fileExtensions: ['.ts'],
    action: 'deny', message: 'should never run',
  }],
}));
{
  const r = runHook('dangerous-patterns.js', pre('Write', '/p/evil.ts', 'a'.repeat(50) + '!'),
    { CLAUDE_PLUGIN_ROOT: tmpRedos });
  const ok = r.exit === 0
    && r.json?.hookSpecificOutput?.permissionDecision !== 'deny'
    && /skipped pattern "catastrophic-test"/.test(r.stderr);
  if (ok) {
    console.log('    ✓ ReDoS guard skips catastrophic config pattern (no hang, breadcrumb)');
    passed++;
  } else {
    console.error('    ✗ ReDoS guard skips catastrophic config pattern');
    console.error(`      exit=${r.exit} decision=${r.json?.hookSpecificOutput?.permissionDecision || 'none'} stderr=${r.stderr.slice(0, 160)}`);
    failed++;
  }
}

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

// ── session-refresh tests ─────────────────────────────────────────────────────

console.log('\n  session-refresh');

{
  // Fresh project — no stack-profile.json yet
  const tmpFresh = mkdtempSync(join(os.tmpdir(), 'pilot-sr-fresh-'));
  const r = spawnSync('node', [join(SCRIPTS_DIR, 'session-refresh.js')], {
    input: '{}',
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: tmpFresh },
  });
  const ok = r.status === 0 && !JSON.parse(r.stdout || '{}').systemMessage;
  if (ok) { console.log('    ✓ exits 0 cleanly when no stack-profile.json present'); passed++; }
  else { console.error('    ✗ exits 0 cleanly when no stack-profile.json present'); failed++; }
}

{
  // Fresh profile (just written — age = ~0 days)
  const tmpRecent = mkdtempSync(join(os.tmpdir(), 'pilot-sr-recent-'));
  mkdirSync(join(tmpRecent, '.claude', 'pilot'), { recursive: true });
  writeFileSync(join(tmpRecent, '.claude', 'pilot', 'stack-profile.json'), '{"dotnet":"8"}');
  const r = spawnSync('node', [join(SCRIPTS_DIR, 'session-refresh.js')], {
    input: '{}',
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: tmpRecent },
  });
  const ok = r.status === 0 && !JSON.parse(r.stdout || '{}').systemMessage;
  if (ok) { console.log('    ✓ exits 0 silently when stack-profile.json is fresh'); passed++; }
  else { console.error('    ✗ exits 0 silently when stack-profile.json is fresh'); failed++; }
}

{
  // Kill-switch off
  const r = spawnSync('node', [join(SCRIPTS_DIR, 'session-refresh.js')], {
    input: '{}',
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
           CLAUDE_PLUGIN_OPTION_ENABLE_GOVERNANCE_HOOKS: 'false' },
  });
  const ok = r.status === 0 && !r.stdout;
  if (ok) { console.log('    ✓ exits 0 silently when enable_governance_hooks=false'); passed++; }
  else { console.error('    ✗ exits 0 silently when enable_governance_hooks=false'); failed++; }
}

// ── precompact-snapshot tests ────────────────────────────���────────────────────

console.log('\n  precompact-snapshot');

{
  // No findings.json — should exit 0, no output
  const tmpNoFindings = mkdtempSync(join(os.tmpdir(), 'pilot-pcs-empty-'));
  const r = spawnSync('node', [join(SCRIPTS_DIR, 'precompact-snapshot.js')], {
    input: '{}',
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: tmpNoFindings },
  });
  const ok = r.status === 0 && !r.stdout;
  if (ok) { console.log('    ✓ exits 0 silently when no findings.json present'); passed++; }
  else { console.error('    ✗ exits 0 silently when no findings.json present'); failed++; }
}

{
  // findings.json with P0 and P1 items — should emit systemMessage
  const tmpWithFindings = mkdtempSync(join(os.tmpdir(), 'pilot-pcs-findings-'));
  mkdirSync(join(tmpWithFindings, '.claude', 'pilot', 'audit'), { recursive: true });
  writeFileSync(
    join(tmpWithFindings, '.claude', 'pilot', 'audit', 'findings.json'),
    JSON.stringify([
      { id: 'F-001', severity: 'P0', title: 'SQL injection risk' },
      { id: 'F-002', severity: 'P1', title: 'Missing multitenancy filter' },
    ])
  );
  const r = spawnSync('node', [join(SCRIPTS_DIR, 'precompact-snapshot.js')], {
    input: '{}',
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PROJECT_DIR: tmpWithFindings },
  });
  const json = JSON.parse(r.stdout || '{}');
  const ok = r.status === 0 && typeof json.systemMessage === 'string'
    && json.systemMessage.includes('F-001') && json.systemMessage.includes('P0');
  if (ok) { console.log('    ✓ emits systemMessage summary when findings.json has open items'); passed++; }
  else { console.error('    ✗ emits systemMessage summary when findings.json has open items'); failed++; }
}

{
  // Kill-switch off
  const r = spawnSync('node', [join(SCRIPTS_DIR, 'precompact-snapshot.js')], {
    input: '{}',
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
           CLAUDE_PLUGIN_OPTION_ENABLE_GOVERNANCE_HOOKS: 'false' },
  });
  const ok = r.status === 0 && !r.stdout;
  if (ok) { console.log('    ✓ exits 0 silently when enable_governance_hooks=false'); passed++; }
  else { console.error('    ✗ exits 0 silently when enable_governance_hooks=false'); failed++; }
}

// ── triage-hint tests ─────────────────────────────────────────────────────────

console.log('\n  triage-hint');

function postFail(toolName, toolError) {
  return { hook_event_name: 'PostToolUseFailure', tool_name: toolName, tool_error: toolError };
}

{
  const r = runHook('triage-hint.js', postFail('Bash', 'sh: node: command not found'));
  const ctx = r.json?.hookSpecificOutput?.additionalContext;
  const ok = r.exit === 0 && typeof ctx === 'string' && ctx.includes('PATH');
  if (ok) { console.log('    ✓ emits PATH hint for Bash "command not found" failure'); passed++; }
  else { console.error('    ✗ emits PATH hint for Bash "command not found" failure'); failed++; }
}

{
  const r = runHook('triage-hint.js', postFail('Edit',
    'old_string not found in file: the content was not found verbatim'));
  const ctx = r.json?.hookSpecificOutput?.additionalContext;
  const ok = r.exit === 0 && typeof ctx === 'string' && ctx.includes('old_string');
  if (ok) { console.log('    ✓ emits old_string hint for Edit "not found" failure'); passed++; }
  else { console.error('    ✗ emits old_string hint for Edit "not found" failure'); failed++; }
}

{
  // Unknown error — no hint, but still exits 0
  const r = runHook('triage-hint.js', postFail('Read', 'some obscure error we do not cover'));
  const ok = r.exit === 0;
  if (ok) { console.log('    ✓ exits 0 silently for unknown tool error (no matching hint)'); passed++; }
  else { console.error('    ✗ exits 0 silently for unknown tool error (no matching hint)'); failed++; }
}

{
  const r = runHook('triage-hint.js', postFail('Bash', 'error'),
    { CLAUDE_PLUGIN_OPTION_ENABLE_GOVERNANCE_HOOKS: 'false' });
  const ok = r.exit === 0 && !r.stdout;
  if (ok) { console.log('    ✓ exits 0 silently when enable_governance_hooks=false'); passed++; }
  else { console.error('    ✗ exits 0 silently when enable_governance_hooks=false'); failed++; }
}

// ── ci-setup tests ────────────────────────────────────────────────────────────

console.log('\n  ci-setup');

{
  // Outside repo context — validate.mjs not found, exits 0 silently
  const r = spawnSync('node', [join(SCRIPTS_DIR, 'ci-setup.js')], {
    input: '{}',
    encoding: 'utf8',
    timeout: 40000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: os.tmpdir() },
  });
  const ok = r.status === 0 && !r.stdout;
  if (ok) { console.log('    ✓ exits 0 silently when outside repo context (no validate.mjs)'); passed++; }
  else { console.error('    ✗ exits 0 silently when outside repo context (no validate.mjs)'); failed++; }
}

{
  // In-repo with mock validate.mjs (avoids recursive validate→test→validate loop).
  // Create a temp repo skeleton: <tmp>/plugins/pilot-core/ and <tmp>/scripts/validate.mjs
  const tmpMock = mkdtempSync(join(os.tmpdir(), 'pilot-cs-mock-'));
  mkdirSync(join(tmpMock, 'plugins', 'pilot-core'), { recursive: true });
  mkdirSync(join(tmpMock, 'scripts'), { recursive: true });
  writeFileSync(join(tmpMock, 'scripts', 'validate.mjs'),
    '#!/usr/bin/env node\nconsole.log("mock validator: all checks passed.");\nprocess.exit(0);\n');
  const r = spawnSync('node', [join(SCRIPTS_DIR, 'ci-setup.js')], {
    input: '{}',
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(tmpMock, 'plugins', 'pilot-core') },
  });
  const json = JSON.parse(r.stdout || '{}');
  const ctx = json.hookSpecificOutput?.additionalContext;
  const ok = r.status === 0 && typeof ctx === 'string' && ctx.includes('[pilot-core/ci-setup]');
  if (ok) { console.log('    ✓ emits ci-setup additionalContext when validate.mjs is found'); passed++; }
  else { console.error('    ✗ emits ci-setup additionalContext when validate.mjs is found'); failed++; }
}

{
  const r = spawnSync('node', [join(SCRIPTS_DIR, 'ci-setup.js')], {
    input: '{}',
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: os.tmpdir(),
           CLAUDE_PLUGIN_OPTION_ENABLE_GOVERNANCE_HOOKS: 'false' },
  });
  const ok = r.status === 0 && !r.stdout;
  if (ok) { console.log('    ✓ exits 0 silently when enable_governance_hooks=false'); passed++; }
  else { console.error('    ✗ exits 0 silently when enable_governance_hooks=false'); failed++; }
}

// ── migration-verifier tests ──────────────────────────────────────────────────

console.log('\n  migration-verifier');

const SQL_SCRIPTS_DIR = join(ROOT, 'plugins/pilot-sql/hooks/scripts');
const SQL_PLUGIN_ROOT = join(ROOT, 'plugins/pilot-sql');

function runSqlHook(inputObj, extraEnv = {}) {
  const r = spawnSync('node', [join(SQL_SCRIPTS_DIR, 'migration-verifier.js')], {
    input: JSON.stringify(inputObj),
    encoding: 'utf8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: SQL_PLUGIN_ROOT, ...extraEnv },
  });
  let json = null;
  try { json = JSON.parse(r.stdout || ''); } catch (_) {}
  return { exit: r.status, json, stderr: r.stderr || '', stdout: r.stdout || '' };
}

check('passes non-migration .cs file (skips entirely)',
  runSqlHook(pre('Write', '/p/Services/UserService.cs',
    'public class UserService { }')),
  false);

check('passes clean migration (no destructive ops)',
  runSqlHook(pre('Write', '/p/Migrations/20240101_AddUsers.cs',
    'migrationBuilder.CreateTable("Users", t => { t.Column<int>("TenantId"); });')),
  false);

check('blocks DropColumn without approval annotation',
  runSqlHook(pre('Write', '/p/Migrations/20240102_DropLegacy.cs',
    'migrationBuilder.DropColumn("OldColumn", "Users");')),
  true);

check('passes DropColumn with pilot-sql approval annotation',
  runSqlHook(pre('Write', '/p/Migrations/20240102_DropLegacy.cs',
    '// pilot-sql: migration-safety approved\nmigrationBuilder.DropColumn("OldColumn", "Users");')),
  false);

checkWarn('warns on new table without tenant identifier (advisory)',
  runSqlHook(pre('Write', '/p/Migrations/20240103_AddAuditLog.cs',
    'migrationBuilder.CreateTable("AuditLog", t => { t.Column<int>("Id"); });')));

check('passes new table that includes TenantId',
  runSqlHook(pre('Write', '/p/Migrations/20240104_AddOrders.cs',
    'migrationBuilder.CreateTable("Orders", t => { t.Column<int>("TenantId"); });')),
  false);

check('passes migration verifier when kill-switch is off',
  runSqlHook(pre('Write', '/p/Migrations/20240102_Drop.cs',
    'migrationBuilder.DropColumn("OldCol", "T");'),
    { CLAUDE_PLUGIN_OPTION_ENABLE_MIGRATION_VERIFIER: 'false' }),
  false);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${'─'.repeat(50)}`);
const total = passed + failed;
console.log(`  ${passed}/${total} hook tests passed${failed ? ` — ${failed} FAILED` : ''}`);
if (failed > 0) process.exit(1);
