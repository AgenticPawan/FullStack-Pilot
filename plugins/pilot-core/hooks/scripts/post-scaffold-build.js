#!/usr/bin/env node
/**
 * PostToolUse/Bash — detects build failures immediately after scaffold operations.
 * Fires after dotnet build or ng build commands. If the build failed AND git status
 * shows new untracked scaffold files, emits a systemMessage naming the files and
 * suggesting a revert path. Never auto-reverts — that decision belongs to the agent.
 * Fails open (exit 0) on any internal error.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BUILD_COMMANDS = [
  /\bdotnet\s+build\b/i,
  /\bng\s+build\b/i,
  /\bnpx\s+tsc\b/i,
];

const SCAFFOLD_PATHS = [
  /src[/\\]app[/\\]/,
  /Controllers[/\\]/,
  /Handlers[/\\]/,
  /Commands[/\\]/,
  /Queries[/\\]/,
  /Domain[/\\]Entities[/\\]/,
  /Infrastructure[/\\]Data[/\\]Migrations[/\\]/,
];

const BUILD_FAILURE_PATTERNS = [
  /Build FAILED/i,
  /Error\(s\)/,
  /error TS\d+/i,
  /\d+ Error\(s\)/,
];

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(inputData);
    const command = (input.tool_input && input.tool_input.command) ? input.tool_input.command : '';
    const output = (input.tool_response && input.tool_response.output) ? input.tool_response.output : '';

    // Only fire on build commands
    if (!BUILD_COMMANDS.some(re => re.test(command))) {
      process.exit(0);
      return;
    }

    // Only fire when the build failed
    const buildFailed = BUILD_FAILURE_PATTERNS.some(re => re.test(output));
    if (!buildFailed) {
      process.exit(0);
      return;
    }

    // Check git status for untracked scaffold files
    let scaffoldFiles = [];
    try {
      const gitStatus = execSync('git status --porcelain', {
        cwd: process.cwd(),
        timeout: 5000,
        encoding: 'utf8',
      });
      scaffoldFiles = gitStatus
        .split('\n')
        .filter(line => line.startsWith('?? ') || line.startsWith('A  '))
        .map(line => line.slice(3).trim())
        .filter(f => SCAFFOLD_PATHS.some(re => re.test(f)));
    } catch (_) { /* git not available or clean */ }

    if (scaffoldFiles.length === 0) {
      // Build failed but no scaffold files — not a scaffold-related failure
      process.exit(0);
      return;
    }

    const fileList = scaffoldFiles.map(f => `  • ${f}`).join('\n');
    process.stdout.write(JSON.stringify({
      systemMessage: [
        '⚠ post-scaffold-build: build failed after scaffold generation.',
        '',
        'Scaffold files that may need to be reverted:',
        fileList,
        '',
        'To discard scaffolded files and start over:',
        '  git checkout -- .',
        '  git clean -fd (for untracked files — review first with: git status)',
        '',
        'Fix the build error shown above before proceeding.',
      ].join('\n'),
    }));
  } catch (_) {
    process.exit(0); // fail open
  }
});
