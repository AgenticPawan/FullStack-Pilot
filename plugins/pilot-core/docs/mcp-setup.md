# MCP Server Setup — pilot-core

pilot-core ships MCP servers in two files:

- **`.mcp.json`** (auto-loaded) — contains **only `microsoft-learn`**, a Microsoft-hosted
  HTTP endpoint with no auth. It is the one server that earns unconditional trust, so it is
  the only one that starts automatically.
- **`.mcp.json.example`** (opt-in) — contains `playwright`, `github`, `azure-mcp`, and
  `sql-mcp`, each **pinned to a specific version/image tag**. None of these auto-load. They
  are added to your project `.mcp.json` only with explicit per-server consent — run
  `/mcp-discover` (or `/fsp-init`) and approve the ones you want. This keeps third-party code
  from executing in your session until you opt in, and keeps versions pinned (no `@latest`).

Each server that requires credentials reads them from environment variables — no secrets are
ever inlined. Set these variables in your shell profile, `.env` file (never committed), or
your CI/CD secret store before starting Claude Code.

> **Pinning:** the versions in `.mcp.json.example` (`@playwright/mcp@0.0.78`,
> `@azure/mcp@3.0.0-beta.25`, `ghcr.io/github/github-mcp-server:v1.5.0`) are intentionally
> pinned. Review the upstream changelog before bumping them. For `sql-mcp`, pin the DAB CLI
> at install time: `dotnet tool install --global Microsoft.DataApiBuilder --version 2.0.9`.

---

## 1. GitHub MCP Server

**Repository:** https://github.com/github/github-mcp-server  
**Transport:** stdio (via Docker)  
**Prerequisite:** Docker must be installed and running.

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_PERSONAL_ACCESS_TOKEN` | GitHub PAT with `repo`, `read:org`, `read:user` scopes | Yes |

**Minimum PAT scopes for read-only code navigation:** `repo` (or `public_repo` for public repos only).  
**Additional scopes for PR/issue management:** `read:org`, `read:user`, `read:discussion`.

Create a PAT at: https://github.com/settings/tokens

---

## 2. Microsoft Learn MCP Server

**Repository:** https://github.com/microsoftdocs/mcp  
**Transport:** HTTP (remote endpoint — `https://learn.microsoft.com/api/mcp`)  
**Prerequisite:** None. No API key, no login, no sign-up required.

No environment variables needed.

---

## 3. Playwright MCP Server

**Package:** `@playwright/mcp`  
**Transport:** stdio (via npx)  
**Prerequisite:** Node.js 18+ must be installed.

No environment variables required for default usage.

Optional environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PLAYWRIGHT_MCP_HEADLESS` | Run browser in headless mode (`true`/`false`) | `true` |
| `PLAYWRIGHT_MCP_BROWSER` | Browser to use (`chromium`, `firefox`, `webkit`) | `chromium` |

---

## 4. Azure MCP Server

**Package:** `@azure/mcp`  
**Repository:** https://github.com/microsoft/mcp/tree/main/servers/Azure.Mcp.Server  
**Transport:** stdio (via npx)  
**Prerequisite:** Node.js 18+ must be installed.

Authentication uses Azure DefaultAzureCredential — the server tries these in order:
1. Environment variables (service principal) — set all three below
2. Azure CLI (`az login`) — recommended for local development
3. Managed Identity — used automatically in Azure-hosted environments

**For local development:** run `az login` — no env vars needed.

**For CI/CD (service principal):**

| Variable | Description | Required |
|----------|-------------|----------|
| `AZURE_TENANT_ID` | Azure AD tenant ID (GUID) | Yes (SP auth) |
| `AZURE_CLIENT_ID` | Service principal / app registration client ID | Yes (SP auth) |
| `AZURE_CLIENT_SECRET` | Service principal client secret | Yes (SP auth) |

Optional:

| Variable | Description |
|----------|-------------|
| `AZURE_MCP_COLLECT_TELEMETRY` | Set to `false` to disable all telemetry |
| `AZURE_SUBSCRIPTION_ID` | Default subscription when not specified in tool calls |

---

## 5. SQL MCP Server (Data API Builder)

**Tool:** `dab` CLI (Data API Builder)  
**Transport:** stdio  
**Prerequisite:** Install the DAB CLI: `dotnet tool install --global Microsoft.DataApiBuilder`

The SQL MCP Server is a feature of Data API Builder (DAB) version 1.7+. It requires
a `dab-config.json` in the project root to know which database to connect to and which
entities to expose. Without this file, `dab start --mcp-stdio` will not start.

**One-time project setup:**

```bash
# 1. Install the DAB CLI (once per machine)
dotnet tool install --global Microsoft.DataApiBuilder

# 2. Initialise DAB config in your project root (replace <connection-string>)
dab init \
  --database-type mssql \
  --connection-string "@env('SQL_CONNECTION_STRING')" \
  --config dab-config.json \
  --host-mode development

# 3. Add entities you want the MCP server to expose (example)
dab add Products \
  --source dbo.Products \
  --source.type table \
  --permissions "anonymous:read" \
  --description "Product catalog"
```

Using `@env('SQL_CONNECTION_STRING')` keeps the actual value out of `dab-config.json`.

| Variable | Description | Required |
|----------|-------------|----------|
| `SQL_CONNECTION_STRING` | Full ADO.NET connection string to SQL Server | Yes |

`dab-config.json` is safe to commit; it contains entity definitions, not secrets.  
Do **not** commit `dab-config.development.json` if it contains inlined credentials.

Full DAB documentation: https://learn.microsoft.com/en-us/azure/data-api-builder/

---

## Quick-reference: all variables

| Variable | Server | Required |
|----------|--------|----------|
| `GITHUB_PERSONAL_ACCESS_TOKEN` | github | Yes |
| `AZURE_TENANT_ID` | azure-mcp | Yes (SP only) |
| `AZURE_CLIENT_ID` | azure-mcp | Yes (SP only) |
| `AZURE_CLIENT_SECRET` | azure-mcp | Yes (SP only) |
| `SQL_CONNECTION_STRING` | sql-mcp | Yes (via dab-config.json) |
| `PLAYWRIGHT_MCP_HEADLESS` | playwright | No |
| `PLAYWRIGHT_MCP_BROWSER` | playwright | No |
| `AZURE_MCP_COLLECT_TELEMETRY` | azure-mcp | No |
| `AZURE_SUBSCRIPTION_ID` | azure-mcp | No |
