# Devlane Implementation Spec

## Product Goal

Devlane is a local development infrastructure layer for coding agents.

The MVP does not replace Codex, Conductor, Claude Code, Cursor, or Emdash. It prepares the backend environment those tools need.

Core promise:

> When a new agent worktree is created, Devlane automatically provisions a ready-to-use isolated backend stack for that worktree.

For Codex Mac, the intended user experience is:

1. User opens a repo in Codex.
2. User starts a new thread/worktree.
3. Codex runs the repo's local environment setup script.
4. Devlane provisions the environment.
5. Codex starts with live API, DB, service URLs, logs, and reset commands already available.

The user should not need to type `devlane` during normal Codex usage after first installation.

## Verified MVP State

Status as of May 23, 2026:

The MVP proof now works end to end for a simple Codex Mac local-environment project.

Verified flow:

1. A repo contains `devlane.yaml`.
2. The repo contains generated Codex assets:
   - `.codex/environments/environment.toml`
   - `.codex/devlane/setup.sh`
   - `.codex/devlane/cleanup.sh`
   - `.codex/devlane/session-start-hook.sh`
   - `.codex/hooks.json`
   - `.codex/config.toml`
   - `.agents/skills/devlane/SKILL.md`
3. User opens the repo in Codex Mac.
4. Codex runs the project Local Environment setup script during worktree startup.
5. Devlane provisions or reattaches a Smolmachines VM for that worktree.
6. Devlane starts the configured backend app in the VM.
7. Devlane writes `.env.local` and `.devlane/context.md`.
8. Codex can inspect those files and immediately test the API.

Concrete verified test repo:

```text
/Users/davidkorn/Documents/Hubert/devlane-codex-smol-test
```

Current verified runtime:

```text
Environment: env_41477eba6b8f
VM: devlane-env_41477eba6b8f
Runtime: smolmachines
Image: node:22-alpine
API: http://localhost:57861
Health: {"ok":true}
```

Verified user-facing outcome:

```text
New Codex chat/worktree starts with Devlane already provisioned.
The user does not have to ask Codex to start the backend.
Codex can immediately reach the generated API URL.
```

Important validated implementation details:

- `.codex/environments/environment.toml` is the currently verified Codex Local Environment registration format.
- Setup and cleanup scripts use `CODEX_WORKTREE_PATH`.
- Generated environment scripts call `"$worktree/.codex/devlane/setup.sh"` and `"$worktree/.codex/devlane/cleanup.sh"`, so committed config works from fresh worktrees.
- SessionStart hooks are context-only. They do not provision infrastructure.
- Re-running setup reattaches instead of creating duplicate services.
- Smolmachines is used directly. This verified flow does not create Docker containers, Docker Compose stacks, Docker volumes, or Docker networks.

Recent bugs found and fixed during verification:

- Worktree-relative Codex config: older generated hooks and environment snippets used absolute paths back to the source checkout. Fresh worktrees now use worktree-relative paths.
- Stale port rewrite: reattaching to a running environment previously allocated a new host port because the existing forwarded port was occupied by Smolmachines, then rewrote `.env.local` to a dead URL. Reattach now preserves existing port bindings.
- Duplicate worktree records: if branch identity changes after an initial commit, old records can remain for the same worktree. Lookup now prefers the current identity and otherwise falls back to the most recently updated record.

Current automated verification:

```text
npm run verify
40 tests passing
```

Test coverage currently includes:

- Codex installer output.
- Codex verification checks.
- Stale absolute Codex script path detection.
- Duplicate Codex local environment file detection.
- Codex local environment config generation.
- Worktree-relative hook/config behavior.
- Smolmachines driver behavior with a fake CLI runner.
- Real process-driver app provisioning.
- Real Postgres fixture.
- Realistic Codex Node + Postgres example with migrations, seed data, API writes, event tracking, reset, and app restart.
- Reattach port reuse.
- Duplicate worktree state lookup.
- Duplicate worktree state garbage-collection reporting.
- Safe process-runtime duplicate cleanup.
- Report-only Smolmachines orphan candidate detection.
- Daemon RPC.
- MCP server tools.
- Reset/restart/logs/lifecycle locks.

Completed parallel hardening pass:

- Agent A hardened Codex integration verification and generation.
- Agent B added cleanup/runtime-safety reporting without deleting external runtimes.
- Agent C upgraded `examples/codex-node-postgres` into a realistic API + Postgres fixture.

## Next Build Steps

Recommended order from here:

1. Validate the Codex MVP across repeated real Codex worktree creation.
   - Keep `.codex/environments/environment.toml` as the primary integration path.
   - Keep snippets as fallback documentation only.
   - Create several fresh Codex chats/worktrees and confirm setup runs every time.
   - Confirm cleanup runs when Codex deletes a worktree.
   - Capture exact failure modes when Codex does not run setup, does not load project-local environment config, or asks for hook trust.

2. Turn Smolmachines cleanup from report-only into explicit safe actions.
   - Keep current `daemon gc --dry-run` behavior as the default safety surface.
   - Add an explicit command/flag for stopping and deleting orphaned Devlane Smolmachines VMs.
   - Require positive identification by Devlane env id and machine name before deletion.
   - Add tests that use fake machine lists and fake drivers, not real VMs.

3. Add the next service type after Postgres.
   - Then add Redis.
   - Then add Neo4j or another graph/database service if it matches the target customer use case.
   - Validate migrations, seed data, reset, app logs, and health checks.

4. Improve Smolmachines runtime reliability.
   - Test daemon restart and host reboot reattachment.
   - Verify host-side `smolvm machine exec --stream` supervisor behavior over long sessions.
   - Store enough runtime metadata to recover cleanly after process death.
   - Add explicit machine/resource inspection to `devlane status`.

5. Productize local installation.
   - Decide whether MVP is an npm package, Homebrew tap, or bundled binary.
   - Add `devlane doctor` checks for Codex app, `smolvm`, Node, PATH, and project config.
   - Add an uninstall/cleanup path.

6. Add agent-facing management surfaces.
   - Expand MCP tools to include `destroy`, `doctor`, and structured environment health.
   - Make logs/status/reset ergonomic inside Codex without prompting users to remember commands.
   - Later: explore a real Codex integration/plugin once third-party packaging is stable enough.

7. Define the hosted/product direction.
   - Decide what remains local-only versus managed by Devlane cloud.
   - Define whether Devlane owns snapshots, secrets, team templates, remote VM pools, or dashboards.
   - Keep implementation-agent features out of scope until the infrastructure layer is solid.

## Parallel Execution Plan

The project can now split work across multiple agents, but only if each agent has a disjoint ownership area and isolated runtime state.

Required safety rules:

- Each agent must use its own worktree.
- Each runtime-testing agent must use its own `DEVLANE_HOME`, preferably under `/private/tmp`.
- Agents must not share `~/.devlane` unless the task is explicitly about global cleanup.
- Agents must not run cleanup against real user worktrees or Docker resources.
- Agents should not edit files outside their ownership scope without reporting why.

Current parallel workstreams:

```text
Agent A: Codex integration hardening
Owns:
- src/cli/commands/install-codex.js
- src/integrations/codex/verify.js
- test/install-codex.test.js
- test/codex-demo.test.js

Goal:
- Make the verified .codex/environments/environment.toml path robust.
- Detect stale absolute paths.
- Detect duplicate .codex/environments/environment-*.toml files.
- Keep tests file-based, no real VMs.
```

```text
Agent B: cleanup and runtime safety
Owns:
- src/daemon/gc.js
- src/daemon/state-store.js
- cleanup/gc/state tests

Goal:
- Report duplicate records for the same worktree.
- Add safe dry-run cleanup output.
- Prepare orphan Smolmachines VM cleanup without touching real VMs in tests.
```

```text
Agent C: realistic service fixture
Owns:
- fixtures/
- examples/
- fixture tests

Goal:
- Move beyond the toy Node API.
- Improve or add an API + Postgres fixture.
- Validate migration/seed/reset/app health using isolated DEVLANE_HOME.
```

Sequential dependencies:

1. Codex integration hardening should land before packaging or plugin UX.
2. Cleanup/runtime safety should land before adding heavier Redis/Neo4j fixtures.
3. API + Postgres should land before Redis/Neo4j.
4. Smolmachines restart/reattach reliability should land before claiming daily-driver readiness.
5. Packaging should wait until the CLI/config/environment contract stabilizes.

Merge order recommendation:

1. Agent A first if it only touches Codex file generation and verification.
2. Agent B second because it affects state safety and cleanup semantics.
3. Agent C third because heavier fixtures benefit from safer cleanup.
4. Run `npm run verify` after each merge.

## MVP Scope

Target platform:

- macOS first.
- Codex Mac app first.
- Local-only infrastructure first.
- One VM/environment per git worktree.

Supported services in MVP:

- Postgres.
- Redis.
- One app/backend process.
- Optional second app process, such as worker or frontend.

Out of scope for MVP:

- Built-in agent UI.
- Code editor.
- PR review UI.
- Issue tracker ingestion.
- Hosted cloud environments.
- Multi-user team dashboard.
- Multi-VM service graph.
- Kubernetes.

## Current Implementation Status

Status as of May 23, 2026:

- A first Node.js MVP vertical slice exists.
- The project is TypeScript-ready with `tsconfig.json`, `npm run typecheck`, and `npm run verify`.
- `devlane.yaml` uses the real `yaml` parser and Zod schema validation.
- The default runtime driver is `process`.
- The `smolmachines` runtime driver shells out to the real `smolvm` CLI, creates mounted machines, passes host/guest port mappings, runs commands, supervises long-running guest commands with host-side `smolvm machine exec --stream` processes, and stops/deletes machines.
- The CLI can provision the fixture app, wait for health, write context files, show status/logs, and destroy the environment.
- Codex integration assets can be generated with `devlane install-codex`.
- `devlane codex setup` and `devlane codex context` exist.
- The MCP server uses the official `@modelcontextprotocol/sdk` and exposes `devlane.status`, `devlane.logs`, `devlane.reset_db`, and `devlane.restart`.
- A foreground daemon exists with JSON-over-Unix-socket RPC.
- The daemon can run in the foreground or background and can be stopped with `devlane daemon stop`.
- The daemon can be installed/uninstalled as a macOS launch agent with `devlane daemon install` and `devlane daemon uninstall`.
- `devlane daemon gc` removes stale environment state and rotates oversized logs.
- CLI and MCP commands try the daemon first, then fall back to direct local execution.
- `devlane install-codex` writes `.codex/hooks.json` and `.codex/config.toml` entries for SessionStart and MCP.
- `devlane reset-db` exists and runs `database.reset.commands`, then restarts app processes.
- MCP includes `devlane.reset_db`.
- Managed service processes receive allocated `PORT` values and healthcheck URLs are interpolated before polling.
- A real Postgres fixture exists using local Postgres binaries and validates `DATABASE_URL`, reset commands, app restart, and seeded data.
- Setup, reset, and healthcheck failures use structured `DevlaneError` output with component, operation, details, log paths, and suggested next steps.
- Daemon RPC preserves structured `DevlaneError` payloads for CLI/MCP callers.
- `devlane doctor --codex` and `devlane codex verify` validate repo-local Codex setup assets.
- Environment lifecycle operations are serialized per worktree inside one daemon/manager instance and across processes with lock files under `DEVLANE_HOME/locks`.
- `devlane restart [service]` restarts one app/service, and restarting a service also restarts apps.
- `devlane logs --follow` tails logs continuously.
- A Codex plugin package scaffold exists under `plugin/`.
- A standalone MCP config snippet exists under `plugin/mcp/devlane-mcp.json`.
- A Codex demo repo exists under `examples/codex-node-postgres`.
- The package metadata exposes an installable `devlane` bin and npm package file list.
- `devlane init --detect` detects package scripts, package install commands, Prisma migrations, and Compose-backed Postgres/Redis services.
- The Smolmachines driver is covered with a fake CLI runner and has been smoke-tested against a real `smolvm` 0.7.2 VM using a Node image.
- Tests cover config parsing/validation, context rendering, init detection, Codex demo installation, Codex installer output, Codex verification, plugin package shape, official MCP SDK tool registration, daemon RPC, launchd plist generation, daemon garbage collection, reset-db, restart, service dependencies, cross-process locks, a real Postgres fixture, structured errors, Smolmachines driver behavior with a fake CLI runner, and end-to-end process-driver fixtures.

Implemented source areas:

```text
src/cli/
src/config/
src/daemon/
src/drivers/
src/integrations/codex/
src/integrations/launchd.js
src/integrations/mcp/
src/shared/
fixtures/node-basic/
examples/codex-node-postgres/
test/
```

The next implementation milestone should harden Smolmachines daemon reattachment after host restarts and add a repeatable real-VM CI/manual test.

## Language Choice

The first implementation uses dependency-light JavaScript on Node.js.

This is an MVP choice, not a permanent architectural commitment.

Reasons for Node.js/JavaScript first:

- Codex integration, MCP server behavior, config parsing, process supervision, and CLI workflows can be prototyped quickly.
- The project can run without an install step beyond having Node available.
- The TypeScript/JavaScript ecosystem is strong for MCP, CLIs, JSON-RPC, file watchers, YAML/TOML parsing, and plugin packaging.
- Smolmachines exposes a real CLI and documented SDK direction; the MVP integrates the CLI while the npm SDK package catches up.
- The early product risk is integration flow and developer experience, not raw performance.

Rust may make sense later for:

- A durable background daemon.
- Long-running process supervision.
- Lower memory footprint.
- Single static binary distribution.
- Better filesystem watching and OS integration.
- More robust Unix socket RPC and lifecycle management.

Recommended path:

```text
MVP 0:
  JavaScript implementation validates the Codex/agent workflow.

MVP 1:
  Convert stabilized JS modules to TypeScript one boundary at a time.

MVP 2:
  Consider rewriting the daemon/runtime supervisor in Rust while keeping
  plugin/MCP templates and higher-level integration tooling in TypeScript.
```

The important boundary is the daemon RPC contract. If that boundary is clean, the CLI/MCP/plugin layer and the daemon can be implemented in different languages later.

## Architecture

```text
Codex Mac App
  |
  | creates worktree
  v
Codex Local Environment Setup Script
  |
  | runs: devlane codex setup --project "$CODEX_WORKTREE_PATH"
  v
Devlane CLI
  |
  | local HTTP/Unix socket RPC
  v
Devlane Daemon
  |
  +-- Project config loader
  +-- Git/worktree detector
  +-- Environment state store
  +-- Port allocator
  +-- VM/runtime driver
  +-- Service supervisor
  +-- Healthcheck runner
  +-- Context writer
  +-- MCP server
```

Runtime model:

```text
one git worktree = one Devlane environment = one isolated runtime
```

Initial implementation can support two runtime drivers:

1. `process` driver for fast local prototyping.
2. `smolmachines` driver for production-grade isolated microVMs.

The MVP should ship with `process` as a dev fallback and `smolmachines` as the target runtime.

## Repository Layout

Recommended implementation language: TypeScript with Node.js.

Reasoning:

- Strong CLI ecosystem.
- Good MCP server support.
- Easy Codex plugin/skill packaging.
- Good YAML/TOML parsing.
- Easy process management.
- Smolmachines has TypeScript SDK docs, but the reliable MVP surface is the `smolvm` CLI.

Suggested repo structure:

```text
devlane/
  package.json
  pnpm-lock.yaml
  tsconfig.json
  src/
    cli/
      index.ts
      commands/
        init.ts
        up.ts
        down.ts
        status.ts
        logs.ts
        shell.ts
        destroy.ts
        doctor.ts
        install-codex.ts
        codex-setup.ts
        codex-context.ts
    daemon/
      server.ts
      rpc.ts
      state-store.ts
      environment-manager.ts
      service-supervisor.ts
      healthcheck-runner.ts
      port-allocator.ts
      context-writer.ts
      logs.ts
      gc.ts
    config/
      schema.ts
      loader.ts
      detector.ts
    drivers/
      runtime-driver.ts
      process-driver.ts
      smolmachines-driver.ts
    integrations/
      codex/
        installer.ts
        templates/
          setup.sh
          session-start-hook.sh
          skill/
            SKILL.md
            agents/
              openai.yaml
      mcp/
        server.ts
        tools.ts
    shared/
      ids.ts
      paths.ts
      errors.ts
      env.ts
      types.ts
  plugin/
    .codex-plugin/
      plugin.json
    skills/
      devlane/
        SKILL.md
        agents/
          openai.yaml
    mcp/
      devlane-mcp.json
  examples/
    node-postgres-redis/
      devlane.yaml
      package.json
      src/
  docs/
    codex-integration.md
    runtime-drivers.md
    config-reference.md
```

## Config File

Each repo has a checked-in `devlane.yaml`.

Example:

```yaml
version: 1

runtime:
  driver: smolmachines
  cpus: 4
  memory: 8gb
  disk: 20gb
  image: ubuntu:24.04

env:
  NODE_ENV: development
  APP_ENV: devlane

secrets:
  strategy: host-env
  allow:
    - STRIPE_SECRET_KEY
    - OPENAI_API_KEY

services:
  postgres:
    type: postgres
    image: postgres:16
    port: 5432
    env:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: app
    healthcheck:
      command: pg_isready -U dev -d app
      interval_ms: 1000
      timeout_ms: 30000

  redis:
    type: redis
    image: redis:7
    port: 6379
    healthcheck:
      command: redis-cli ping
      interval_ms: 1000
      timeout_ms: 15000

apps:
  api:
    command: pnpm dev:api
    port: 3001
    env:
      DATABASE_URL: ${services.postgres.url}
      REDIS_URL: ${services.redis.url}
    depends_on:
      - postgres
      - redis
    healthcheck:
      url: http://localhost:3001/health
      interval_ms: 1000
      timeout_ms: 60000

setup:
  commands:
    - pnpm install
    - pnpm db:migrate
    - pnpm db:seed

context:
  files:
    - .devlane/context.md
    - .env.local
```

Minimum MVP schema:

```ts
export type DevlaneConfig = {
  version: 1;
  runtime?: RuntimeConfig;
  env?: Record<string, string>;
  secrets?: SecretConfig;
  services?: Record<string, ServiceConfig>;
  apps: Record<string, AppConfig>;
  setup?: {
    commands?: string[];
  };
  context?: {
    files?: string[];
  };
};

export type RuntimeConfig = {
  driver: "process" | "smolmachines";
  cpus?: number;
  memory?: string;
  disk?: string;
  image?: string;
};

export type ServiceConfig = {
  type: "postgres" | "redis" | "custom";
  image?: string;
  command?: string;
  port?: number;
  env?: Record<string, string>;
  healthcheck?: HealthcheckConfig;
};

export type AppConfig = {
  command: string;
  port?: number;
  env?: Record<string, string>;
  depends_on?: string[];
  healthcheck?: HealthcheckConfig;
};

export type HealthcheckConfig =
  | {
      command: string;
      interval_ms?: number;
      timeout_ms?: number;
    }
  | {
      url: string;
      interval_ms?: number;
      timeout_ms?: number;
    };

export type SecretConfig = {
  strategy: "host-env" | "none";
  allow?: string[];
};
```

## State Model

State should live outside the repo, under the user's home directory:

```text
~/.devlane/
  daemon.sock
  state.json
  logs/
    env_<id>/
      api.log
      postgres.log
      redis.log
  envs/
    env_<id>/
      metadata.json
      ports.json
      generated.env
```

Environment identity:

```text
env id = hash(repo root absolute path + worktree absolute path + git branch)
```

State shape:

```ts
export type EnvironmentRecord = {
  id: string;
  repoRoot: string;
  worktreePath: string;
  branch: string;
  configPath: string;
  runtime: RuntimeState;
  status: "creating" | "starting" | "healthy" | "degraded" | "stopped" | "failed";
  ports: Record<string, PortBinding>;
  services: Record<string, ServiceState>;
  apps: Record<string, ServiceState>;
  contextFiles: string[];
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

export type RuntimeState = {
  driver: "process" | "smolmachines";
  runtimeId?: string;
};

export type PortBinding = {
  name: string;
  internalPort: number;
  hostPort: number;
  protocol: "tcp";
  url?: string;
};

export type ServiceState = {
  name: string;
  kind: "service" | "app";
  status: "pending" | "starting" | "healthy" | "failed" | "stopped";
  pid?: number;
  runtimeProcessId?: string;
  logPath: string;
  health?: {
    ok: boolean;
    lastCheckedAt?: string;
    message?: string;
  };
};
```

## CLI Commands

### `devlane init`

Creates `devlane.yaml`.

Behavior:

1. Detect project type.
2. Detect existing Docker Compose services if present.
3. Detect package manager and app scripts.
4. Generate editable config.
5. Print next steps.

Flags:

```bash
devlane init --detect
devlane init --runtime smolmachines
devlane init --runtime process
```

### `devlane install-codex`

Installs Codex integration for the current repo and current user.

Behavior:

1. Writes `.codex/devlane/setup.sh`.
2. Writes `.codex/devlane/cleanup.sh`.
3. Writes `.codex/devlane/session-start-hook.sh`.
4. Writes `.codex/devlane/codex-environment-snippets.md`.
5. Writes `.codex/environments/environment.toml`.
6. Installs Devlane MCP server config in `.codex/config.toml`.
7. Installs Devlane skill assets in `.agents/skills/devlane`.
8. Adds a SessionStart hook that loads Devlane context.

This command should be idempotent.

Important Codex boundary:

- Repo-local hooks are context injection only.
- Automatic provisioning depends on Codex Local Environments running the generated setup script. Local evidence from the Codex app shows these project environments are stored under `.codex/environments/environment.toml`.
- The generated scripts resolve the active worktree with `CODEX_WORKTREE_PATH`, falling back to an explicit first argument and then `$PWD`.

### `devlane codex setup --project "$CODEX_WORKTREE_PATH"`

Called automatically by Codex Local Environments when a new worktree starts.

Behavior:

1. Start daemon if not running.
2. Load `devlane.yaml`.
3. Compute environment id for the current worktree.
4. If environment exists and healthy, reattach.
5. If environment exists but stopped, start it.
6. If missing, create it.
7. Run setup commands only when needed.
8. Run health checks.
9. Write `.env.local`.
10. Write `.devlane/context.md`.

Exit behavior:

- Exit `0` only when environment is ready or intentionally skipped.
- Exit non-zero with actionable error if setup failed.

### `devlane codex context --project "$CODEX_WORKTREE_PATH"`

Called by Codex `SessionStart` hook.

Behavior:

1. Look up environment by current worktree.
2. Print concise agent context to stdout.
3. If no environment exists, print instruction to run setup.

Example output:

```text
Devlane environment is active for this worktree.

API:
- api: http://localhost:49231

Services:
- postgres: postgres://dev:dev@localhost:49232/app
- redis: redis://localhost:49233

Useful commands:
- devlane status
- devlane logs api
- devlane restart api
- devlane reset-db

Do not start duplicate Postgres/Redis instances. Use Devlane service URLs.
```

### `devlane status`

Shows status for current worktree.

Example:

```text
Environment env_8f31a healthy

Runtime:
- driver: smolmachines
- vm: smol-devlane-env_8f31a

Apps:
- api healthy http://localhost:49231

Services:
- postgres healthy localhost:49232
- redis healthy localhost:49233
```

### `devlane logs [service]`

Streams logs.

Examples:

```bash
devlane logs
devlane logs api
devlane logs postgres --tail 100
```

### `devlane restart [service]`

Restarts one app/service or all.

Examples:

```bash
devlane restart api
devlane restart
```

### `devlane reset-db`

MVP behavior:

1. Stop app processes.
2. Drop/recreate local database.
3. Run migration commands.
4. Run seed commands.
5. Restart apps.

Config extension:

```yaml
database:
  reset:
    commands:
      - pnpm db:reset
      - pnpm db:seed
```

### `devlane destroy`

Destroys current worktree environment.

Behavior:

1. Stop services.
2. Stop VM.
3. Delete runtime resources.
4. Keep logs by default.

Flags:

```bash
devlane destroy --logs
devlane destroy --all-for-repo
```

### `devlane doctor`

Checks local prerequisites:

- Devlane daemon reachable.
- Smolmachines installed if configured.
- Codex config writable.
- MCP server registered.
- Ports can be allocated.
- `devlane.yaml` valid.
- Runtime driver can create an environment.

With `--codex`, also checks:

- `devlane.yaml`
- `.codex/devlane/setup.sh`
- `.codex/devlane/cleanup.sh`
- `.codex/devlane/session-start-hook.sh`
- `.codex/devlane/codex-environment-snippets.md`
- `.codex/environments/environment.toml`
- `.codex/hooks.json`
- `.codex/config.toml`
- `.agents/skills/devlane/SKILL.md`

### `devlane codex verify`

Verifies repo-local Codex integration files and exits non-zero when any required asset is missing or malformed.

Checks:

```text
devlane.yaml
Codex setup script
Codex cleanup script
SessionStart hook script
Codex environment snippets
Codex Local Environment config
Codex hooks.json
Codex MCP config
Devlane skill
```

Output includes both the setup script path and the generated Codex Settings -> Environments snippets file.

## Daemon

The daemon owns long-running state and service supervision.

Start options:

- macOS LaunchAgent.
- Manual `devlane daemon start`.
- Auto-start from CLI if socket is unavailable.

RPC transport:

- Unix domain socket for local-only MVP.
- JSON-RPC or simple HTTP over Unix socket.

Core RPC methods:

```ts
type DaemonRpc = {
  ensureEnvironment(input: EnsureEnvironmentInput): Promise<EnvironmentRecord>;
  getEnvironment(input: GetEnvironmentInput): Promise<EnvironmentRecord | null>;
  startEnvironment(input: EnvInput): Promise<EnvironmentRecord>;
  stopEnvironment(input: EnvInput): Promise<EnvironmentRecord>;
  destroyEnvironment(input: EnvInput): Promise<void>;
  restartService(input: ServiceInput): Promise<ServiceState>;
  getLogs(input: LogsInput): AsyncIterable<string>;
  resetDatabase(input: EnvInput): Promise<EnvironmentRecord>;
  collectGarbage(input: GcInput): Promise<GcResult>;
};
```

Lifecycle concurrency:

- `ensureEnvironment`, `resetDatabase`, and `destroyEnvironment` are serialized per resolved worktree path inside one `EnvironmentManager` instance.
- They are also protected by filesystem lock files under `DEVLANE_HOME/locks`.
- Lock files include pid, created time, project path, and operation metadata.
- Stale locks are removed when the owning process is gone or the lock exceeds `DEVLANE_LOCK_STALE_MS`.
- Acquisition times out after `DEVLANE_LOCK_TIMEOUT_MS` and returns `DEVLANE_LOCK_TIMEOUT`.
- This prevents hooks, MCP calls, and manual CLI commands from interleaving setup/reset/destroy for the same worktree.

Environment creation algorithm:

```text
ensureEnvironment(projectPath):
  repoRoot = find git root
  worktreePath = projectPath
  branch = git current branch
  envId = hash(repoRoot, worktreePath, branch)
  existing = state.find(envId)

  if existing and healthy:
    writeContext(existing)
    return existing

  config = load devlane.yaml
  ports = allocate ports for services/apps
  runtime = driver.createOrAttach(envId, config, worktreePath, ports)

  state.save(status = creating)

  driver.prepare(runtime)
  run setup.commands
  start services
  wait for service health
  start apps
  wait for app health
  write env files
  write context files
  state.save(status = healthy)

  return record
```

## Runtime Driver Interface

```ts
export interface RuntimeDriver {
  readonly name: "process" | "smolmachines";

  createOrAttach(input: RuntimeCreateInput): Promise<RuntimeHandle>;
  prepare(handle: RuntimeHandle): Promise<void>;
  runCommand(handle: RuntimeHandle, command: RuntimeCommand): Promise<RuntimeCommandResult>;
  startProcess(handle: RuntimeHandle, process: RuntimeProcessSpec): Promise<RuntimeProcessHandle>;
  stopProcess(handle: RuntimeHandle, processId: string): Promise<void>;
  streamLogs(handle: RuntimeHandle, processId: string): AsyncIterable<string>;
  stop(handle: RuntimeHandle): Promise<void>;
  destroy(handle: RuntimeHandle): Promise<void>;
}

export type RuntimeCreateInput = {
  envId: string;
  worktreePath: string;
  config: DevlaneConfig;
  ports: Record<string, PortBinding>;
};

export type RuntimeHandle = {
  driver: "process" | "smolmachines";
  id: string;
  workdir: string;
  metadata: Record<string, string>;
};

export type RuntimeCommand = {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type RuntimeProcessSpec = {
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  logPath: string;
};
```

## Process Driver

Purpose:

- Enables rapid development before Smolmachines integration is stable.
- Useful fallback for users who cannot run microVMs.

Behavior:

- Runs app commands directly on host.
- Uses host-installed Postgres/Redis only if configured.
- For MVP, it can also call Docker Compose if available, but Docker should not be the core product dependency.

Implementation:

- Use `child_process.spawn`.
- Use per-env process groups.
- Write logs to `~/.devlane/logs/env_<id>/`.
- Kill child processes on environment stop.

## Smolmachines Driver

Purpose:

- One isolated microVM per worktree.
- Stronger isolation than host processes.
- Avoid port and dependency conflicts.

MVP model:

```text
host repo worktree mounted into VM at /workspace
VM starts services and app processes
host forwards allocated ports to VM ports
daemon supervises VM from host
```

Creation flow:

```text
createOrAttach:
  if VM exists:
    attach
  else:
    create VM from configured image
    mount worktree to /workspace
    configure port forwards
    configure env/secrets
```

Inside VM:

```text
/workspace           mounted repo
/devlane             generated runtime files
/devlane/env         generated env vars
/devlane/logs        service logs
```

Service startup:

- For Postgres/Redis, MVP can start package-managed binaries inside a prepared base image.
- Later versions can support OCI workloads directly.

Recommended MVP base images:

- `devlane/node-postgres-redis:22`
- `devlane/python-postgres-redis:3.12`

Reason:

- Faster and more reliable than installing packages on every worktree.
- Easier than nested Docker for first release.

Generated VM startup script:

```bash
#!/usr/bin/env bash
set -euo pipefail

mkdir -p /devlane/logs
cd /workspace

export $(cat /devlane/env | xargs)

if command -v pnpm >/dev/null 2>&1; then
  corepack enable || true
fi
```

Port forwarding:

- Host port allocated by daemon.
- VM internal port from config.
- Record mapping in state.
- Write mapped URLs into `.env.local`.

Implemented Smolmachines path:

- The JavaScript SDK is documented, but the currently published npm package does not contain the SDK implementation.
- Devlane therefore treats the `smolvm` CLI as the real MVP integration surface.
- `prepare` runs `smolvm --version`, deletes any stale Devlane machine with the deterministic name, creates a fresh machine, and starts it.
- Machine creation passes `--volume <worktree>:/workspace`, `--volume <logDir>:/devlane/logs`, `--port HOST:GUEST`, `--workdir /workspace`, resources, and networking flags.
- Setup/reset commands run through `smolvm machine exec --name <machine> --workdir /workspace -- sh -lc <command>`.
- Long-running app/service processes are started with host-side `smolvm machine exec --stream` supervisor processes that stream output into Devlane log files.
- `destroy` runs `smolvm machine stop` and `smolvm machine delete --force`.
- Keep driver behind the runtime interface so future SDK adoption can swap the implementation without disturbing CLI/Codex flows.

## Port Allocation

Rules:

- Never bind configured internal ports directly on host.
- Allocate random free host ports in a Devlane range.
- Default range: `49000-59999`.
- Persist allocations per env to avoid churn.

Algorithm:

```text
for each service/app port:
  if existing mapping exists:
    reuse if free or owned by this env
  else:
    find free port in range
    reserve immediately
    save mapping
```

Generated `.env.local`:

```bash
DATABASE_URL=postgres://dev:dev@localhost:49232/app
REDIS_URL=redis://localhost:49233
API_URL=http://localhost:49231
DEVLANE_ENV_ID=env_8f31a
```

## Health Checks

Health checks must be first-class. This is the difference between "we ran some commands" and "the environment is ready."

Healthcheck lifecycle:

```text
pending -> starting -> healthy
                    -> failed
```

Command healthcheck:

```ts
async function waitForCommandHealth(command, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    const result = await run(command);
    if (result.exitCode === 0) return;
    lastError = result.stderr || result.stdout;
    await sleep(intervalMs);
  }

  throw new Error(`Healthcheck failed: ${lastError}`);
}
```

HTTP healthcheck:

```ts
async function waitForHttpHealth(url, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastStatus = `${res.status} ${res.statusText}`;
    } catch (error) {
      lastStatus = String(error);
    }

    await sleep(intervalMs);
  }

  throw new Error(`Healthcheck failed for ${url}: ${lastStatus}`);
}
```

Failure output should include:

- Failed service name.
- Last command output or HTTP status.
- Log path.
- Suggested command, e.g. `devlane logs api`.

## Context Files

Write `.devlane/context.md` into each worktree.

Example:

```md
# Devlane Environment

Status: healthy
Environment ID: env_8f31a

## Apps

- api: http://localhost:49231

## Services

- postgres: postgres://dev:dev@localhost:49232/app
- redis: redis://localhost:49233

## Commands

- `devlane status`
- `devlane logs api`
- `devlane restart api`
- `devlane reset-db`
- `devlane destroy`

## Agent Guidance

Use the service URLs above. Do not start duplicate database services unless explicitly asked.
```

Also write `.env.local` if configured.

Important:

- Generated files should include a header:

```text
# Generated by Devlane. Do not edit manually.
```

## Codex Integration

Codex integration has four pieces:

1. Local Environment setup script.
2. SessionStart hook.
3. MCP server.
4. Skill/plugin.

### Codex Local Environment Setup Script

Codex Local Environments can run setup scripts automatically when Codex creates a new worktree at the start of a new thread. In the tested local Codex setup, environment snippets use `CODEX_WORKTREE_PATH` to address the actual worktree.

Generated setup script:

```bash
#!/usr/bin/env bash
set -euo pipefail

worktree="${CODEX_WORKTREE_PATH:-${1:-$PWD}}"
cd "$worktree"

devlane codex setup --project "$worktree"
```

This is the main zero-touch integration.

Generated `.codex/environments/environment.toml`:

```toml
# THIS IS AUTOGENERATED. DO NOT EDIT MANUALLY
version = 1
name = "my-project"

[setup]
script = '''
set -euo pipefail
worktree="${CODEX_WORKTREE_PATH:-$PWD}"
"$worktree/.codex/devlane/setup.sh" "$worktree"
'''

[cleanup]
script = '''
set -euo pipefail
worktree="${CODEX_WORKTREE_PATH:-$PWD}"
"$worktree/.codex/devlane/cleanup.sh" "$worktree"
'''
```

Generated fallback snippets:

```bash
set -euo pipefail
worktree="${CODEX_WORKTREE_PATH:-$PWD}"
"$worktree/.codex/devlane/setup.sh" "$worktree"
```

The snippets file also includes cleanup and actions for status, logs, restart, reset database, and destroy. This is intentionally separate from `.codex/hooks.json`: hooks provide context after a thread starts, while Local Environment setup owns provisioning.

### Codex SessionStart Hook

Purpose:

- Inject live Devlane environment info into Codex context.
- Prevent Codex from trying to recreate databases manually.

Hook command:

```bash
devlane codex context --project "$CODEX_WORKTREE_PATH"
```

Expected JSON output:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Devlane environment is active. API: http://localhost:49231. Postgres: postgres://dev:dev@localhost:49232/app. Use devlane MCP tools for logs/status/reset."
  }
}
```

### Codex MCP Server

MCP tools:

```ts
export const tools = {
  "devlane.status": {
    description: "Return status, URLs, ports, and health for the current worktree environment."
  },
  "devlane.logs": {
    description: "Fetch logs for a Devlane service or app."
  },
  "devlane.restart": {
    description: "Restart a Devlane service or app."
  },
  "devlane.reset_db": {
    description: "Reset the Devlane database for the current worktree."
  },
  "devlane.destroy": {
    description: "Destroy the current worktree environment."
  }
};
```

Tool input examples:

```ts
type StatusInput = {
  projectPath?: string;
};

type LogsInput = {
  projectPath?: string;
  service?: string;
  tail?: number;
};

type RestartInput = {
  projectPath?: string;
  service?: string;
};
```

MCP server behavior:

- Resolve current project path from MCP request metadata when available.
- Fall back to `process.cwd()`.
- Call daemon RPC.
- Return concise, structured results.

### Codex Skill

Skill path:

```text
.agents/skills/devlane/SKILL.md
```

Skill content:

```md
---
name: devlane
description: Use when working in a repository that has a Devlane environment. Helps Codex inspect service status, read logs, reset databases, and avoid manually recreating local infrastructure.
---

When this repository has a Devlane environment:

1. Check `devlane.status` before starting backend services manually.
2. Use existing URLs from `.devlane/context.md` and `.env.local`.
3. Use `devlane.logs` to inspect backend, database, or worker failures.
4. Use `devlane.restart` instead of starting duplicate service processes.
5. Use `devlane.reset_db` when test data or migrations need a clean database.
6. Do not run Docker Compose or create new Postgres/Redis instances unless the user explicitly asks.
```

Skill UI metadata:

```yaml
interface:
  display_name: "Devlane"
  short_description: "Use ready-made backend environments for Codex worktrees."
  icon_small: "./assets/small-logo.svg"
  brand_color: "#2563EB"

policy:
  allow_implicit_invocation: true
```

### Codex Plugin

Plugin packages:

- Devlane skill.
- MCP server configuration.
- Optional UI metadata.

`plugin/.codex-plugin/plugin.json`:

```json
{
  "name": "devlane",
  "version": "0.1.0",
  "description": "Ready-to-use backend environments for Codex worktrees.",
  "skills": ["skills/devlane"],
  "mcpServers": {
    "devlane": {
      "command": "devlane",
      "args": ["mcp", "serve"]
    }
  }
}
```

## Conductor Integration

MVP Codex integration should come first. Conductor support can be added with a watcher if there is no equivalent setup hook.

Watcher behavior:

```text
watch configured repo roots
  -> detect new .git/worktrees entry or new worktree directory
  -> if devlane.yaml exists:
       ensureEnvironment(worktree)
       write .devlane/context.md
       write .env.local
```

Command:

```bash
devlane watch ~/code/my-repo
```

This gives a mostly zero-touch Conductor experience without needing to own Conductor's UI.

## Environment Lifecycle

### First Codex Thread

```text
Codex creates worktree
Codex runs setup script
Devlane daemon starts
Devlane creates env
Devlane boots VM
Devlane installs dependencies if needed
Devlane starts services
Devlane runs migrations/seeds
Devlane starts app
Devlane waits for health
Devlane writes context
Codex receives SessionStart context
User prompt begins
```

### Resume Existing Thread

```text
Codex resumes worktree
SessionStart hook runs
Devlane checks env
If healthy: inject context
If stopped: start env and inject context
If failed: inject failure context with logs command
```

### Destroy Worktree

Options:

- Manual `devlane destroy`.
- Garbage collection for stale worktrees.
- Future Codex lifecycle hook if available.

GC policy:

```yaml
gc:
  destroy_stopped_after: 7d
  destroy_orphaned_worktrees_after: 24h
  keep_logs_for: 14d
```

## Secrets

MVP secret strategy:

- Do not invent a secrets manager.
- Allow pass-through from host environment variables.
- Explicit allowlist only.
- Write generated secrets only to `.env.local` if user opted in.

Config:

```yaml
secrets:
  strategy: host-env
  allow:
    - STRIPE_SECRET_KEY
    - OPENAI_API_KEY
```

Rules:

- Never print secret values in logs.
- Redact secret-looking values in status output.
- Do not include secrets in `.devlane/context.md`.
- Include only connection strings for local services with dev credentials.

## Logging

Each service/app writes to:

```text
~/.devlane/logs/env_<id>/<name>.log
```

`devlane logs` should support:

```bash
devlane logs
devlane logs api
devlane logs api --tail 200
devlane logs api --follow
```

MCP log output should default to last 200 lines to avoid flooding Codex context.

## Error Handling

Errors should be designed for agents and humans.

Bad:

```text
setup failed
```

Good:

```text
Devlane failed to start app "api".

Healthcheck:
- url: http://localhost:49231/health
- timeout: 60000ms
- last error: ECONNREFUSED

Logs:
- devlane logs api
- /Users/alice/.devlane/logs/env_8f31a/api.log

Likely fixes:
- Check that `pnpm dev:api` starts a server on internal port 3001.
- Check that DATABASE_URL in devlane.yaml is correct.
```

Implemented structured error shape:

```ts
type DevlaneErrorPayload = {
  name: "DevlaneError";
  message: string;
  code: string;
  component?: string;
  operation?: string;
  details?: Record<string, unknown>;
  suggestions?: string[];
};
```

Current structured codes:

```text
DEVLANE_HEALTHCHECK_FAILED
DEVLANE_SETUP_COMMAND_FAILED
DEVLANE_RESET_COMMAND_FAILED
DEVLANE_RESET_NOT_CONFIGURED
```

Formatted CLI output includes:

- code
- component
- operation
- command or healthcheck details
- last result/output
- log path when available
- suggested next commands

Daemon RPC serializes and reconstructs `DevlaneError`, so structured failures are preserved whether the CLI runs directly or through the daemon.

## Autodetection

`devlane init --detect` should inspect:

- `docker-compose.yml`
- `compose.yaml`
- `.env.example`
- `package.json`
- `pnpm-lock.yaml`
- `yarn.lock`
- `package-lock.json`
- `Makefile`
- `Procfile`
- `prisma/schema.prisma`
- `supabase/config.toml`

Detection rules:

```text
if package.json has "dev:api":
  suggest apps.api.command = "pnpm dev:api"
else if package.json has "dev":
  suggest apps.app.command = "<pm> dev"

if docker-compose contains postgres:
  suggest services.postgres

if docker-compose contains redis:
  suggest services.redis

if prisma/schema.prisma exists:
  suggest setup commands including prisma migrate
```

Important:

- Autodetection should generate a draft config.
- User can edit it.
- Avoid magic that cannot be explained.

## Testing Strategy

### Unit Tests

Cover:

- Config parsing and validation.
- Environment id generation.
- Port allocation.
- Context file generation.
- Healthcheck behavior.
- Secret redaction.

### Integration Tests

Use fixture repos:

```text
fixtures/
  node-postgres-redis/
  nextjs-prisma-postgres/
  rails-postgres/
```

Test:

```bash
devlane codex setup --project fixtures/node-postgres-redis
devlane status
curl http://localhost:<api-port>/health
devlane reset-db
devlane destroy
```

### Codex Integration Test

Manual MVP test:

1. Install Devlane.
2. Open fixture repo in Codex Mac.
3. Create new thread/worktree.
4. Verify setup script runs.
5. Verify `.devlane/context.md` exists.
6. Verify Codex receives context through SessionStart hook.
7. Ask Codex to inspect `devlane.status`.
8. Ask Codex to run an integration test against the API.

### Smolmachines Driver Test

Test:

- Create VM.
- Mount worktree.
- Run command in VM.
- Start API in VM.
- Forward port.
- Curl API from host.
- Destroy VM.

## Security Model

MVP threat model:

- Local developer machine.
- Trusted repo.
- Untrusted or semi-trusted agent-generated code.
- Devlane reduces accidental conflicts and improves isolation, but is not a full sandbox product at MVP.

Rules:

- Keep daemon local-only.
- Bind RPC to Unix socket with user permissions.
- Avoid opening remote ports by default.
- Redact secrets.
- Avoid running arbitrary global hooks outside configured repos.
- Prompt during `install-codex` before adding hooks/config.

Future:

- Per-env network allowlists.
- Snapshot rollback.
- Stronger microVM sandbox policies.
- Audit log of agent-visible environment operations.

## Milestones

### Milestone 1: Working Spike

Timeline: 1-2 weeks.

Deliverables:

- `devlane.yaml` parser.
- CLI with `codex setup`, `status`, `logs`, `destroy`.
- Process driver.
- Basic Postgres/Redis/app support through local commands.
- Context file writer.
- Manual Codex setup script.

Demo:

```text
Create Codex worktree -> setup runs -> API healthy -> Codex sees context.
```

### Milestone 2: Codex Product MVP

Timeline: 4-6 weeks.

Deliverables:

- Daemon.
- Codex installer.
- SessionStart hook.
- MCP server.
- Devlane skill/plugin.
- Healthchecks.
- Port allocator.
- Logs.
- Reset DB.
- Example repo.

Demo:

```text
User installs Devlane once.
User creates Codex thread normally.
Environment is ready without mentioning Devlane.
Codex can call MCP tools for status/logs/reset.
```

### Milestone 3: Smolmachines Runtime

Timeline: 4-8 weeks.

Deliverables:

- Runtime driver interface hardened.
- Smolmachines driver.
- One VM per worktree.
- Worktree mount.
- Port forwarding.
- Prepared Node/Postgres/Redis image.
- VM start/stop/destroy.

Demo:

```text
Two Codex worktrees run identical backend stacks with isolated DBs and no port conflicts.
```

### Milestone 4: Autodetection and Onboarding

Timeline: 3-5 weeks.

Deliverables:

- `devlane init --detect`.
- Compose parser.
- Package manager detection.
- Prisma detection.
- Better `doctor`.
- Config validation report.

Demo:

```text
Run devlane init --detect in existing repo and get 80% correct config.
```

### Milestone 5: Team-Ready Local Product

Timeline: 6-10 weeks.

Deliverables:

- DB snapshots.
- Fast reset.
- GC policies.
- Team docs.
- Stable plugin packaging.
- Installer.
- Signed macOS binary if distributing broadly.

Demo:

```text
New engineer clones repo, installs Devlane, opens Codex, and gets a ready worktree env.
```

## Implementation Order

Build in this order:

1. Config schema and loader.
2. Environment id and state store.
3. Port allocator.
4. Process driver.
5. Service supervisor.
6. Healthcheck runner.
7. Context writer.
8. `devlane codex setup`.
9. `devlane status/logs/destroy`.
10. Daemon RPC.
11. Codex SessionStart hook.
12. MCP server.
13. Skill/plugin package.
14. `install-codex`.
15. Smolmachines driver.
16. Autodetection.
17. Snapshots and reset improvements.

## MVP Definition of Done

The MVP is done when this flow works reliably:

1. User installs Devlane.
2. User runs `devlane init --detect` in a repo and checks in `devlane.yaml`.
3. User runs `devlane install-codex`.
4. User opens the repo in Codex Mac.
5. User creates a new thread/worktree.
6. Devlane automatically provisions the environment.
7. Codex receives context with API and DB URLs.
8. User asks Codex to change an API endpoint.
9. Codex runs an integration test against the live API.
10. Codex can inspect logs/status/reset DB through MCP without asking the user how infrastructure works.

The key metric:

```text
time from new Codex worktree to healthy backend API < 60 seconds for a warm repo
```

Stretch metric:

```text
time from new Codex worktree to healthy backend API < 20 seconds with prepared VM snapshot
```

## Open Questions

1. Exact Codex plugin packaging format and distribution path for public third-party plugins.
2. Whether Codex will continue using project-local `.codex/environments/environment.toml` as the stable environment registration format or migrate this into `$CODEX_HOME/environments.toml`.
3. Whether to keep the Smolmachines CLI driver long-term or swap internals to the SDK once the npm package publishes usable artifacts.
4. Whether MVP should support Docker Compose import or direct Compose execution.
5. Whether `.env.local` should be generated by default or opt-in.
6. How much app-specific migration/seed behavior should be standardized versus repo-defined.

## Strategic Positioning

Devlane should not pitch itself as:

```text
Another coding agent.
```

It should pitch itself as:

```text
The missing dev infrastructure layer for coding agents.
```

Positioning line:

> Stop asking Codex to set up your backend. Every worktree gets a ready API, database, services, logs, and test data automatically.
