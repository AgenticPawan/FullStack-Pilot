---
name: mcp-discovery
description: Scans the project dependency graph for technologies that have companion MCP servers, proposes a curated list with one-line supply-chain risk notes, and writes approved entries into the project .mcp.json only after explicit per-server user consent. Never auto-registers third-party servers.
when_to_use: Run automatically at the end of /pilot-init after scaffold completes. Also triggered when the user runs /mcp-discover or asks "what MCP servers should I add?".
---

<!-- CONSTRAINTS -->
<!-- INPUT: PROJECT_ROOT/.claude/pilot/stack-profile.json (must exist) -->
<!-- NEVER write to .mcp.json without explicit per-server approval -->
<!-- NEVER inline credentials — all secrets via environment variables -->
<!-- SUPPLY-CHAIN RULE: treat every third-party MCP server as untrusted until user confirms -->

## Step 1 — Read the confirmed profile

Read `PROJECT_ROOT/.claude/pilot/stack-profile.json`.

Extract:
- `angular` (non-null → frontend detected)
- `dotnet.projects[*].packages` (scan for efCore, resilience, serilog, etc.)
- `sql` (non-null → SQL Server dependency)
- `azure` (non-null → Azure resources)
- `azure.dockerfiles` (non-empty → container workloads)

---

## Step 2 — Scan package files for additional dependencies

Read `package.json` (if exists) and each `*.csproj` detected in the profile.

Look for the following patterns to identify additional MCP server candidates:

**From `package.json` dependencies/devDependencies:**
- `redis` or `ioredis` → Redis MCP candidate
- `@azure/service-bus` → Azure Service Bus (covered by azure-mcp)
- `playwright` or `@playwright/test` → Playwright MCP (already registered in pilot-core)
- `@apollo/client` or `graphql` → no standard MCP yet — skip

**From `*.csproj` PackageReferences:**
- `StackExchange.Redis` or `Microsoft.Extensions.Caching.StackExchangeRedis` → Redis MCP candidate
- `Azure.Messaging.ServiceBus` → Azure Service Bus (covered by azure-mcp)
- `Azure.Messaging.EventHubs` → Azure Event Hubs (covered by azure-mcp)
- `RabbitMQ.Client` or `MassTransit` → RabbitMQ MCP candidate
- `MongoDB.Driver` → MongoDB MCP candidate
- `Npgsql` or `Npgsql.EntityFrameworkCore.PostgreSQL` → PostgreSQL MCP candidate

---

## Step 3 — Build the proposal table

For each candidate server, determine:

1. Whether it is already **registered by pilot-core** (in `.mcp.json` bundled with this plugin):
   - `github` — registered if project has `.github/` or `azure.githubActionsAzure`
   - `microsoft-learn` — always available (HTTP, no auth)
   - `playwright` — registered; relevant if Playwright detected in packages
   - `azure-mcp` — registered; relevant if `azure` non-null
   - `sql-mcp` — registered; relevant if `sql` non-null — **requires DAB config setup**

2. Whether it is a **third-party candidate** needing a new `.mcp.json` entry:
   - Redis MCP
   - RabbitMQ MCP
   - MongoDB MCP
   - PostgreSQL MCP

Use this risk classification:

| Category | Risk note template |
|----------|--------------------|
| Microsoft-published server | Low risk — published by Microsoft; review changelog before updates |
| Well-known community server | Medium risk — community-maintained; pin to a specific version |
| Unknown/new server | High risk — unverified provenance; audit source before enabling |

---

## Step 4 — Print the proposal and ask for approval

Print:

```
## MCP Server Candidates for <project-name>

The following servers were identified based on your stack profile and dependencies.
Servers already registered by pilot-core are marked ✓ registered.
Third-party servers require your explicit approval before being added.

### Already registered by pilot-core
(These start automatically when pilot-core is enabled. No action needed unless
noted — configure credentials as described in docs/mcp-setup.md.)

| # | Server         | Relevant because…                        | Action needed                                |
|---|----------------|------------------------------------------|----------------------------------------------|
<row per registered server that is relevant>

### Third-party candidates (require your approval)

| # | Server         | Package/tech detected     | Install command                        | Risk |
|---|----------------|---------------------------|----------------------------------------|------|
<row per third-party candidate>

Reply with the **numbers** of any third-party servers you want to add, separated by
commas (e.g. "1, 3"), or **NONE** to skip all.

⚠  Supply-chain reminder: each MCP server executes code in your session.
   Review the source repository before approving any third-party server.
```

**Wait for the user's reply before proceeding.**

If the user replies NONE or approves no servers, skip to Step 6.

---

## Step 5 — Write approved entries to project .mcp.json

For each approved server, add an entry to `PROJECT_ROOT/.mcp.json` (create the file if absent).

Use the following configuration templates:

**Redis MCP** (`@modelcontextprotocol/server-redis`):
```json
"redis": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-redis", "${REDIS_URL}"],
  "env": {
    "REDIS_URL": "${REDIS_URL}"
  }
}
```
Required env: `REDIS_URL` (e.g. `redis://localhost:6379`)

**RabbitMQ MCP** (`@modelcontextprotocol/server-rabbitmq`):
```json
"rabbitmq": {
  "command": "npx",
  "args": ["-y", "@cloudamqp/mcp-server-rabbitmq"],
  "env": {
    "RABBITMQ_URL": "${RABBITMQ_URL}"
  }
}
```
Required env: `RABBITMQ_URL` (e.g. `amqp://user:pass@localhost`)

**MongoDB MCP** (`mongodb-mcp-server`):
```json
"mongodb": {
  "command": "npx",
  "args": ["-y", "mongodb-mcp-server"],
  "env": {
    "MDB_MCP_CONNECTION_STRING": "${MONGODB_CONNECTION_STRING}"
  }
}
```
Required env: `MONGODB_CONNECTION_STRING`

**PostgreSQL MCP** (`@modelcontextprotocol/server-postgres`):
```json
"postgres": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres", "${POSTGRES_CONNECTION_STRING}"],
  "env": {
    "POSTGRES_CONNECTION_STRING": "${POSTGRES_CONNECTION_STRING}"
  }
}
```
Required env: `POSTGRES_CONNECTION_STRING` (e.g. `postgresql://user:pass@localhost/db`)

When writing `PROJECT_ROOT/.mcp.json`:
- If the file already exists, merge new `mcpServers` entries; do not overwrite existing entries.
- Use `${ENV_VAR}` placeholders — never inline actual credential values.

---

## Step 6 — Print final summary

Print:

```
## MCP Discovery Complete

Registered by pilot-core (auto-start):
  <list with status — credentials needed or ready>

Added to PROJECT_ROOT/.mcp.json:
  <list of newly added servers, or "none">

Next steps:
  • Set the required environment variables documented in
    plugins/pilot-core/docs/mcp-setup.md before using credential-dependent servers.
  • For sql-mcp: run `dab init` to create dab-config.json before the server can start.
    See: https://learn.microsoft.com/en-us/azure/data-api-builder/command-line
  • Commit PROJECT_ROOT/.mcp.json to version control (it contains no secrets).
```
