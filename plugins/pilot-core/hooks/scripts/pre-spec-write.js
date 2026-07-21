#!/usr/bin/env node
/**
 * PreToolUse/Write — validates spec template completeness before writing.
 * Fires when the target file_path is under .claude/specs/ or .claude/pilot/specs/.
 * Checks that all 8 required section headings are present in the content.
 * Denies the write and lists missing sections if any are absent.
 * Fails open (exit 0) on any internal error.
 */

'use strict';

const SPEC_PATHS = [
  /[/\\]\.claude[/\\]specs[/\\]/,
  /[/\\]\.claude[/\\]pilot[/\\]specs[/\\]/,
];

// Required section headings — checked as case-insensitive substring matches
const REQUIRED_SECTIONS = [
  { key: 'feature-title',   patterns: ['## 1. Feature Title', '# Spec:', 'Feature Title'] },
  { key: 'user-story',      patterns: ['## 2. User Story', 'User Story', 'As a '] },
  { key: 'ac',              patterns: ['## 3. Acceptance Criteria', 'Acceptance Criteria', 'AC-1'] },
  { key: 'layers',          patterns: ['## 4. Affected Layers', 'Affected Layers', '- [ ] Angular'] },
  { key: 'out-of-scope',    patterns: ['## 5. Out of Scope', 'Out of Scope', 'Out of scope'] },
  { key: 'open-questions',  patterns: ['## 6. Open Questions', 'Open Questions', 'Open questions'] },
  { key: 'dor',             patterns: ['## 7. Definition of Ready', 'Definition of Ready', 'DoR'] },
  { key: 'sizing',          patterns: ['## 8. Rough Sizing', 'Rough Sizing', 'Sizing:'] },
];

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(inputData);
    const filePath = (input.tool_input && input.tool_input.file_path) ? input.tool_input.file_path : '';
    const content  = (input.tool_input && input.tool_input.content)   ? input.tool_input.content   : '';

    // Only fire on spec paths
    const isSpecPath = SPEC_PATHS.some(re => re.test(filePath.replace(/\\/g, '/')));
    if (!isSpecPath) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const missing = [];
    for (const { key, patterns } of REQUIRED_SECTIONS) {
      const found = patterns.some(p => content.includes(p));
      if (!found) missing.push(key);
    }

    if (missing.length > 0) {
      process.stdout.write(JSON.stringify({
        permissionDecision: 'deny',
        userMessage: [
          'pre-spec-write: spec template is incomplete. Missing sections:',
          ...missing.map(s => `  • ${s}`),
          '',
          'All 8 sections are required before a spec can be written:',
          '  1. Feature Title   5. Out of Scope',
          '  2. User Story      6. Open Questions',
          '  3. Acceptance Criteria  7. Definition of Ready',
          '  4. Affected Layers 8. Rough Sizing',
        ].join('\n'),
      }));
      return;
    }

    process.stdout.write(JSON.stringify({ continue: true }));
  } catch (_) {
    process.exit(0); // fail open
  }
});
