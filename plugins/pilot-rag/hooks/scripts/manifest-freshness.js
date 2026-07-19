#!/usr/bin/env node
'use strict';
// SessionStart hook — stale RAG ingestion manifest detector.
// Compares a SHA-256 hash of INGESTION_MANIFEST.md stored under CLAUDE_PLUGIN_DATA
// against the current file. If they differ, emits a systemMessage advisory.
// Always exits 0 (fail open — a freshness check must never block session start).

const fs   = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function main() {
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (!pluginData) process.exit(0);

  // Locate INGESTION_MANIFEST.md relative to the project the user has open.
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const manifestPath = path.join(cwd, 'pilot-rag', 'INGESTION_MANIFEST.md');

  if (!fs.existsSync(manifestPath)) {
    // No manifest means pilot-rag hasn't been initialised yet — nothing to check.
    process.exit(0);
  }

  const current = fs.readFileSync(manifestPath, 'utf8');
  const currentHash = sha256(current);

  const hashFile = path.join(pluginData, 'rag-manifest.hash');
  let storedHash = null;
  try {
    storedHash = fs.readFileSync(hashFile, 'utf8').trim();
  } catch (_) {
    // No stored hash yet — write the current one and exit cleanly.
    try { fs.mkdirSync(pluginData, { recursive: true }); } catch (_) { /* ignore */ }
    fs.writeFileSync(hashFile, currentHash, 'utf8');
    process.exit(0);
  }

  if (storedHash !== currentHash) {
    process.stdout.write(JSON.stringify({
      systemMessage:
        '[pilot-rag] INGESTION_MANIFEST.md has changed since the last ingestion run. ' +
        'Run /fsp-rag-init (or re-run Phase 0 + Phase 3) to re-ingest and update the ' +
        'vector store. Answers may be stale until re-ingestion completes.',
    }));
  }
}

try {
  main();
} catch (e) {
  try {
    process.stderr.write(`[pilot-rag/manifest-freshness] internal error, failing open: ${e && e.message}\n`);
  } catch (_) { /* ignore */ }
}
process.exit(0);
