# Devlane Agent Instructions

## Project Shape

Devlane is a Node.js ESM CLI for provisioning per-worktree development infrastructure for coding agents. The primary entrypoint is:

```bash
devlane
```

From a source checkout, use:

```bash
npm run devlane -- <command>
```

## Setup

Install dependencies:

```bash
npm ci
```

The full test suite can use local Postgres binaries when available:

```bash
postgres
initdb
pg_isready
psql
createdb
```

Postgres-dependent tests are skipped when those commands are missing.

## Verification

Run the full local verification before committing code changes:

```bash
npm run verify
```

For package/install work, also run:

```bash
npm run smoke:package
```

For focused work, run the relevant `node --test` file first, then run `npm run verify` before finishing.

## Runtime Safety

- Use an isolated `DEVLANE_HOME` under `/private/tmp` or `/tmp` for tests and manual experiments.
- Do not run cleanup against the user's real `~/.devlane` unless explicitly requested.
- Do not stop or delete real Smolmachines VMs unless the task explicitly asks for it and the VM is positively identified as Devlane-owned.
- Do not run Docker or Docker Compose unless the task explicitly asks for Docker behavior.
- Do not commit `.devlane/`, `.env.local`, `node_modules/`, or local runtime state.

## Codex Integration Rules

- `.codex/environments/environment.toml` is the primary Codex Local Environment integration path.
- Generated setup/cleanup scripts must use `CODEX_WORKTREE_PATH`.
- Generated Codex scripts must be worktree-relative and must not bake in a stale source checkout path.
- SessionStart hooks are context-only; they should not provision VMs or start backend processes.

## Packaging Rules

- The npm package must expose the `devlane` bin.
- Packaged installs should generate Codex config that calls `devlane`, not `node /path/to/src/cli/index.js`.
- Source checkouts may use the explicit `node src/cli/index.js` path for local development.
