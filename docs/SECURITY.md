# Security Policy

## Supported versions

Security fixes are made against the latest tagged release on `master`. There is no
long-term-support branch while the project is pre-1.0.

## Reporting a vulnerability

Do not open a public GitHub issue for a suspected vulnerability in FullStack Pilot
itself (a hook that can be tricked into running arbitrary code, a skill that leaks
secrets it's meant to guard, a malicious rules-catalog entry, etc.).

Instead, use GitHub's private vulnerability reporting: open the repository's **Security**
tab → **Report a vulnerability**. If that is unavailable, email
`maintainers@fullstack-pilot.dev` with:

- A description of the issue and its impact
- Steps to reproduce (a minimal repro repo if possible)
- The plugin(s) and skill/hook file(s) involved

Expect an acknowledgment within 5 business days. We do not currently run a paid bug
bounty program.

## Scope

In scope:
- `plugins/*/hooks/` — hook scripts that execute automatically on `Write`/`Edit`
- `plugins/*/.mcp.json` — MCP server configuration and credential handling
- `scripts/validate.mjs` and `.github/workflows/` — CI supply-chain surface
- Rules-catalog content that could cause a scaffolded project to disable a real
  security control (e.g., a rule that recommends disabling auth)

Out of scope:
- False positives/negatives in audit findings from `/fsp-audit` — file those as regular
  bug reports (`skill-request` or `rule-proposal` issue templates), not security reports,
  unless the false negative masks an exploitable condition in FullStack Pilot's own code.
- Vulnerabilities in `dotnet/skills` or other third-party marketplaces this project
  recommends installing — report those upstream.

## Handling of secrets

FullStack Pilot's own MCP configuration and hooks never inline credentials — every value
is read from an environment variable (see
[mcp-setup.md](../plugins/pilot-core/docs/mcp-setup.md)). If you find a secret checked
into this repository's history, report it privately rather than filing a public issue.
