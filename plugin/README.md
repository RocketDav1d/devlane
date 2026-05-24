# Devlane Codex Plugin

This directory is the distributable Codex plugin scaffold.

It bundles:

- Devlane skill guidance.
- MCP server registration for `devlane mcp serve`.
- A standalone MCP config snippet at `mcp/devlane-mcp.json`.

The current product path still uses repo-local installation:

```bash
devlane install-codex --project /path/to/repo
```

The npm package exposes the `devlane` binary, so a globally installed package can serve the MCP entrypoint used by the plugin scaffold.
