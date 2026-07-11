#!/usr/bin/env node
// validate.mjs — zero-dependency CI validator for fullstack-pilot
//
// Docs consulted (2026-07-04):
//   https://code.claude.com/docs/en/plugins-reference.md
//   https://code.claude.com/docs/en/plugin-marketplaces.md
//   https://code.claude.com/docs/en/skills.md
//   https://code.claude.com/docs/en/hooks.md
//
// Checks:
//   1. .claude-plugin/marketplace.json — valid JSON, required fields present,
//      each plugin entry has name + source
//   2. **/​.claude-plugin/plugin.json — valid JSON, required field "name" present
//   3. **/SKILL.md — YAML frontmatter present, description ≤ 1024 chars
//   4. **/hooks/hooks.json — valid JSON, every command-type hook script exists
//      and (on non-Windows) is executable

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WINDOWS = process.platform === 'win32';
const SEP = path.sep;

let errors = 0;

function fail(msg) {
  console.error(`  ✗ FAIL  ${msg}`);
  errors++;
}

function pass(msg) {
  console.log(`  ✓ pass  ${msg}`);
}

function info(msg) {
  console.log(`  – info  ${msg}`);
}

let warnings = 0;
function warn(msg) {
  console.log(`  ! warn  ${msg}`);
  warnings++;
}

// ─── Directory walker ────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'bin', 'obj', 'dist', 'build', '.cache', '.turbo',
]);

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else {
      yield full;
    }
  }
}

// ─── JSON parser ─────────────────────────────────────────────────────────────

function readJSON(filePath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── YAML frontmatter parser (single-level keys, no external deps) ───────────

function parseFrontmatter(content) {
  // Must begin with exactly "---" on its own line
  if (!content.startsWith('---')) return null;
  const afterOpen = content.indexOf('\n');
  if (afterOpen === -1) return null;
  const body = content.slice(afterOpen + 1);
  // Find the closing ---
  const closeMatch = body.match(/^---[ \t]*$/m);
  if (!closeMatch) return null;
  const yamlBlock = body.slice(0, closeMatch.index);
  const fm = {};
  for (const line of yamlBlock.split('\n')) {
    const m = line.match(/^([\w-]+)\s*:\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    fm[m[1]] = val;
  }
  return fm;
}

// ─── 1. marketplace.json ─────────────────────────────────────────────────────

console.log('\n── marketplace.json ───────────────────────────────────────');
const mktPath = path.join(ROOT, '.claude-plugin', 'marketplace.json');

if (!fs.existsSync(mktPath)) {
  fail(`not found: ${path.relative(ROOT, mktPath)}`);
} else {
  const { ok, data, error } = readJSON(mktPath);
  if (!ok) {
    fail(`.claude-plugin/marketplace.json: invalid JSON — ${error}`);
  } else {
    let mktOk = true;
    if (typeof data.name !== 'string' || !data.name.trim()) {
      fail('.claude-plugin/marketplace.json: missing required field "name" (string)'); mktOk = false;
    }
    if (!data.owner || typeof data.owner !== 'object') {
      fail('.claude-plugin/marketplace.json: missing required field "owner" (object)'); mktOk = false;
    } else if (typeof data.owner.name !== 'string' || !data.owner.name.trim()) {
      fail('.claude-plugin/marketplace.json: missing required field "owner.name" (string)'); mktOk = false;
    }
    if (!Array.isArray(data.plugins)) {
      fail('.claude-plugin/marketplace.json: missing required field "plugins" (array)'); mktOk = false;
    } else {
      for (const [i, p] of data.plugins.entries()) {
        if (typeof p.name !== 'string' || !p.name.trim()) {
          fail(`.claude-plugin/marketplace.json plugins[${i}]: missing "name"`); mktOk = false;
        }
        if (!p.source || (typeof p.source !== 'string' && typeof p.source !== 'object')) {
          fail(`.claude-plugin/marketplace.json plugins[${i}] ("${p.name}"): missing "source"`); mktOk = false;
        }
      }
      if (mktOk) pass(`.claude-plugin/marketplace.json: valid — ${data.plugins.length} plugin(s)`);
    }
  }
}

// ─── 2. plugin.json files ────────────────────────────────────────────────────

console.log('\n── plugin.json files ───────────────────────────────────');
let pluginCount = 0;

for (const filePath of walk(ROOT)) {
  // Only .claude-plugin/plugin.json (not marketplace.json)
  if (
    path.basename(filePath) !== 'plugin.json' ||
    !filePath.includes(`${SEP}.claude-plugin${SEP}`)
  ) continue;

  pluginCount++;
  const rel = path.relative(ROOT, filePath);
  const { ok, data, error } = readJSON(filePath);
  if (!ok) {
    fail(`${rel}: invalid JSON — ${error}`);
  } else if (typeof data.name !== 'string' || !data.name.trim()) {
    fail(`${rel}: missing required field "name" (string)`);
  } else if (typeof data.description === 'string' && data.description.length > 600) {
    // Token budget: plugin descriptions load into every session.
    fail(`${rel}: "description" is ${data.description.length} chars — max is 600 (per-session token cost)`);
  } else {
    pass(`${rel}: name="${data.name}" version="${data.version ?? 'unset'}"`);
  }
}

if (pluginCount === 0) info('no plugin.json files found');

// ─── 3. SKILL.md files ───────────────────────────────────────────────────────

console.log('\n── SKILL.md files ────────────────────────────────────────');
let skillCount = 0;

for (const filePath of walk(ROOT)) {
  if (path.basename(filePath) !== 'SKILL.md') continue;

  skillCount++;
  const rel = path.relative(ROOT, filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);

  if (!fm) {
    fail(`${rel}: missing YAML frontmatter (file must begin with --- block)`);
    continue;
  }
  const desc = fm['description'] ?? '';
  const combined = desc.length + (fm['when_to_use'] ?? '').length;
  // Threshold rationale: descriptions are the skill-routing signal — compressing
  // them below ~800 trades invocation quality for marginal token savings. Above
  // 800 the prose is redundant with the skill body. Hard cap 1024 per CLAUDE.md.
  if (combined > 1024) {
    fail(`${rel}: description+when_to_use is ${combined} chars — max is 1024`);
  } else if (combined > 800) {
    warn(`${rel}: description+when_to_use is ${combined} chars — target is <=800 (per-session token cost)`);
  } else {
    pass(`${rel}: frontmatter OK (description+when_to_use: ${combined} chars)`);
  }
}

if (skillCount === 0) info('no SKILL.md files found (OK for phase 1)');

// ─── 3b. agent files ─────────────────────────────────────────────────────────
// Conventions (CLAUDE.md): every agent has name + description frontmatter;
// *-reviewer and *-support agents MUST declare disallowedTools with Write and
// Edit; *-implementor agents MUST NOT disallow Write/Edit.

console.log('\n── agent files ───────────────────────────────────────────');
let agentCount = 0;

for (const filePath of walk(ROOT)) {
  if (
    !filePath.endsWith('.md') ||
    path.basename(path.dirname(filePath)) !== 'agents' ||
    !filePath.includes(`${SEP}plugins${SEP}`)
  ) continue;

  agentCount++;
  const rel = path.relative(ROOT, filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);

  if (!fm) {
    fail(`${rel}: missing YAML frontmatter (file must begin with --- block)`);
    continue;
  }

  let agentOk = true;
  for (const field of ['name', 'description']) {
    if (!fm[field] || !fm[field].trim()) {
      fail(`${rel}: missing required frontmatter field "${field}"`);
      agentOk = false;
    }
  }

  const base = path.basename(filePath, '.md');
  const disallowed = (fm['disallowedTools'] ?? '').split(',').map(s => s.trim());
  const readOnly = disallowed.includes('Write') && disallowed.includes('Edit');

  if ((base.endsWith('-reviewer') || base.endsWith('-support')) && !readOnly) {
    fail(`${rel}: reviewer/support agents must declare "disallowedTools: Write, Edit"`);
    agentOk = false;
  }
  if (base.endsWith('-implementor') && readOnly) {
    fail(`${rel}: implementor agents must NOT disallow Write/Edit`);
    agentOk = false;
  }

  // Model-tier policy (CLAUDE.md model matrix):
  //   fsp-scout = haiku, fsp-architect = opus, implementors inherit (no model key),
  //   reviewers/support/fsp-analyst/fsp-qa = sonnet or omitted.
  const model = fm['model'] ?? '';
  if (base === 'fsp-scout' && model !== 'haiku') {
    fail(`${rel}: fsp-scout must declare "model: haiku" (T1 read tier)`);
    agentOk = false;
  }
  if (base === 'fsp-architect' && model !== 'opus') {
    fail(`${rel}: fsp-architect must declare "model: opus" (T3 planning tier)`);
    agentOk = false;
  }
  if (base.endsWith('-implementor') && model && model !== 'inherit') {
    fail(`${rel}: implementor agents must not hardcode a model — orchestrators pass one per invocation`);
    agentOk = false;
  }
  if ((base.endsWith('-reviewer') || base.endsWith('-support') || base === 'fsp-analyst' || base === 'fsp-qa')
      && model && model !== 'sonnet') {
    fail(`${rel}: ${base} must declare "model: sonnet" or omit the model field (T2 tier)`);
    agentOk = false;
  }

  // Token discipline: every agent must declare its read budget.
  if (!content.includes('Read budget')) {
    fail(`${rel}: agent body must declare a "Read budget" (token discipline)`);
    agentOk = false;
  }

  if (agentOk) pass(`${rel}: frontmatter OK (name="${fm['name']}", model=${model || 'inherit'})`);
}

if (agentCount === 0) info('no agent files found');

// ─── 3c. command files ───────────────────────────────────────────────────────
// Convention (CLAUDE.md): all plugin command files are named fsp-<verb>.md.

console.log('\n── command files ─────────────────────────────────────────');
let commandCount = 0;

for (const filePath of walk(ROOT)) {
  if (
    !filePath.endsWith('.md') ||
    path.basename(path.dirname(filePath)) !== 'commands' ||
    !filePath.includes(`${SEP}plugins${SEP}`)
  ) continue;

  commandCount++;
  const rel = path.relative(ROOT, filePath);
  if (!path.basename(filePath).startsWith('fsp-')) {
    fail(`${rel}: command files must be named fsp-<verb>.md`);
  } else {
    pass(`${rel}: fsp- prefix OK`);
  }
}

if (commandCount === 0) info('no command files found');

// ─── 4. hooks.json files ─────────────────────────────────────────────────────

console.log('\n── hooks.json files ─────────────────────────────────────');
let hooksCount = 0;

for (const filePath of walk(ROOT)) {
  if (path.basename(filePath) !== 'hooks.json') continue;

  hooksCount++;
  const rel = path.relative(ROOT, filePath);
  const { ok, data, error } = readJSON(filePath);

  if (!ok) {
    fail(`${rel}: invalid JSON — ${error}`);
    continue;
  }
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) {
    fail(`${rel}: missing top-level "hooks" object`);
    continue;
  }

  // The plugin root is two levels up: hooks/hooks.json → hooks/ → plugin-root
  const pluginRoot = path.dirname(path.dirname(filePath));
  let localErrors = 0;

  // Resolve a path string: substitute ${CLAUDE_PLUGIN_ROOT}, strip shell quotes.
  // Returns null if the string still has unresolvable variables or isn't a file path.
  const resolvePath = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    let s = raw.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot).replace(/"/g, '');
    if (s.includes('${')) return null; // other runtime variables — skip
    // Only treat as a file path if it has a separator or starts with '.'
    if (!s.includes('/') && !s.includes(SEP) && !s.startsWith('.')) return null;
    return s;
  };

  for (const matchers of Object.values(data.hooks)) {
    if (!Array.isArray(matchers)) continue;
    for (const matcherEntry of matchers) {
      if (!Array.isArray(matcherEntry.hooks)) continue;
      for (const hook of matcherEntry.hooks) {
        if (hook.type !== 'command') continue;

        // Shell-form: command is the script path — check existence and executability.
        const cmdPath = resolvePath(hook.command);
        if (cmdPath) {
          const abs = path.isAbsolute(cmdPath) ? cmdPath : path.resolve(pluginRoot, cmdPath);
          if (!fs.existsSync(abs)) {
            fail(`${rel}: hook script not found: ${hook.command}`);
            localErrors++;
          } else if (!IS_WINDOWS) {
            try { fs.accessSync(abs, fs.constants.X_OK); }
            catch { fail(`${rel}: hook script not executable: ${hook.command}`); localErrors++; }
          }
        }

        // Exec-form args: check script paths in args for existence (not executability —
        // they are invoked via the command binary, not directly).
        if (Array.isArray(hook.args)) {
          for (const arg of hook.args) {
            const argPath = resolvePath(arg);
            if (!argPath) continue;
            const abs = path.isAbsolute(argPath) ? argPath : path.resolve(pluginRoot, argPath);
            if (!fs.existsSync(abs)) {
              fail(`${rel}: hook script not found (args): ${arg}`);
              localErrors++;
            }
          }
        }
      }
    }
  }

  if (localErrors === 0) pass(`${rel}: all hook scripts OK`);
}

if (hooksCount === 0) info('no hooks.json files found (OK for phase 1)');

// ─── 5. Hook tests ────────────────────────────────────────────────────────────

console.log('\n── hook tests ────────────────────────────────────────────');

const hookTestScript = path.join(ROOT, 'tests', 'hooks', 'run-tests.mjs');
if (!fs.existsSync(hookTestScript)) {
  info('tests/hooks/run-tests.mjs not found — skipping hook tests');
} else {
  const hookTestResult = spawnSync('node', [hookTestScript], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    cwd: ROOT,
  });
  if (hookTestResult.stdout) process.stdout.write(hookTestResult.stdout);
  if (hookTestResult.stderr) process.stderr.write(hookTestResult.stderr);
  if (hookTestResult.status !== 0) {
    fail('hook tests: one or more tests failed (see output above)');
  } else {
    pass('hook tests: all passed');
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(56));
if (warnings > 0) console.log(`! ${warnings} warning(s) — non-blocking, see above.`);
if (errors === 0) {
  console.log('✓ All checks passed.\n');
  process.exit(0);
} else {
  console.error(`✗ ${errors} error(s) found. Fix the issues above and re-run.\n`);
  process.exit(1);
}
