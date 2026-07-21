#!/usr/bin/env node
/**
 * PreToolUse/Bash — validates feature name uniqueness before scaffold generation.
 * Fires on ng generate, dotnet new, or fsp-scaffold commands.
 * Denies if the feature slug already exists as a controller, Angular project, or table.
 * Fails open (exit 0) on any internal error so it never blocks a legitimate build.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const SCAFFOLD_PATTERNS = [
  { re: /ng\s+generate\s+(?:component|service|directive|guard|resolver|module)\s+([^\s]+)/i, group: 1 },
  { re: /ng\s+g\s+(?:c|s|d|g|r|m)\s+([^\s]+)/i, group: 1 },
  { re: /dotnet\s+new\s+(?:webapi|mvc|classlib|worker|console)(?:\s+(?:-n|--name)\s+)?([^\s]+)/i, group: 1 },
];

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(inputData);
    const command = (input.tool_input && input.tool_input.command) ? input.tool_input.command : '';

    let featureSlug = null;
    for (const { re, group } of SCAFFOLD_PATTERNS) {
      const m = command.match(re);
      if (m && m[group]) {
        featureSlug = path.basename(m[group]).toLowerCase().replace(/[^a-z0-9]/g, '-');
        break;
      }
    }

    if (!featureSlug) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const conflicts = [];

    // Check angular.json project names
    try {
      const angularJsonPath = findFile('angular.json');
      if (angularJsonPath) {
        const angularJson = JSON.parse(fs.readFileSync(angularJsonPath, 'utf8'));
        const projectNames = Object.keys(angularJson.projects || {});
        if (projectNames.some(n => n.toLowerCase() === featureSlug || n.toLowerCase() === featureSlug + 's')) {
          conflicts.push(`Angular project name already exists: "${featureSlug}"`);
        }
      }
    } catch (_) { /* skip */ }

    // Check Controllers directory for existing controller names
    try {
      const controllersDir = findDir('Controllers');
      if (controllersDir) {
        const slugPascal = toPascalCase(featureSlug);
        const files = fs.readdirSync(controllersDir);
        const hit = files.find(f => {
          const base = f.replace(/Controller\.cs$/, '').toLowerCase();
          return base === featureSlug || base === featureSlug + 's';
        });
        if (hit) {
          conflicts.push(`.NET controller already exists: ${hit}`);
        }
      }
    } catch (_) { /* skip */ }

    // Check stack-profile.json for known tables
    try {
      const profilePath = findFile(path.join('.claude', 'pilot', 'stack-profile.json'));
      if (profilePath) {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        const tables = ((profile.database && profile.database.tables) || []).map(t => t.toLowerCase());
        if (tables.some(t => t === featureSlug || t === featureSlug + 's')) {
          conflicts.push(`Database table already registered in stack-profile.json: "${featureSlug}"`);
        }
      }
    } catch (_) { /* skip */ }

    if (conflicts.length > 0) {
      process.stdout.write(JSON.stringify({
        permissionDecision: 'deny',
        userMessage: [
          `pre-scaffold-validate: name conflict for "${featureSlug}":`,
          ...conflicts.map(c => `  • ${c}`),
          'Rename the feature or choose a different slug before scaffolding.',
        ].join('\n'),
      }));
      return;
    }

    process.stdout.write(JSON.stringify({ continue: true }));
  } catch (_) {
    process.exit(0); // fail open
  }
});

function findFile(name) {
  // Walk up from cwd up to 3 levels looking for the file
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findDir(name) {
  for (const base of ['.', 'src', 'api', 'backend', 'server']) {
    const candidate = path.join(process.cwd(), base, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

function toPascalCase(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
