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

// Scan up to MAX_CTX_FILES .cs files in projectDir and projectDir/src for
// DbContext subclasses, then check whether any contain HasQueryFilter.
// Returns true (found), false (DbContext found, no HasQueryFilter), or null (no DbContext found).
const MAX_CTX_FILES = 10;
function dbContextHasQueryFilter(projectDir) {
  const dirsToSearch = [projectDir, path.join(projectDir, 'src')];
  const candidates = [];
  for (const dir of dirsToSearch) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.cs')) {
          candidates.push(path.join(dir, e.name));
          if (candidates.length >= MAX_CTX_FILES) break;
        }
      }
    } catch (_) { /* dir may not exist */ }
    if (candidates.length >= MAX_CTX_FILES) break;
  }

  let foundDbContext = false;
  for (const f of candidates) {
    try {
      const src = fs.readFileSync(f, 'utf8');
      if (!/DbContext/.test(src)) continue;
      foundDbContext = true;
      if (/HasQueryFilter/.test(src)) return true;
    } catch (_) { /* unreadable file — skip */ }
  }
  return foundDbContext ? false : null; // null = no DbContext found, skip advisory
}

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

  // ── Rule 3 (WARN): HasQueryFilter coverage check ─────────────────────────────
  // When a new CreateTable migration is written, scan up to MAX_CTX_FILES source
  // files (project root + src/) for DbContext subclasses. If none contain
  // HasQueryFilter, emit an advisory so developers add the global tenant/soft-delete
  // filter before the new entity can be queried without it.
  //
  // Cost: O(readdir × 2 dirs + read × MAX_CTX_FILES). No AI invocation.
  // Kill-switch: CLAUDE_PLUGIN_OPTION_ENABLE_QUERY_FILTER_CHECK=false
  if (CREATE_TABLE_RE.test(content)
      && process.env.CLAUDE_PLUGIN_OPTION_ENABLE_QUERY_FILTER_CHECK !== 'false') {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const hasQueryFilter = dbContextHasQueryFilter(projectDir);
    if (hasQueryFilter === false) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'defer',
          permissionDecisionReason:
            '[pilot-sql/migration-verifier] Advisory — no HasQueryFilter detected in DbContext. Not blocked.',
        },
        systemMessage:
          '[pilot-sql/migration-verifier] No HasQueryFilter call found in any DbContext ' +
          'scanned (up to 10 files in project root and src/). For multi-tenant and soft-delete ' +
          'entities the global query filter prevents accidental cross-tenant reads and leaks ' +
          'soft-deleted rows. Add modelBuilder.Entity<T>().HasQueryFilter(...) in OnModelCreating. ' +
          'See sql-multitenancy (MT-004) and dotnet-soft-delete. Advisory — not blocked. ' +
          'Set enable_query_filter_check=false in pilot-sql userConfig to suppress.',
      }));
      process.exit(0);
    }
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
