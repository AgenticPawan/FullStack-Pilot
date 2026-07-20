#!/usr/bin/env node
'use strict';
// PreToolUse hook — EF Core migration safety verifier.
// Fires on Write/Edit/MultiEdit; only acts on files matching **/Migrations/*.cs.
// Two checks:
//   1. BLOCK  — destructive operations (DropColumn/DropTable/AlterColumn) without the
//               explicit "// pilot-sql: migration-safety approved" annotation.
//   2. WARN   — new CreateTable without a TenantId / OrganisationId column (advisory
//               for multi-tenant projects — non-blocking, since not every table is tenant-scoped).
// Kill-switch: set enable_migration_verifier=false in pilot-sql userConfig.
// Always exits 0 — deny/warn are communicated via hookSpecificOutput, not exit code.

const fs   = require('node:fs');
const path = require('node:path');

function isMigrationFile(filePath) {
  return /[/\\]Migrations[/\\][^/\\]+\.cs$/i.test(filePath);
}

function main() {
  if (process.env.CLAUDE_PLUGIN_OPTION_ENABLE_MIGRATION_VERIFIER === 'false') {
    process.exit(0);
  }

  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_) { process.exit(0); }

  let payload;
  try { payload = JSON.parse(raw); } catch (_) { process.exit(0); }

  const toolName = String(payload.tool_name || '');
  const input    = payload.tool_input || {};
  const filePath = String(input.file_path || '');

  if (!isMigrationFile(filePath)) process.exit(0);

  // Gather the content being written/edited
  let content;
  if (toolName === 'Write') {
    content = String(input.content ?? '');
  } else if (toolName === 'Edit') {
    content = String(input.new_string ?? '');
  } else if (toolName === 'MultiEdit') {
    content = Array.isArray(input.edits)
      ? input.edits.map(e => String((e && e.new_string) ?? '')).join('\n')
      : '';
  } else {
    process.exit(0);
  }

  // ── Rule 1 (BLOCK): destructive DDL without approval annotation ───────────────
  // Covers DropColumn, DropTable, DropIndex, AlterColumn — all can cause data loss
  // or break an in-flight rolling deploy if deployed code still references the object.
  const DESTRUCTIVE_RE = /\.(DropColumn|DropTable|DropIndex|AlterColumn)\s*\(/;
  const APPROVED_RE    = /\/\/\s*pilot-sql:\s*migration-safety\s*approved/i;

  if (DESTRUCTIVE_RE.test(content) && !APPROVED_RE.test(content)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          '[pilot-sql/migration-verifier] Destructive EF Core migration detected ' +
          '(DropColumn / DropTable / DropIndex / AlterColumn). ' +
          'Before proceeding, verify: (1) an expand/contract deploy window is planned so ' +
          'running pods drain before the DDL executes; (2) no deployed code still reads the ' +
          'dropped column/table; (3) a backup point exists before this migration runs. ' +
          'When verified, add "// pilot-sql: migration-safety approved" above the operation ' +
          'to unblock. See the sql-migration-safety skill (MIG-002, MIG-003) for guidance.',
      },
    }));
    process.exit(0);
  }

  // ── Rule 2 (WARN): new table without tenant identifier ───────────────────────
  // Only advisory — single-tenant or non-domain tables do not need a TenantId column.
  const CREATE_TABLE_RE   = /\.CreateTable\s*\(/;
  const TENANT_SIGNAL_RE  = /TenantId|OrganisationId|OrganizationId|tenant_id/i;

  if (CREATE_TABLE_RE.test(content) && !TENANT_SIGNAL_RE.test(content)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
        permissionDecisionReason:
          '[pilot-sql/migration-verifier] Advisory — new table has no tenant identifier. Not blocked.',
      },
      systemMessage:
        '[pilot-sql/migration-verifier] New table migration contains no TenantId / OrganisationId ' +
        'column. For multi-tenant entities, add a TenantId FK and a covering index. ' +
        'See the sql-multitenancy skill (MT-003). Advisory — proceed if this is a single-tenant ' +
        'table or an infrastructure/lookup table.',
    }));
    process.exit(0);
  }

  process.exit(0);
}

try {
  main();
} catch (e) {
  try {
    process.stderr.write(
      `[pilot-sql/migration-verifier] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
}
process.exit(0);
