# pilot-dotnet

**Status: manifest only.** This plugin currently ships nothing but a `plugin.json` —
no skills, no agents, no hooks. Installing it does nothing useful yet; it exists as a
placeholder in the marketplace catalog.

## Why it's empty

FullStack Pilot deliberately does not reimplement Microsoft's official
[`dotnet/skills`](https://github.com/dotnet/skills) marketplace. When `/pilot-init`
detects a .NET project, it prints the exact commands to install `dotnet/skills`
(`dotnet-data`, `dotnet-test`, `dotnet-upgrade`, `dotnet-aspnetcore`, `dotnet-ai`) instead
of duplicating that coverage. See the root [README](../README.md#relationship-to-dotnetskills).

## What will land here

Future releases will add house-specific conventions that Microsoft's skills
intentionally leave to each team:

- Serilog structured-logging policy
- HTTP resilience policy (retry/circuit-breaker conventions beyond what
  `dotnet-aspnetcore` covers)
- Any org-specific EF Core or minimal-API conventions not owned by `dotnet/skills`

Until then, skip installing `pilot-dotnet` — install `pilot-core` and run `/pilot-init`,
which wires `dotnet/skills` for you.
