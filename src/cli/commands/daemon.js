import fs from "node:fs";
import { spawn } from "node:child_process";
import { createDaemonServer } from "../../daemon/rpc-server.js";
import { DaemonRpcClient } from "../../daemon/rpc-client.js";
import { collectGarbage } from "../../daemon/gc.js";
import { daemonLogPath, daemonPidPath, daemonSocketPath, stateRoot } from "../../shared/paths.js";
import { ensureDir } from "../../shared/fs.js";
import { isPidRunning } from "../../shared/processes.js";
import { hasFlag, readFlag } from "../args.js";
import { installLaunchAgent, uninstallLaunchAgent } from "../../integrations/launchd.js";

export async function daemonCommand(args) {
  const subcommand = args[0] ?? "status";

  if (subcommand === "start") {
    if (args.includes("--background")) {
      await startBackgroundDaemon();
      return;
    }

    await startForegroundDaemon();
    return;
  }

  if (subcommand === "stop") {
    await stopDaemon();
    return;
  }

  if (subcommand === "install") {
    installDaemon(args.slice(1));
    return;
  }

  if (subcommand === "uninstall") {
    uninstallDaemon(args.slice(1));
    return;
  }

  if (subcommand === "gc") {
    runGarbageCollection(args.slice(1));
    return;
  }

  if (subcommand === "ping" || subcommand === "status") {
    const client = new DaemonRpcClient();
    try {
      const result = await client.ping();
      process.stdout.write(`Devlane daemon is running (pid ${result.pid}).\n`);
    } catch (error) {
      if (fs.existsSync(daemonSocketPath())) {
        process.stdout.write(`Devlane daemon is not reachable at ${daemonSocketPath()}: ${error.message}\n`);
      } else {
        process.stdout.write("Devlane daemon is not running.\n");
      }
    }
    return;
  }

  throw new Error(`Unknown daemon subcommand: ${subcommand}`);
}

function installDaemon(args) {
  const result = installLaunchAgent({ load: !hasFlag(args, "no-load") });
  process.stdout.write(`Installed Devlane launch agent at ${result.plistPath}.\n`);
  process.stdout.write(result.loaded ? "Launch agent loaded.\n" : "Launch agent not loaded.\n");
}

function uninstallDaemon(args) {
  const result = uninstallLaunchAgent({ unload: !hasFlag(args, "no-unload") });
  if (result.removed) {
    process.stdout.write(`Removed Devlane launch agent at ${result.plistPath}.\n`);
  } else {
    process.stdout.write(`No Devlane launch agent found at ${result.plistPath}.\n`);
  }
}

function runGarbageCollection(args) {
  const maxAgeDays = Number(readFlag(args, "max-age-days", 7));
  const maxLogMb = Number(readFlag(args, "max-log-mb", 5));
  const smolmachinesMachinesPath = readFlag(args, "smolmachines-machines-json");

  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    throw new Error("--max-age-days must be a non-negative number");
  }

  if (!Number.isFinite(maxLogMb) || maxLogMb <= 0) {
    throw new Error("--max-log-mb must be a positive number");
  }

  if (smolmachinesMachinesPath === true) {
    throw new Error("--smolmachines-machines-json requires a file path");
  }

  const result = collectGarbage({
    dryRun: hasFlag(args, "dry-run"),
    maxAgeMs: maxAgeDays * 24 * 60 * 60 * 1000,
    maxLogBytes: maxLogMb * 1024 * 1024,
    smolmachinesMachines: smolmachinesMachinesPath
      ? readJsonArray(String(smolmachinesMachinesPath))
      : undefined
  });

  if (hasFlag(args, "json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${result.dryRun ? "Would remove" : "Removed"} ${result.removed.length} state record(s).\n`);
  for (const removal of result.removed) {
    process.stdout.write(`- ${removal.id}: ${removal.reason}${removal.keptId ? `; keeping ${removal.keptId}` : ""}\n`);
  }

  if (result.skipped.length > 0) {
    process.stdout.write(`Skipped ${result.skipped.length} unsafe state record(s).\n`);
    for (const skipped of result.skipped) {
      process.stdout.write(`- ${skipped.id}: ${skipped.reason}; ${skipped.skipReason}\n`);
    }
  }

  process.stdout.write(`Detected ${result.duplicates.length} duplicate worktree group(s).\n`);
  for (const group of result.duplicates) {
    process.stdout.write(`- ${group.worktreePath}: keeping ${group.keep.id}, duplicate(s) ${group.duplicates.map((entry) => entry.id).join(", ")}\n`);
  }

  if (result.orphanSmolmachines.checked) {
    process.stdout.write(`Detected ${result.orphanSmolmachines.candidates.length} orphan Smolmachines candidate(s).\n`);
    for (const candidate of result.orphanSmolmachines.candidates) {
      process.stdout.write(`- ${candidate.name}: ${candidate.reason}; ${candidate.action}\n`);
    }
  }

  process.stdout.write(`${result.dryRun ? "Would rotate" : "Rotated"} ${result.rotated.length} log file(s).\n`);
}

function readJsonArray(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("--smolmachines-machines-json must point to a JSON array");
  }

  return parsed;
}

async function startForegroundDaemon() {
  ensureDir(stateRoot());

  const server = createDaemonServer();
  await server.start();
  writePidFile(process.pid);
  process.stdout.write(`Devlane daemon listening at ${daemonSocketPath()}\n`);

  await new Promise((resolve) => {
    const shutdown = () => resolve();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    server.on("close", shutdown);
  });

  await closeServer(server);
  cleanupDaemonFiles();
}

async function startBackgroundDaemon() {
  ensureDir(stateRoot());

  const existing = await pingDaemon();
  if (existing) {
    process.stdout.write(`Devlane daemon is already running (pid ${existing.pid}).\n`);
    return;
  }

  const logFd = fs.openSync(daemonLogPath(), "a");
  const child = spawn(process.execPath, [process.argv[1], "daemon", "start"], {
    detached: true,
    env: process.env,
    stdio: ["ignore", logFd, logFd]
  });

  child.unref();

  const result = await waitForDaemon();
  if (!result) {
    throw new Error(`Timed out waiting for Devlane daemon. See ${daemonLogPath()}`);
  }

  process.stdout.write(`Devlane daemon started in background (pid ${result.pid}).\n`);
}

async function stopDaemon() {
  const running = await pingDaemon();
  if (!running) {
    cleanupDaemonFiles();
    process.stdout.write("Devlane daemon is not running.\n");
    return;
  }

  process.kill(running.pid, "SIGTERM");

  const stopped = await waitForStop(running.pid);
  if (!stopped) {
    throw new Error(`Timed out waiting for Devlane daemon ${running.pid} to stop.`);
  }

  cleanupDaemonFiles();
  process.stdout.write(`Stopped Devlane daemon ${running.pid}.\n`);
}

async function pingDaemon() {
  try {
    return await new DaemonRpcClient({ timeoutMs: 1000 }).ping();
  } catch {
    return null;
  }
}

async function waitForDaemon() {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const result = await pingDaemon();
    if (result) return result;
    await sleep(100);
  }

  return null;
}

async function waitForStop(pid) {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    if (!isPidRunning(pid) && !(await pingDaemon())) return true;
    await sleep(100);
  }

  return false;
}

function writePidFile(pid) {
  fs.writeFileSync(daemonPidPath(), `${pid}\n`);
}

function cleanupDaemonFiles() {
  for (const filePath of [daemonPidPath(), daemonSocketPath()]) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Best effort cleanup.
    }
  }
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
