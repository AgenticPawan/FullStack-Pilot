# FullStack Pilot

> Codebase governance for full-stack Microsoft shops

**FullStack Pilot** is a [Claude Code](https://claude.ai/code) plugin marketplace with
ready-to-use skills, agents, and hooks for Angular + .NET + SQL Server + Azure codebases.
It enforces team conventions, catches common mistakes, and automates code-quality checks
without burdening every developer with configuration.

## Install

Add the marketplace once, then install whichever plugins you need:

```shell
/plugin marketplace add AgenticPawan/FullStack-Pilot
```

```shell
/plugin install pilot-core@FullStack-Pilot
/plugin install pilot-angular@FullStack-Pilot
/plugin install pilot-dotnet@FullStack-Pilot
/plugin install pilot-sql@FullStack-Pilot
/plugin install pilot-azure@FullStack-Pilot
```

### Local / development install

Clone the repo, then load the marketplace from disk:

```shell
git clone https://github.com/AgenticPawan/FullStack-Pilot
cd FullStack-Pilot
```

Inside a Claude Code session, run:

```shell
/plugin marketplace add ./
```

Or start Claude Code with the individual plugin loaded directly:

```shell
claude --plugin-dir ./plugins/pilot-core
```

## Plugins

| Plugin | Version | Purpose |
|---|---|---|
| `pilot-core` | 0.1.0 | Shared governance: commit conventions, PR templates, code-health checks |
| `pilot-angular` | 0.1.0 | Angular/TypeScript: component patterns, signal migration, standalone best practices |
| `pilot-dotnet` | 0.1.0 | C#/ASP.NET Core: minimal-API patterns, EF Core, NuGet security audits |
| `pilot-sql` | 0.1.0 | SQL Server/EF Core: migration safety, query review, index analysis |
| `pilot-azure` | 0.1.0 | Azure/Bicep/ACA: resource-naming rules, cost guardrails, deployment safety hooks |

## Validate locally

The repository ships a zero-dependency Node.js validator. Run it before opening a PR:

```shell
node scripts/validate.mjs
```

It checks all `marketplace.json`, `plugin.json`, `SKILL.md`, and `hooks.json` files for
schema correctness and exits non-zero on any failure.

## Contributing

See [CLAUDE.md](CLAUDE.md) for plugin layout conventions, `SKILL.md` frontmatter
requirements, hooks path-scoping rules, and commit message format.

## License

[MIT](LICENSE) © FullStack Pilot Contributors
