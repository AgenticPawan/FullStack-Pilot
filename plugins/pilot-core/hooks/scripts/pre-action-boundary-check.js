#!/usr/bin/env node
/**
 * PreToolUse/Bash — extends bash-guard.js with production-action boundaries.
 * Blocks: kubectl apply/rollout/scale (live cluster mutations), docker run with
 * production environment signals, and az resource mutation commands targeting live
 * services. Warns on: git push to main/master (not denied — feature branches are
 * allowed; only main/master gets a caution).
 * Fails open (exit 0) on any internal error.
 *
 * Works alongside bash-guard.js (does not replace it).
 */

'use strict';
const fs = require('fs');

const DENY_PATTERNS = [
  {
    re: /kubectl\s+apply\b/i,
    message: 'kubectl apply is a live-cluster mutation — fsp-incident-responder boundary. Prepare the manifest, then ask a human with cluster access to apply it.',
  },
  {
    re: /kubectl\s+(?:rollout\s+restart|scale\s+deployment|delete\s+(?:pod|deployment|service))\b/i,
    message: 'kubectl cluster mutations are blocked. Document the required change and hand off to a human operator.',
  },
  {
    re: /docker\s+run\b.+--env(?:-file)?\s+[^\s]*prod/i,
    message: 'docker run with a production environment file is a production-side effect. Run the container locally with a dev env file instead.',
  },
  {
    re: /az\s+(?:webapp|functionapp|containerapp)\s+(?:start|stop|restart|update|deploy|scale)\b/i,
    message: 'az service mutation commands target a live Azure resource. fsp-incident-responder boundary: prepare the change, then a human with subscription access executes it.',
  },
  {
    re: /az\s+(?:keyvault\s+secret|appconfig\s+kv)\s+(?:set|delete)\b/i,
    message: 'Mutating live Key Vault secrets or App Configuration is blocked. Document the required secret value and hand off to a human operator.',
  },
];

const WARN_PATTERNS = [
  {
    re: /git\s+push\s+(?:origin\s+)?(?:main|master)\b/i,
    message: 'Pushing directly to main/master is strongly discouraged. Use a feature branch and open a PR for human review.',
  },
];

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(inputData);
    const command = (input.tool_input && input.tool_input.command) ? input.tool_input.command : '';

    for (const { re, message } of DENY_PATTERNS) {
      if (re.test(command)) {
        process.stdout.write(JSON.stringify({
          permissionDecision: 'deny',
          userMessage: `BOUNDARY VIOLATION — pre-action-boundary-check:\n${message}`,
        }));
        return;
      }
    }

    for (const { re, message } of WARN_PATTERNS) {
      if (re.test(command)) {
        process.stdout.write(JSON.stringify({
          permissionDecision: 'defer',
          systemMessage: `⚠ pre-action-boundary-check: ${message}`,
        }));
        return;
      }
    }

    process.stdout.write(JSON.stringify({ continue: true }));
  } catch (_) {
    process.exit(0); // fail open
  }
});
