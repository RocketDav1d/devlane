# Devlane

Devlane is a local development infrastructure layer for coding agents.

The current implementation is an MVP vertical slice:

- installable Node CLI package with `devlane` bin
- TypeScript-ready project config with `npm run typecheck`
- real `yaml` parser plus Zod schema validation for `devlane.yaml`
- process runtime driver
- per-worktree state
- automatic port allocation
- app process supervision
- health checks
- official MCP SDK server
- foreground daemon with JSON-over-Unix-socket RPC
- background daemon start/stop
- macOS launchd install/uninstall support
- daemon garbage collection and log rotation
- per-worktree lifecycle locking
- cross-process lifecycle lock files under `DEVLANE_HOME/locks`
- managed service processes before dependent apps
- real Postgres fixture using local Postgres binaries
- `database.reset.commands`
- `devlane reset-db`
- `devlane restart [service]`
- `devlane logs --follow`
- structured setup/reset/healthcheck errors
- `devlane doctor --codex`
- `devlane codex verify`
- Codex plugin package scaffold under `plugin/`
- Codex demo repo under `examples/codex-node-postgres`
- richer `devlane init --detect`
- CLI-backed Smolmachines driver for mounted microVM execution and guest process supervision
- generated `.env.local`
- generated `.devlane/context.md`
- Codex setup/context commands
- Codex integration asset installer

## Try The Fixture

```bash
npm run verify
npm run smoke:package
```

From a source checkout, run the example environment through npm so the command path matches the packaged CLI:

```bash
DEVLANE_HOME=/private/tmp/devlane-demo npm run devlane -- up --project fixtures/node-basic
DEVLANE_HOME=/private/tmp/devlane-demo npm run devlane -- status --project fixtures/node-basic
DEVLANE_HOME=/private/tmp/devlane-demo npm run devlane -- logs api --project fixtures/node-basic
DEVLANE_HOME=/private/tmp/devlane-demo npm run devlane -- restart api --project fixtures/node-basic
DEVLANE_HOME=/private/tmp/devlane-demo npm run devlane -- destroy --project fixtures/node-basic
```

Once installed as a package, use `devlane` directly instead of `npm run devlane --`.

Run the daemon in a separate terminal:

```bash
DEVLANE_HOME=/private/tmp/devlane-demo npm run devlane -- daemon start
```

Or run it in the background:

```bash
DEVLANE_HOME=/private/tmp/devlane-demo npm run devlane -- daemon start --background
DEVLANE_HOME=/private/tmp/devlane-demo npm run devlane -- daemon stop
```

Commands automatically try the daemon first. If it is not running, they fall back to direct local execution.

Lifecycle operations for a single worktree are serialized in-process and across processes through lock files under `DEVLANE_HOME/locks`, so concurrent setup/reset/destroy calls do not interleave.

Install the daemon as a macOS launch agent:

```bash
devlane daemon install
devlane daemon status
devlane daemon uninstall
```

Clean up stale environments and rotate oversized logs:

```bash
devlane daemon gc
devlane daemon gc --dry-run --max-age-days 3 --max-log-mb 10
devlane daemon gc --dry-run --json
devlane daemon gc --dry-run --smolmachines-machines-json /path/to/smolvm-machines.json
```

Garbage collection removes only safe local process-runtime state by default. Smolmachines orphan detection is currently report-only and requires an explicit machine-list JSON input; it does not stop or delete VMs.

## Database Reset

Projects can define reset commands:

```yaml
database:
  reset:
    commands:
      - pnpm db:reset
      - pnpm db:seed
```

Then run:

```bash
devlane reset-db --project /path/to/repo
```

## Failure Output

Setup, reset, and healthcheck failures use structured Devlane errors:

```text
Healthcheck failed for app "api".

Code: DEVLANE_HEALTHCHECK_FAILED
Component: app.api
Operation: healthcheck

Details:
- Healthcheck: {"url":"http://localhost:49123/health","interval_ms":50,"timeout_ms":300}
- Last result: fetch failed
- Log path: /Users/alice/.devlane/logs/env_abc/api.log

Suggested next steps:
- Run devlane logs api to inspect process output.
- Check that the command starts on the configured PORT.
- Check the healthcheck command or URL in devlane.yaml.
```

The same structured errors are preserved through daemon RPC, so CLI commands behave consistently with or without the daemon running.

## Codex Commands

These are the commands Codex integration assets call:

```bash
devlane codex setup --project "$CODEX_WORKTREE_PATH"
devlane codex context --project "$CODEX_WORKTREE_PATH"
```

Install Codex integration assets into a repo:

```bash
devlane install-codex --project /path/to/repo
```

This writes:

- `.codex/devlane/setup.sh`
- `.codex/devlane/cleanup.sh`
- `.codex/devlane/session-start-hook.sh`
- `.codex/devlane/codex-environment-snippets.md`
- `.codex/environments/environment.toml`
- `.codex/hooks.json`
- `.codex/config.toml`
- `.agents/skills/devlane/SKILL.md`

For automatic Codex worktree provisioning, Codex should discover `.codex/environments/environment.toml`. If it does not appear in Settings -> Environments, configure the Local Environment manually with the generated snippets file. Project-local hooks only inject context; the Local Environment setup script is the mechanism that creates or reattaches the Devlane runtime for each new worktree.

Verify Codex integration:

```bash
devlane doctor --codex --project /path/to/repo
devlane codex verify --project /path/to/repo
```

Verification checks:

- `devlane.yaml`
- `.codex/devlane/setup.sh`
- `.codex/devlane/cleanup.sh`
- `.codex/devlane/session-start-hook.sh`
- `.codex/devlane/codex-environment-snippets.md`
- `.codex/environments/environment.toml`
- `.codex/hooks.json`
- `.codex/config.toml`
- `.agents/skills/devlane/SKILL.md`

The distributable plugin scaffold lives under `plugin/` and currently contains:

- `.codex-plugin/plugin.json`
- `mcp/devlane-mcp.json`
- `skills/devlane/SKILL.md`
- `skills/devlane/agents/openai.yaml`

Repo-local installation is still the primary tested path.

## Codex Demo

The demo repo under `examples/codex-node-postgres` shows the intended Codex flow with a Node API, managed local Postgres service, reset command, and Codex integration assets.

```bash
cd examples/codex-node-postgres
npm --prefix ../.. run devlane -- install-codex --project .
npm --prefix ../.. run devlane -- codex verify --project .
npm --prefix ../.. run devlane -- up --project .
```

The Postgres demo requires local `postgres`, `initdb`, `pg_isready`, `psql`, and `createdb` binaries.

The demo API exposes:

- `GET /health`
- `GET /todos`
- `POST /todos`
- `GET /events/count`

Its setup path runs SQL migrations and seed data before the API is considered healthy. `devlane reset-db` drops and recreates the schema, reruns migrations/seed data, and restarts the API.

## Init Detection

`devlane init --detect` now drafts:

- package manager install command
- app command from `dev:api` or `dev`
- Prisma migrate command when `prisma/schema.prisma` exists
- Compose-backed Postgres service
- Compose-backed Redis service

Example:

```bash
devlane init --detect --project /path/to/repo
```

## Runtime Status

The MVP supports two runtime drivers:

- `process`: runs apps and services directly on the host for fast local prototyping.
- `smolmachines`: shells out to the real `smolvm` CLI to create an isolated microVM per Devlane environment.

The Smolmachines driver:

- checks the configured `smolvm` binary with `smolvm --version`
- creates a machine named `devlane-<env-id>`
- mounts the worktree at `/workspace`
- mounts environment logs at `/devlane/logs`
- passes allocated host/guest port mappings with `smolvm machine create --port HOST:GUEST`
- enables outbound networking by default unless `runtime.network: false`
- runs setup/reset commands through `smolvm machine exec -- sh -lc <command>`
- starts long-running app/service commands through a host-side `smolvm machine exec --stream` supervisor
- stops supervised processes by stopping that host-side supervisor
- stops and deletes the machine on destroy

Install Smolmachines before using `runtime.driver: smolmachines`:

```bash
curl -sSL https://smolmachines.com/install.sh | bash -s -- --no-modify-path
```

If the binary is not on PATH, configure it explicitly:

```yaml
runtime:
  driver: smolmachines
  smolvmBinary: /Users/you/.local/bin/smolvm
```

Remaining risk:

- daemon restart reattachment is derived from the deterministic machine name and needs broader restart/resume testing
- guest process termination depends on how `smolvm machine exec --stream` propagates host supervisor shutdown

## Fixtures

- `fixtures/node-basic`: one managed API process.
- `fixtures/service-dependency`: one managed service process plus one dependent API process.
- `fixtures/postgres-basic`: local Postgres service plus an API that uses `DATABASE_URL`.

The service-dependency fixture verifies that services become healthy before apps start.
The Postgres fixture verifies service URL generation, database reset commands, and app restart against a real database. Its test skips when `postgres`, `initdb`, `pg_isready`, `psql`, or `createdb` are unavailable.
