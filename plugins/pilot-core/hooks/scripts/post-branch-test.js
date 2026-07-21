#!/usr/bin/env node
/**
 * PostToolUse/Bash — fires after git branch creation commands.
 * When a new branch is created (git checkout -b / git switch -c), records the
 * branch name to .claude/last-branch.txt and emits a systemMessage reminding the
 * agent to run the test suite before handing off the branch.
 * Used by fsp-incident-responder to track the fix branch name for the handoff note.
 * Fails open (exit 0) on any internal error.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const BRANCH_CREATE_PATTERNS = [
  /git\s+checkout\s+-b\s+([^\s]+)/i,
  /git\s+switch\s+-c\s+([^\s]+)/i,
];

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(inputData);
    const command = (input.tool_input && input.tool_input.command) ? input.tool_input.command : '';

    let branchName = null;
    for (const re of BRANCH_CREATE_PATTERNS) {
      const m = command.match(re);
      if (m && m[1]) {
        branchName = m[1];
        break;
      }
    }

    if (!branchName) {
      process.exit(0);
      return;
    }

    // Record the branch name for handoff notes
    try {
      const claudeDir = path.join(process.cwd(), '.claude');
      if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'last-branch.txt'), branchName + '\n', 'utf8');
    } catch (_) { /* non-fatal */ }

    process.stdout.write(JSON.stringify({
      systemMessage: [
        `post-branch-test: branch "${branchName}" created.`,
        '',
        'Before handing off this branch, run the test suite:',
        '  .NET:    dotnet test --no-build',
        '  Angular: ng test --watch=false',
        '',
        'The test results are required in the handoff note (session-handoff skill).',
      ].join('\n'),
    }));
  } catch (_) {
    process.exit(0); // fail open
  }
});
