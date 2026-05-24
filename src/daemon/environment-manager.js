import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../config/loader.js";
import { interpolate } from "../config/interpolate.js";
import { allocatePorts } from "./port-allocator.js";
import { waitForHealth } from "./healthcheck-runner.js";
import { StateStore } from "./state-store.js";
import { environmentId } from "../shared/ids.js";
import { envLogDir, envStateDir } from "../shared/paths.js";
import { ensureDir } from "../shared/fs.js";
import { isPidRunning } from "../shared/processes.js";
import { DevlaneError } from "../shared/devlane-error.js";
import { withFileLock } from "./file-lock.js";
import { driverFor } from "../drivers/index.js";
import {
  appEnvironment,
  buildEnvironmentVariables,
  buildRuntimeContext,
  writeContextFiles
} from "./context-writer.js";

export class EnvironmentManager {
  constructor(options = {}) {
    this.store = options.store ?? new StateStore();
    this.locks = new Map();
  }

  async ensureEnvironment(projectPath) {
    return this.withProjectLock(projectPath, () => this.ensureEnvironmentUnlocked(projectPath));
  }

  async ensureEnvironmentUnlocked(projectPath) {
    const loaded = loadConfig(projectPath);
    const identity = resolveIdentity(loaded);
    const existing = this.store.get(identity.id);

    if (existing && existing.status === "healthy" && this.recordProcessesRunning(existing)) {
      const context = buildRuntimeContext(loaded.config, existing.ports);
      context.bindingLookup = existing.ports;
      existing.contextFiles = writeContextFiles(existing, loaded.config, context);
      existing.urls = context.urls;
      return this.store.save(existing);
    }

    const ports = await allocatePorts(loaded.config, existing?.ports ?? {});
    const context = buildRuntimeContext(loaded.config, ports);
    context.bindingLookup = ports;

    const record = this.createInitialRecord(loaded, identity, ports, context.urls);
    this.store.save(record);

    const driver = driverFor(loaded.config);
    const handle = {
      driver: loaded.config.runtime.driver,
      id: record.id,
      workdir: loaded.worktreePath,
      metadata: {
        config: loaded.config,
        ports
      }
    };

    try {
      await driver.prepare(handle);
      if (handle.runtimeId) {
        record.runtime.runtimeId = handle.runtimeId;
      }
      await this.runSetupCommands(driver, handle, loaded.config, context);
      await this.startServices(driver, handle, record, loaded.config, context);
      await this.startApps(driver, handle, record, loaded.config, context);

      record.status = this.hasFailures(record) ? "failed" : "healthy";
      record.contextFiles = writeContextFiles(record, loaded.config, context);

      return this.store.save(record);
    } catch (error) {
      record.status = "failed";
      record.lastError = error.message;
      record.contextFiles = writeContextFiles(record, loaded.config, context);
      this.store.save(record);
      throw error;
    }
  }

  async getEnvironment(projectPath) {
    const worktreePath = path.resolve(projectPath);
    try {
      const loaded = loadConfig(worktreePath);
      const identity = resolveIdentity(loaded);
      const current = this.store.get(identity.id);
      if (current) return current;
    } catch {
      // Fall back to worktree lookup when config is unavailable, e.g. during cleanup.
    }

    return this.store.findByWorktree(worktreePath);
  }

  async refreshRuntimeStatus(record) {
    let loaded = null;
    let context = null;

    try {
      loaded = loadConfig(record.worktreePath);
      context = buildRuntimeContext(loaded.config, record.ports);
      context.bindingLookup = record.ports;
      record.urls = context.urls;
    } catch {
      // The worktree may have been deleted. Keep the persisted runtime state available for cleanup.
    }

    if (record.runtime.driver === "process") {
      for (const app of Object.values(record.apps)) {
        if (app.pid && !isPidRunning(app.pid) && app.status === "healthy") {
          app.status = "stopped";
        }
      }

      for (const service of Object.values(record.services)) {
        if (service.pid && !isPidRunning(service.pid) && service.status === "healthy") {
          service.status = "stopped";
        }
      }
    }

    if (
      Object.values(record.apps).some((app) => app.status === "stopped" || app.status === "failed") ||
      Object.values(record.services).some((service) => service.status === "failed")
    ) {
      record.status = "degraded";
    }

    if (loaded && context) {
      record.contextFiles = writeContextFiles(record, loaded.config, context);
    }

    this.store.save(record);
  }

  async destroyEnvironment(projectPath) {
    return this.withProjectLock(projectPath, () => this.destroyEnvironmentUnlocked(projectPath));
  }

  async destroyEnvironmentUnlocked(projectPath) {
    const record = await this.getEnvironment(path.resolve(projectPath));
    if (!record) return null;

    const config = { runtime: record.runtime };
    const driver = driverFor(config);
    const handle = {
      driver: record.runtime.driver,
      id: record.id,
      workdir: record.worktreePath,
      metadata: {
        record
      }
    };

    const processIds = [
      ...Object.values(record.apps).map((app) => app.runtimeProcessId).filter(Boolean),
      ...Object.values(record.services).map((service) => service.runtimeProcessId).filter(Boolean)
    ];

    await driver.destroy(handle, processIds);
    this.store.delete(record.id);
    return record;
  }

  async resetDatabase(projectPath) {
    return this.withProjectLock(projectPath, () => this.resetDatabaseUnlocked(projectPath));
  }

  async resetDatabaseUnlocked(projectPath) {
    const loaded = loadConfig(projectPath);
    const commands = loaded.config.database.reset.commands;

    if (commands.length === 0) {
      throw new DevlaneError("No database reset commands configured.", {
        code: "DEVLANE_RESET_NOT_CONFIGURED",
        component: "database",
        operation: "reset-db",
        details: {
          configPath: loaded.configPath
        },
        suggestions: [
          "Add database.reset.commands to devlane.yaml.",
          "Run devlane up first if you only need to start the environment."
        ]
      });
    }

    let record = await this.getEnvironment(loaded.worktreePath);
    if (!record) {
      record = await this.ensureEnvironmentUnlocked(loaded.worktreePath);
    } else {
      await this.refreshRuntimeStatus(record);
    }

    const context = buildRuntimeContext(loaded.config, record.ports);
    context.bindingLookup = record.ports;
    record.urls = context.urls;

    const driver = driverFor(loaded.config);
    const handle = {
      driver: loaded.config.runtime.driver,
      id: record.id,
      workdir: loaded.worktreePath,
      metadata: {
        config: loaded.config,
        ports: record.ports
      }
    };

    await this.stopApps(driver, handle, record, "stopped for database reset");

    let resetError = null;
    try {
      await this.runResetCommands(driver, handle, record, loaded.config, context);
    } catch (error) {
      resetError = error;
    }

    await this.startApps(driver, handle, record, loaded.config, context);

    record.status = this.hasFailures(record) ? "failed" : "healthy";
    record.contextFiles = writeContextFiles(record, loaded.config, context);
    const saved = this.store.save(record);

    if (resetError) throw resetError;

    return saved;
  }

  async restart(projectPath, name) {
    return this.withProjectLock(projectPath, () => this.restartUnlocked(projectPath, name));
  }

  async restartUnlocked(projectPath, name) {
    const loaded = loadConfig(projectPath);
    const record = await this.getEnvironment(loaded.worktreePath);

    if (!record) {
      throw new DevlaneError("No Devlane environment exists for this worktree.", {
        code: "DEVLANE_ENVIRONMENT_NOT_FOUND",
        component: "environment",
        operation: "restart",
        details: {
          projectPath: loaded.worktreePath
        },
        suggestions: ["Run devlane up before restarting services."]
      });
    }

    const context = buildRuntimeContext(loaded.config, record.ports);
    context.bindingLookup = record.ports;
    record.urls = context.urls;

    const driver = driverFor(loaded.config);
    const handle = {
      driver: loaded.config.runtime.driver,
      id: record.id,
      workdir: loaded.worktreePath,
      metadata: {
        config: loaded.config,
        ports: record.ports
      }
    };

    if (!name) {
      await this.stopApps(driver, handle, record, "stopped for restart");
      await this.startApps(driver, handle, record, loaded.config, context);
    } else if (record.apps[name]) {
      await this.stopEntry(driver, handle, record, record.apps[name], "stopped for restart");
      await this.startApp(driver, handle, record, loaded.config, context, name);
    } else if (record.services[name]) {
      await this.stopApps(driver, handle, record, "stopped for service restart");
      await this.stopEntry(driver, handle, record, record.services[name], "stopped for restart");
      await this.startService(driver, handle, record, loaded.config, context, name);
      await this.startApps(driver, handle, record, loaded.config, context);
    } else {
      throw new DevlaneError(`No app or service named "${name}".`, {
        code: "DEVLANE_COMPONENT_NOT_FOUND",
        component: name,
        operation: "restart",
        details: {
          apps: Object.keys(record.apps),
          services: Object.keys(record.services)
        },
        suggestions: ["Run devlane status to list available apps and services."]
      });
    }

    record.status = this.hasFailures(record) ? "failed" : "healthy";
    record.contextFiles = writeContextFiles(record, loaded.config, context);
    return this.store.save(record);
  }

  async withProjectLock(projectPath, callback) {
    const key = path.resolve(projectPath);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const queue = previous.then(() => current, () => current);
    this.locks.set(key, queue);

    await previous.catch(() => undefined);

    try {
      return await withFileLock(
        key,
        {
          projectPath: key,
          operation: "environment-lifecycle"
        },
        callback
      );
    } finally {
      release();
      if (this.locks.get(key) === queue) {
        this.locks.delete(key);
      }
    }
  }

  createInitialRecord(loaded, identity, ports, urls) {
    const createdAt = new Date().toISOString();
    const record = {
      id: identity.id,
      repoRoot: identity.repoRoot,
      worktreePath: loaded.worktreePath,
      branch: identity.branch,
      configPath: loaded.configPath,
      runtime: {
        driver: loaded.config.runtime.driver,
        runtimeId: loaded.config.runtime.driver === "process" ? `process:${identity.id}` : undefined,
        smolvmBinary: loaded.config.runtime.smolvmBinary ?? loaded.config.runtime.binary
      },
      status: "creating",
      ports,
      urls,
      services: {},
      apps: {},
      contextFiles: [],
      createdAt,
      updatedAt: createdAt
    };

    for (const name of Object.keys(loaded.config.services)) {
      record.services[name] = {
        name,
        kind: "service",
        status: "pending",
        logPath: path.join(envLogDir(record.id), `${name}.log`)
      };
    }

    for (const name of Object.keys(loaded.config.apps)) {
      record.apps[name] = {
        name,
        kind: "app",
        status: "pending",
        logPath: path.join(envLogDir(record.id), `${name}.log`)
      };
    }

    return record;
  }

  async runSetupCommands(driver, handle, config, context) {
    const env = buildEnvironmentVariables(config, context, { target: "runtime" });

    for (const command of config.setup.commands) {
      const result = await driver.runCommand(handle, {
        command,
        cwd: handle.workdir,
        env,
        timeoutMs: 5 * 60 * 1000
      });

      if (result.exitCode !== 0) {
        throw new DevlaneError(`Setup command failed: ${command}`, {
          code: "DEVLANE_SETUP_COMMAND_FAILED",
          component: "setup",
          operation: "setup",
          details: {
            command,
            exitCode: result.exitCode,
            output: result.stderr || result.stdout
          },
          suggestions: [
            `Run the setup command manually from ${handle.workdir}.`,
            "Fix the command or remove it from setup.commands in devlane.yaml."
          ]
        });
      }
    }
  }

  async runResetCommands(driver, handle, record, config, context) {
    const env = {
      ...buildEnvironmentVariables(config, context, { target: "runtime" }),
      DEVLANE_ENV_ID: record.id
    };

    for (const [key, binding] of Object.entries(context.bindingLookup)) {
      if (!key.startsWith("apps.")) continue;
      const name = key.slice("apps.".length);
      env[`${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_URL`] = `http://localhost:${runtimePort(config, binding)}`;
    }

    for (const command of config.database.reset.commands) {
      const result = await driver.runCommand(handle, {
        command,
        cwd: handle.workdir,
        env,
        timeoutMs: 5 * 60 * 1000
      });

      if (result.exitCode !== 0) {
        throw new DevlaneError(`Database reset command failed: ${command}`, {
          code: "DEVLANE_RESET_COMMAND_FAILED",
          component: "database",
          operation: "reset-db",
          details: {
            command,
            exitCode: result.exitCode,
            output: result.stderr || result.stdout
          },
          suggestions: [
            `Run the reset command manually from ${handle.workdir}.`,
            "Check database.reset.commands in devlane.yaml."
          ]
        });
      }
    }
  }

  async stopApps(driver, handle, record, message) {
    for (const app of Object.values(record.apps)) {
      await this.stopEntry(driver, handle, record, app, message);
    }
  }

  async startServices(driver, handle, record, config, context) {
    for (const name of Object.keys(config.services)) {
      await this.startService(driver, handle, record, config, context, name);
    }
  }

  async startService(driver, handle, record, config, context, name) {
    const service = config.services[name];
    const state = record.services[name];
    state.status = "starting";
    this.store.save(record);

    try {
      if (!service.command) {
        state.status = "unsupported";
        state.health = {
          ok: false,
          message: "process driver requires services.<name>.command for managed services"
        };
        this.store.save(record);
        return;
      }

      const env = {
        ...buildEnvironmentVariables(config, context, { target: "runtime" }),
        ...interpolate(service.env ?? {}, context.variables),
        ...(context.bindingLookup[`services.${name}`]
          ? {
              PORT: String(
                runtimePort(config, context.bindingLookup[`services.${name}`])
              )
            }
          : {})
      };

      await this.startManagedProcess(driver, handle, state, service.command, env);
      const healthcheck = interpolate(service.healthcheck, context.variables);
      await this.waitForConfiguredHealth(state, healthcheck, handle.workdir, env);
      this.store.save(record);
    } catch (error) {
      this.store.save(record);
      throw error;
    }
  }

  async startApps(driver, handle, record, config, context) {
    for (const name of Object.keys(config.apps)) {
      await this.startApp(driver, handle, record, config, context, name);
    }
  }

  async startApp(driver, handle, record, config, context, name) {
    const app = config.apps[name];
    const state = record.apps[name];
    state.status = "starting";
    this.store.save(record);

    try {
      const env = appEnvironment(config, name, context);
      await this.startManagedProcess(driver, handle, state, app.command, env);
      const healthcheck = interpolate(app.healthcheck, context.variables);
      await this.waitForConfiguredHealth(state, healthcheck, handle.workdir, env);
      this.store.save(record);
    } catch (error) {
      this.store.save(record);
      throw error;
    }
  }

  async stopEntry(driver, handle, record, entry, message) {
    entry.status = "stopping";
    this.store.save(record);

    if (entry.runtimeProcessId) {
      await driver.stopProcess(handle, entry.runtimeProcessId);
    }

    delete entry.runtimeProcessId;
    delete entry.pid;
    entry.status = "stopped";
    entry.health = {
      ok: false,
      lastCheckedAt: new Date().toISOString(),
      message
    };
    this.store.save(record);
  }

  async startManagedProcess(driver, handle, state, command, env) {
    ensureDir(envStateDir(handle.id));
    ensureDir(envLogDir(handle.id));

    const processHandle = await driver.startProcess(handle, {
      name: state.name,
      command,
      cwd: handle.workdir,
      env,
      logDir: envLogDir(handle.id),
      logPath: state.logPath
    });

    state.runtimeProcessId = processHandle.id;
    state.pid = processHandle.pid;
  }

  async waitForConfiguredHealth(state, healthcheck, cwd, env) {
    const result = await waitForHealth(healthcheck, { cwd, env });
    state.health = {
      ok: result.ok,
      lastCheckedAt: new Date().toISOString(),
      message: result.message
    };
    state.status = result.ok ? "healthy" : "failed";

    if (!result.ok) {
      throw new DevlaneError(`Healthcheck failed for ${state.kind} "${state.name}".`, {
        code: "DEVLANE_HEALTHCHECK_FAILED",
        component: `${state.kind}.${state.name}`,
        operation: "healthcheck",
        details: {
          healthcheck: result.healthcheck,
          lastResult: result.message,
          logPath: state.logPath
        },
        suggestions: [
          `Run devlane logs ${state.name} to inspect process output.`,
          "Check that the command starts on the configured PORT.",
          "Check the healthcheck command or URL in devlane.yaml."
        ]
      });
    }
  }

  recordProcessesRunning(record) {
    if (record.runtime.driver !== "process") return true;

    const managed = [
      ...Object.values(record.apps),
      ...Object.values(record.services).filter((service) => service.runtimeProcessId)
    ];

    return managed.every((entry) => isPidRunning(entry.pid));
  }

  hasFailures(record) {
    return [
      ...Object.values(record.apps),
      ...Object.values(record.services).filter((service) => service.status !== "unsupported")
    ].some((entry) => entry.status === "failed");
  }
}

function resolveIdentity(loaded) {
  const repoRoot = gitOutput(loaded.worktreePath, ["rev-parse", "--show-toplevel"]) ?? loaded.projectRoot;
  const branch = gitOutput(loaded.worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? path.basename(loaded.worktreePath);
  const id = environmentId({
    repoRoot,
    worktreePath: loaded.worktreePath,
    branch
  });

  return { id, repoRoot, branch };
}

function gitOutput(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function runtimePort(config, binding) {
  if (config.runtime.driver === "smolmachines") {
    return binding.internalPort;
  }

  return binding.hostPort;
}
