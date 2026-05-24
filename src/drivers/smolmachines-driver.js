import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { RuntimeDriver } from "./runtime-driver.js";
import { DevlaneError } from "../shared/devlane-error.js";
import { ensureDir } from "../shared/fs.js";
import { envLogDir } from "../shared/paths.js";
import { stopDetachedProcess } from "../shared/processes.js";

const GUEST_WORKDIR = "/workspace";
const GUEST_LOG_DIR = "/devlane/logs";
const DEFAULT_MACHINE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_STOP_TIMEOUT_MS = 60 * 1000;

export class SmolmachinesDriver extends RuntimeDriver {
  constructor(options = {}) {
    super("smolmachines");
    this.binary = options.binary;
    this.runner = options.runner;
    this.processSpawner = options.processSpawner;
    this.processStopper = options.processStopper;
  }

  async prepare(handle) {
    await this.assertCliAvailable(handle);

    const config = handle.metadata.config;
    const machineName = smolMachineName(handle.id);
    const logDir = envLogDir(handle.id);
    ensureDir(logDir);

    await this.stopMachine(handle, machineName, { allowMissing: true });
    await this.deleteMachine(handle, machineName, { allowMissing: true });

    await this.runCliChecked(handle, buildCreateArgs(handle, config.runtime, machineName, logDir), {
      operation: "create-machine",
      details: { machineName }
    });
    await this.runCliChecked(handle, ["machine", "start", "--name", machineName], {
      operation: "start-machine",
      details: { machineName }
    });

    handle.runtimeId = `smolvm:${machineName}`;
    handle.metadata.smolmachines = { name: machineName };
  }

  async runCommand(handle, command) {
    const machineName = machineNameFor(handle);
    const args = [
      "machine",
      "exec",
      "--name",
      machineName,
      "--workdir",
      command.cwd ? guestPathFor(handle, command.cwd) : GUEST_WORKDIR
    ];

    for (const [key, value] of Object.entries(stringifyEnv(command.env))) {
      args.push("--env", `${key}=${value}`);
    }

    if (command.timeoutMs) {
      args.push("--timeout", durationForTimeout(command.timeoutMs));
    }

    args.push("sh", "-lc", command.command);

    const result = await this.runCli(handle, args, {
      cwd: handle.workdir,
      timeoutMs: command.timeoutMs ? command.timeoutMs + 5000 : undefined
    });

    if (result.spawnError) {
      this.throwIfFailed(handle, result, {
        operation: "exec-command"
      });
    }

    return result;
  }

  async startProcess(handle, processSpec) {
    const machineName = machineNameFor(handle);
    ensureDir(processSpec.logDir);
    const args = [
      "machine",
      "exec",
      "--name",
      machineName,
      "--workdir",
      guestPathFor(handle, processSpec.cwd),
      ...envArgs(processSpec.env),
      "--stream",
      "sh",
      "-lc",
      processSpec.command
    ];

    const processHandle = this.processSpawner
      ? await this.processSpawner(this.binaryFor(handle), args, processSpec)
      : startSmolvmProcess(this.binaryFor(handle), args, processSpec);

    if (!Number.isInteger(processHandle.pid) || processHandle.pid <= 0) {
      throw new DevlaneError(`Smolmachines process "${processSpec.name}" did not return a guest PID.`, {
        code: "DEVLANE_SMOLMACHINES_PROCESS_PID_MISSING",
        component: processSpec.name,
        operation: "start-process",
        details: {
          command: processSpec.command,
          pid: processHandle.pid
        },
        suggestions: ["Check whether smolvm machine exec could be spawned for this process."]
      });
    }

    return {
      id: `${handle.id}:${processSpec.name}:host:${processHandle.pid}`,
      pid: processHandle.pid
    };
  }

  async stopProcess(handle, processId) {
    const processParts = String(processId).split(":");
    if (processParts.at(-2) === "host") {
      const pid = Number(processParts.at(-1));
      if (this.processStopper) {
        await this.processStopper(pid);
      } else {
        await stopDetachedProcess(pid);
      }
      return undefined;
    }

    const machineName = machineNameFor(handle);
    const pid = Number(processParts.at(-1));
    if (!Number.isInteger(pid) || pid <= 0) return undefined;

    const result = await this.runCli(handle, [
      "machine",
      "exec",
      "--name",
      machineName,
      "--workdir",
      GUEST_WORKDIR,
      "sh",
      "-lc",
      `kill -TERM -${pid} >/dev/null 2>&1 || kill -TERM ${pid} >/dev/null 2>&1 || true`
    ]);
    if (result.spawnError) {
      this.throwIfFailed(handle, result, {
        operation: "stop-process"
      });
    }
    return undefined;
  }

  async destroy(handle) {
    const machineName = machineNameFor(handle);
    await this.stopMachine(handle, machineName, { allowMissing: true });
    await this.deleteMachine(handle, machineName, { allowMissing: true });
  }

  async stopMachine(handle, machineName, options = {}) {
    const result = await this.runCli(handle, ["machine", "stop", "--name", machineName], {
      timeoutMs: DEFAULT_STOP_TIMEOUT_MS
    });
    this.throwIfFailed(handle, result, {
      operation: "stop-machine",
      allowMissing: options.allowMissing,
      details: { machineName }
    });
  }

  async deleteMachine(handle, machineName, options = {}) {
    const result = await this.runCli(handle, ["machine", "delete", "--force", machineName], {
      timeoutMs: DEFAULT_STOP_TIMEOUT_MS
    });
    this.throwIfFailed(handle, result, {
      operation: "delete-machine",
      allowMissing: options.allowMissing,
      details: { machineName }
    });
  }

  async assertCliAvailable(handle) {
    const result = await this.runCli(handle, ["--version"], {
      timeoutMs: 10 * 1000
    });

    this.throwIfFailed(handle, result, {
      operation: "check-cli",
      details: {
        binary: this.binaryFor(handle)
      },
      suggestions: [
        "Install smolvm with: curl -sSL https://smolmachines.com/install.sh | bash -s -- --no-modify-path",
        "Set runtime.smolvmBinary or DEVLANE_SMOLVM_BINARY if smolvm is installed outside PATH.",
        "Use runtime.driver: process until Smolmachines is installed."
      ]
    });
  }

  async runCliChecked(handle, args, errorOptions = {}) {
    const result = await this.runCli(handle, args, {
      timeoutMs: DEFAULT_MACHINE_TIMEOUT_MS
    });
    this.throwIfFailed(handle, result, errorOptions);
    return result;
  }

  async runCli(handle, args, options = {}) {
    const binary = this.binaryFor(handle);
    if (this.runner) {
      return this.runner(args, { ...options, binary });
    }

    return runSmolvmCommand(binary, args, options);
  }

  binaryFor(handle) {
    return this.binary ?? resolveSmolvmBinary(runtimeFor(handle));
  }

  throwIfFailed(handle, result, options = {}) {
    if (result.exitCode === 0) return;
    if (options.allowMissing && isMissingMachineResult(result)) return;

    const binary = this.binaryFor(handle);
    if (result.spawnError?.code === "ENOENT") {
      throw new DevlaneError("Smolmachines CLI is not installed or is not on PATH.", {
        code: "DEVLANE_SMOLMACHINES_CLI_MISSING",
        component: "runtime.smolmachines",
        operation: options.operation ?? "smolvm",
        details: {
          binary,
          error: result.spawnError.message
        },
        suggestions: options.suggestions ?? [
          "Install smolvm with: curl -sSL https://smolmachines.com/install.sh | bash -s -- --no-modify-path",
          "Set runtime.smolvmBinary or DEVLANE_SMOLVM_BINARY if smolvm is installed outside PATH.",
          "Use runtime.driver: process until Smolmachines is installed."
        ]
      });
    }

    throw new DevlaneError(`Smolmachines command failed during ${options.operation ?? "runtime operation"}.`, {
      code: "DEVLANE_SMOLMACHINES_COMMAND_FAILED",
      component: "runtime.smolmachines",
      operation: options.operation ?? "smolvm",
      details: {
        binary,
        args: result.args,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        ...options.details
      },
      suggestions: options.suggestions ?? [
        "Run devlane doctor to check the smolvm binary.",
        "Run the failed smolvm command manually to inspect the CLI error.",
        "Use runtime.driver: process while diagnosing Smolmachines setup."
      ]
    });
  }
}

export function resolveSmolvmBinary(runtime = {}) {
  return runtime.smolvmBinary ?? runtime.binary ?? process.env.DEVLANE_SMOLVM_BINARY ?? "smolvm";
}

export function runSmolvmCommand(binary, args, options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer = null;

    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        args,
        stdout,
        stderr,
        timedOut,
        ...result
      });
    };

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
          killTimer.unref?.();
        }, options.timeoutMs)
      : null;
    timeout?.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish({
        exitCode: 127,
        stderr: stderr || error.message,
        spawnError: {
          code: error.code,
          message: error.message
        }
      });
    });

    child.on("close", (exitCode) => {
      finish({
        exitCode: exitCode ?? (timedOut ? 124 : 1)
      });
    });
  });
}

function startSmolvmProcess(binary, args, processSpec) {
  const fd = fs.openSync(processSpec.logPath, "a");
  fs.writeSync(fd, `\n[devlane] starting ${processSpec.name} in smolvm: ${processSpec.command}\n`);

  const child = spawn(binary, args, {
    cwd: processSpec.cwd,
    env: { ...process.env },
    detached: true,
    stdio: ["ignore", fd, fd]
  });

  child.on("error", (error) => {
    fs.writeSync(fd, `[devlane] failed to start smolvm exec: ${error.message}\n`);
  });

  child.unref();

  return {
    pid: child.pid
  };
}

function buildCreateArgs(handle, runtime, machineName, logDir) {
  const args = ["machine", "create"];

  if (runtime.image) args.push("--image", String(runtime.image));
  if (runtime.cpus) args.push("--cpus", String(runtime.cpus));

  const memoryMb = parseMemoryMb(runtime.memory);
  if (memoryMb) args.push("--mem", String(memoryMb));

  const storageGb = parseGiB(runtime.storage ?? runtime.storageGb);
  if (storageGb) args.push("--storage", String(storageGb));

  const overlayGb = parseGiB(runtime.overlay ?? runtime.overlayGb);
  if (overlayGb) args.push("--overlay", String(overlayGb));

  args.push("--workdir", GUEST_WORKDIR);
  args.push("--volume", `${handle.workdir}:${GUEST_WORKDIR}`);
  args.push("--volume", `${logDir}:${GUEST_LOG_DIR}`);

  for (const mapping of buildPorts(handle.metadata.ports)) {
    args.push("--port", mapping);
  }

  if (runtime.network !== false && runtime.net !== false) args.push("--net");

  for (const cidr of normalizeList(runtime.allowCidrs ?? runtime.allowCIDRs)) {
    args.push("--allow-cidr", String(cidr));
  }

  for (const host of normalizeList(runtime.allowHosts)) {
    args.push("--allow-host", String(host));
  }

  if (runtime.outboundLocalhostOnly) args.push("--outbound-localhost-only");
  if (runtime.sshAgent) args.push("--ssh-agent");
  if (runtime.gpu) args.push("--gpu");
  if (runtime.gpuVram) args.push("--gpu-vram", String(parseMemoryMb(runtime.gpuVram) ?? runtime.gpuVram));

  for (const [key, value] of Object.entries(stringifyEnv(runtime.env))) {
    args.push("--env", `${key}=${value}`);
  }

  args.push(machineName);
  return args;
}

function buildPorts(ports = {}) {
  return Object.values(ports)
    .filter((port) => port?.hostPort && port?.internalPort)
    .map((port) => `${Number(port.hostPort)}:${Number(port.internalPort)}`);
}

function machineNameFor(handle) {
  const metadataName = handle.metadata?.smolmachines?.name;
  if (metadataName) return metadataName;

  const runtimeId = handle.metadata?.record?.runtime?.runtimeId ?? handle.runtimeId;
  if (typeof runtimeId === "string" && runtimeId.startsWith("smolvm:")) {
    return runtimeId.slice("smolvm:".length);
  }

  return smolMachineName(handle.id);
}

function runtimeFor(handle) {
  return handle.metadata?.config?.runtime ?? handle.metadata?.record?.runtime ?? {};
}

function guestPathFor(handle, hostPath) {
  if (!hostPath) return GUEST_WORKDIR;

  const resolved = path.resolve(hostPath);
  const workdir = path.resolve(handle.workdir);
  if (resolved === workdir) return GUEST_WORKDIR;

  if (resolved.startsWith(`${workdir}${path.sep}`)) {
    const relative = path.relative(workdir, resolved).split(path.sep).join(path.posix.sep);
    return path.posix.join(GUEST_WORKDIR, relative);
  }

  return GUEST_WORKDIR;
}

function smolMachineName(envId) {
  return `devlane-${envId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function envArgs(env = {}) {
  const args = [];
  for (const [key, value] of Object.entries(stringifyEnv(env))) {
    args.push("--env", `${key}=${value}`);
  }
  return args;
}

function stringifyEnv(env = {}) {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)]));
}

function durationForTimeout(timeoutMs) {
  return `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`;
}

function parseMemoryMb(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return Math.round(value);
  const normalized = String(value).trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(mb|m|gb|g)?$/);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = match[2] ?? "mb";
  return unit.startsWith("g") ? Math.round(amount * 1024) : Math.round(amount);
}

function parseGiB(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return Math.round(value);
  const normalized = String(value).trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(gb|g|mb|m)?$/);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = match[2] ?? "gb";
  return unit.startsWith("m") ? Math.max(1, Math.round(amount / 1024)) : Math.round(amount);
}

function normalizeList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isMissingMachineResult(result) {
  const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.toLowerCase();
  return /not found|does not exist|no such|unknown machine|no machine/.test(output);
}
