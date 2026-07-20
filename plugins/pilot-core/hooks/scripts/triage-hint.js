#!/usr/bin/env node
'use strict';
// PostToolUseFailure hook — one-line triage hint.
// Reads the failed tool's name and error message from stdin, then injects a short
// actionable hint as additionalContext so Claude can recover faster.
// Kill-switch: set enable_governance_hooks=false in pilot-core userConfig.
// Always exits 0 — PostToolUseFailure is observational and cannot block.

const fs = require('node:fs');

// Hint table: per-tool ordered list of { pattern, hint }.
// Patterns are checked top-down; first match wins.
const HINTS = {
  Bash: [
    { re: /command not found|not recognized as an internal or external/i,
      hint: 'The command was not found on PATH. Verify the CLI is installed and on PATH (dotnet/node/npm/az/git).' },
    { re: /permission denied/i,
      hint: 'Permission denied. Check file permissions; on Windows, try running the terminal as Administrator.' },
    { re: /ENOENT|no such file or directory/i,
      hint: 'File or directory not found. Confirm the path exists and the working directory is correct.' },
    { re: /npm ERR!/i,
      hint: 'npm error. Try `npm install` first, or check package.json for unresolved peer dependencies.' },
    { re: /MSB\d{4}|Build FAILED/i,
      hint: 'MSBuild failure. Check .csproj for missing references, NuGet restore issues, or C# syntax errors.' },
    { re: /error\s+CS\d{4}/i,
      hint: 'C# compiler error. Look for the CS-number diagnostic in the build output and fix the offending source.' },
    { re: /EADDRINUSE/i,
      hint: 'Port already in use. Stop the existing process on that port before restarting.' },
    { re: /git.*not a git repository/i,
      hint: 'Not a git repository. Run `git init` or navigate to the project root.' },
    { re: /ETIMEDOUT|ECONNREFUSED/i,
      hint: 'Network/connection error. Check service availability and firewall rules.' },
  ],
  Write: [
    { re: /EACCES|permission/i,
      hint: 'Write permission denied. Check whether the file is locked by another process or owned by a different user.' },
    { re: /ENOSPC/i,
      hint: 'Disk full. Free disk space before retrying the write.' },
    { re: /ENOENT/i,
      hint: 'Parent directory does not exist. Create it before writing the file.' },
  ],
  Edit: [
    { re: /not found in file|old_string|did not match/i,
      hint: 'The old_string was not found verbatim. Verify whitespace, line endings, and that no earlier edit already changed the text.' },
  ],
  MultiEdit: [
    { re: /not found in file|old_string|did not match/i,
      hint: 'One or more old_string values were not found. Re-read the file to confirm exact content before retrying.' },
  ],
};

function main() {
  if (process.env.CLAUDE_PLUGIN_OPTION_ENABLE_GOVERNANCE_HOOKS === 'false') {
    process.exit(0);
  }

  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_) { process.exit(0); }

  let payload;
  try { payload = JSON.parse(raw); } catch (_) { process.exit(0); }

  const toolName  = String(payload.tool_name  || '');
  const toolError = String(payload.tool_error || '');
  if (!toolError) process.exit(0);

  const candidates = HINTS[toolName] || [];
  for (const { re, hint } of candidates) {
    if (re.test(toolError)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUseFailure',
          additionalContext: `[pilot-core/triage] ${hint}`,
        },
      }));
      process.exit(0);
    }
  }
}

try {
  main();
} catch (e) {
  try {
    process.stderr.write(
      `[pilot-core/triage-hint] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
}
process.exit(0);
