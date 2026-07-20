# C# LSP Setup for pilot-dotnet

pilot-dotnet ships `.lsp.json` wiring a C# language server so Claude sees real-time
compiler diagnostics (errors, warnings, go-to-definition) while editing `.cs` files.
**The plugin configures the connection; you must install the server binary separately.**

---

## Option A — csharp-ls (default, recommended)

`csharp-ls` is a community language server that wraps the Roslyn OmniSharp engine.
It is lightweight, cross-platform, and does not require a full Visual Studio install.

```bash
dotnet tool install --global csharp-ls
```

After installation, `csharp-ls` is on PATH. Restart Claude Code (or run `/reload-plugins`)
to activate the LSP integration.

**Requires:** .NET SDK 6.0 or later on PATH.

---

## Option B — Microsoft.CodeAnalysis.LanguageServer (official MS server)

The official Roslyn-based language server ships as a dotnet global tool and provides the
same intelligence that powers Visual Studio Code's C# Dev Kit extension.

```bash
dotnet tool install --global microsoft.codeanalysis.languageserver
```

After installation, update `.lsp.json` in the plugin to use the correct binary name:

```json
{
  "csharp": {
    "command": "Microsoft.CodeAnalysis.LanguageServer",
    "extensionToLanguage": { ".cs": "csharp" },
    "restartOnCrash": true,
    "shutdownTimeout": 5000
  }
}
```

**Note:** This server loads solution/project context differently; point it at your `.sln`
via `initializationOptions` if auto-discovery does not pick it up.

---

## Version requirements

`restartOnCrash` and `shutdownTimeout` require **Claude Code v2.1.205 or later**.
Before v2.1.205 the config schema accepted these fields but the server was skipped at
startup with the reason visible only in `claude --debug`. Run `claude --version` to confirm.

---

## TypeScript / Angular

For Angular and TypeScript projects, install the official **`typescript-lsp`** plugin from
the Claude Code marketplace rather than wiring a custom `.lsp.json` in pilot-angular:

```
/plugin install typescript-lsp
```

Multiple LSP plugins declaring the same file extension: the first registered wins and the
others are skipped. `typescript-lsp` is the canonical TypeScript server; pilot-angular
does not ship a duplicate to avoid the extension conflict.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Executable not found in $PATH` in `/plugin` Errors tab | Install the binary (Option A or B above) and restart |
| Server crashes on large solutions | Increase `shutdownTimeout`; try Option B for better Roslyn integration |
| Extension conflict with another LSP plugin | Run `claude --debug` to see which server won the `.cs` extension |
