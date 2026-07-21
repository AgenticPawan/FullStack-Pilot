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

function stripQuotes(val) {
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    return val.slice(1, -1);
  }
  return val;
}

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
  const lines = yamlBlock.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    // Inline flow list: key: [a, b, c]  → array
    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val.slice(1, -1).split(',').map(s => stripQuotes(s.trim())).filter(Boolean);
      continue;
    }
    // Block sequence: value empty, following lines are "  - item"  → array
    if (val === '') {
      const items = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const im = lines[j].match(/^\s*-\s+(.*?)\s*$/);
        if (!im) break;
        items.push(stripQuotes(im[1].trim()));
      }
      if (items.length) { fm[key] = items; i = j - 1; continue; }
    }
    fm[key] = stripQuotes(val);
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
        // Token budget: catalog descriptions load on the marketplace browse surface —
        // same 600-char cap as plugin.json for parity (CLAUDE.md token discipline).
        if (typeof p.description === 'string' && p.description.length > 600) {
          fail(`.claude-plugin/marketplace.json plugins[${i}] ("${p.name}"): "description" is ${p.description.length} chars — max is 600 (catalog token cost)`); mktOk = false;
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
    continue;
  }
  let pluginOk = true;
  if (typeof data.name !== 'string' || !data.name.trim()) {
    fail(`${rel}: missing required field "name" (string)`); pluginOk = false;
  } else if (typeof data.description === 'string' && data.description.length > 600) {
    // Token budget: plugin descriptions load into every session.
    fail(`${rel}: "description" is ${data.description.length} chars — max is 600 (per-session token cost)`); pluginOk = false;
  }
  // Every stack plugin depends on pilot-core — the security-hook enforcement floor lives
  // ONLY there (CLAUDE.md), so pilot-core must be installed alongside it. pilot-core is the
  // base and is exempt from depending on itself.
  if (typeof data.name === 'string' && data.name.trim() && data.name !== 'pilot-core') {
    const deps = Array.isArray(data.dependencies) ? data.dependencies : [];
    const hasCore = deps.some(d => d === 'pilot-core' || (d && d.name === 'pilot-core'));
    if (!hasCore) {
      fail(`${rel}: stack plugin "${data.name}" must declare a dependency on pilot-core`); pluginOk = false;
    }
  }
  // pilot-rag is opt-in — it requires /fsp-rag-init before any functionality is usable.
  // CLAUDE.md: "pilot-rag MUST declare defaultEnabled: false — CI enforces this."
  if (typeof data.name === 'string' && data.name === 'pilot-rag') {
    if (data.defaultEnabled !== false) {
      fail(`${rel}: pilot-rag must declare "defaultEnabled": false (it is opt-in; /fsp-rag-init required first)`); pluginOk = false;
    }
  }
  if (pluginOk) pass(`${rel}: name="${data.name}" version="${data.version ?? 'unset'}"`);
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
  // Omitting `description` is a CI failure (CLAUDE.md SKILL.md conventions): it is the
  // primary skill-routing signal. An empty/whitespace-only value counts as omitted.
  if (typeof fm['description'] !== 'string' || !fm['description'].trim()) {
    fail(`${rel}: missing required frontmatter field "description"`);
    continue;
  }
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
  // disallowedTools may be authored as a scalar CSV ("Write, Edit") or a YAML list
  // ([Write, Edit] / block form). parseFrontmatter yields an array for list forms and a
  // string for scalar — normalize both to a token list before the membership check so the
  // read-only guarantee never evaluates wrong on authoring style (S4).
  const rawDisallowed = fm['disallowedTools'];
  const disallowed = Array.isArray(rawDisallowed)
    ? rawDisallowed.map(s => String(s).trim())
    : String(rawDisallowed ?? '').split(',').map(s => s.trim());
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

  // Implementor verification contract (CLAUDE.md): every *-implementor body must describe
  // the build + test contract with the pre-existing / implementor-caused red distinction.
  if (base.endsWith('-implementor')) {
    const lower = content.toLowerCase();
    const hasContract = lower.includes('pre-existing red') || lower.includes('verification contract');
    if (!hasContract) {
      fail(`${rel}: implementor agent must describe the verification contract — look for "pre-existing red" or "verification contract" (CLAUDE.md)`);
      agentOk = false;
    }
  }

  if (agentOk) pass(`${rel}: frontmatter OK (name="${fm['name']}", model=${model || 'inherit'})`);
}

if (agentCount === 0) info('no agent files found');

// ─── 3c. command files ───────────────────────────────────────────────────────
// Convention (CLAUDE.md): all plugin command files are named fsp-<verb>.md.

console.log('\n── command files ─────────────────────────────────────────');
let commandCount = 0;
const validCommands = new Set();

for (const filePath of walk(ROOT)) {
  if (
    !filePath.endsWith('.md') ||
    path.basename(path.dirname(filePath)) !== 'commands' ||
    !filePath.includes(`${SEP}plugins${SEP}`)
  ) continue;

  commandCount++;
  validCommands.add(path.basename(filePath, '.md'));
  const rel = path.relative(ROOT, filePath);
  let cmdOk = true;

  if (!path.basename(filePath).startsWith('fsp-')) {
    fail(`${rel}: command files must be named fsp-<verb>.md`); cmdOk = false;
  }

  // Every command MUST expose a `description` in YAML frontmatter — it populates the
  // /-menu (UX) and loads into the session (token cost), so it is both a discoverability
  // signal and a budgeted field. `argument-hint` stays optional (no-arg commands omit it).
  const content = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm) {
    fail(`${rel}: missing YAML frontmatter (file must begin with a --- block carrying a description)`); cmdOk = false;
  } else if (typeof fm['description'] !== 'string' || !fm['description'].trim()) {
    fail(`${rel}: missing required frontmatter field "description"`); cmdOk = false;
  } else if (fm['description'].length > 250) {
    fail(`${rel}: "description" is ${fm['description'].length} chars — max is 250 (per-session token cost)`); cmdOk = false;
  }

  if (cmdOk) pass(`${rel}: fsp- prefix + description OK`);
}

if (commandCount === 0) info('no command files found');

// Phase-1 migration: fsp-* commands moved to skills/fsp-*/SKILL.md with
// matching name: field. Register those names as valid slash-command targets so
// /fsp-* references in agent/skill bodies still resolve after command files are removed.
for (const filePath of walk(ROOT)) {
  if (path.basename(filePath) !== 'SKILL.md') continue;
  if (!filePath.includes(`${SEP}plugins${SEP}`)) continue;
  const raw = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(raw);
  if (!fm) continue;
  const sname = (fm['name'] || '').trim();
  if (sname.startsWith('fsp-')) validCommands.add(sname);
}

// ─── 3d. command-reference integrity ─────────────────────────────────────────
// Shipped command/skill/agent markdown must not tell users to run a slash command that
// doesn't exist. Catches the dangling-reference class (e.g. a stale "/fix-critical" left
// after the command was renamed to /fsp-fix) that no other check sees. Only real command
// INVOCATIONS are inspected: a "/" preceded by start-of-line, whitespace, backtick or "("
// and followed by "fsp-"/"fix-" + an alpha — so path segments (".../pilot/fix-<tier>") and
// generic placeholders ("/fsp-<verb>") are excluded by construction.

console.log('\n── command references ─────────────────────────────────────');
// Legacy prefixes that never map to a real command — any slash-invocation using one is stale.
const LEGACY_CMD_PREFIXES = ['fix-'];
const CMD_REF_RE = /(?:^|[\s`(])\/((?:fsp|fix)-[a-z][a-z0-9-]*)/gm;
let cmdRefErrors = 0;
let cmdRefFiles = 0;

for (const filePath of walk(ROOT)) {
  if (!filePath.endsWith('.md') || !filePath.includes(`${SEP}plugins${SEP}`)) continue;
  const dir = path.basename(path.dirname(filePath));
  const inCommands = dir === 'commands';
  const isSkill = path.basename(filePath) === 'SKILL.md';
  const inAgents = dir === 'agents';
  if (!inCommands && !isSkill && !inAgents) continue;

  cmdRefFiles++;
  const rel = path.relative(ROOT, filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  for (const m of content.matchAll(CMD_REF_RE)) {
    const ref = m[1].replace(/-+$/, ''); // strip any trailing hyphen
    const isLegacy = LEGACY_CMD_PREFIXES.some(p => ref.startsWith(p));
    if (isLegacy || !validCommands.has(ref)) {
      const upToMatch = content.slice(0, m.index);
      const line = upToMatch.split('\n').length;
      fail(`${rel}:${line}: references /${ref} — no such command (valid: ${[...validCommands].map(c => '/' + c).join(', ')})`);
      cmdRefErrors++;
    }
  }
}

if (cmdRefFiles === 0) info('no command/skill/agent markdown found');
else if (cmdRefErrors === 0) pass(`command references: all /fsp- invocations resolve (${cmdRefFiles} file(s) scanned)`);

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

  // Hook scripts MUST NOT recurse node_modules/bin/obj/dist/.git (CLAUDE.md). Concrete
  // proxy: a readdir/readdirSync call combined with { recursive: true } in the source.
  const scanned = new Set();
  const scanScript = (abs) => {
    if (!abs.endsWith('.js') || scanned.has(abs) || !fs.existsSync(abs)) return;
    scanned.add(abs);
    let src = '';
    try { src = fs.readFileSync(abs, 'utf8'); } catch { return; }
    if (/\breaddir(?:Sync)?\b/.test(src) && /recursive\s*:\s*true/.test(src)) {
      fail(`${rel}: hook script recurses directories (readdir recursive:true): ${path.relative(pluginRoot, abs)}`);
      localErrors++;
    }
  };

  for (const matchers of Object.values(data.hooks)) {
    if (!Array.isArray(matchers)) continue;
    for (const matcherEntry of matchers) {
      // Matchers MUST be scoped — never the wildcard "*" (or empty). CLAUDE.md.
      if (typeof matcherEntry.matcher === 'string') {
        const m = matcherEntry.matcher.trim();
        if (m === '*' || m === '') {
          fail(`${rel}: hook matcher must be scoped, never "*" or empty (got ${JSON.stringify(matcherEntry.matcher)})`);
          localErrors++;
        }
      }
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
          } else {
            if (!IS_WINDOWS) {
              try { fs.accessSync(abs, fs.constants.X_OK); }
              catch { fail(`${rel}: hook script not executable: ${hook.command}`); localErrors++; }
            }
            scanScript(abs);
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
            } else {
              scanScript(abs);
            }
          }
        }
      }
    }
  }

  if (localErrors === 0) pass(`${rel}: all hook scripts OK`);
}

if (hooksCount === 0) info('no hooks.json files found (OK for phase 1)');

// ─── 4b. .mcp.json files ─────────────────────────────────────────────────────
// Convention (CLAUDE.md / remediation R1+R6): a tracked `.mcp.json` auto-loads, so it
// must be valid, expose an mcpServers object, and pin every third-party reference —
// no floating `@latest` npm tag and no untagged / `:latest` docker image. `.mcp.json.example`
// (opt-in, copied only with consent) is JSON-validated but exempt from the pin check.

console.log('\n── .mcp.json files ───────────────────────────────────────');
let mcpCount = 0;

// Flag a floating npm spec (@latest or an unpinned scoped package) or an untagged/:latest image.
function floatingRefs(server) {
  const out = [];
  const cmd = server && server.command;
  const args = Array.isArray(server && server.args) ? server.args : [];
  for (const a of args) {
    if (typeof a !== 'string' || a.startsWith('-')) continue;
    if (cmd === 'npx') {
      if (/@latest\b/.test(a)) out.push(`npm "${a}" uses @latest`);
      else if (/^@?[\w.-]+\/[\w.-]+$/.test(a) && !/@[\w.-]+$/.test(a)) out.push(`npm "${a}" has no pinned version`);
    } else if (cmd === 'docker') {
      // image ref = has a registry/path slash and is not an env/flag token
      if (/^[\w][\w.-]*\/[\w./-]+/.test(a) && !a.startsWith('@')) {
        if (!/:[\w.-]+$/.test(a)) out.push(`docker image "${a}" is untagged`);
        else if (/:latest$/.test(a)) out.push(`docker image "${a}" uses :latest`);
      }
    }
  }
  return out;
}

for (const filePath of walk(ROOT)) {
  const base = path.basename(filePath);
  if (base !== '.mcp.json' && base !== '.mcp.json.example') continue;

  mcpCount++;
  const rel = path.relative(ROOT, filePath);
  const { ok, data, error } = readJSON(filePath);
  if (!ok) {
    fail(`${rel}: invalid JSON — ${error}`);
    continue;
  }
  if (!data.mcpServers || typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers)) {
    fail(`${rel}: missing top-level "mcpServers" object`);
    continue;
  }

  // Pin check only for the auto-loaded file, not the consent-gated .example.
  if (base === '.mcp.json') {
    const floats = [];
    for (const [name, server] of Object.entries(data.mcpServers)) {
      for (const msg of floatingRefs(server)) floats.push(`${name}: ${msg}`);
    }
    if (floats.length) {
      for (const f of floats) warn(`${rel}: unpinned reference — ${f}`);
    } else {
      pass(`${rel}: valid — ${Object.keys(data.mcpServers).length} server(s), all references pinned`);
    }
  } else {
    pass(`${rel}: valid — ${Object.keys(data.mcpServers).length} server(s) (opt-in, consent-gated)`);
  }
}

if (mcpCount === 0) info('no .mcp.json files found');

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
