import fs from "node:fs";
import { spawn } from "node:child_process";
import { RuntimeDriver } from "./runtime-driver.js";
import { ensureDir } from "../shared/fs.js";
import { runShellCommand, stopDetachedProcess } from "../shared/processes.js";

export class ProcessDriver extends RuntimeDriver {
  constructor() {
    super("process");
  }

  async prepare() {
    return undefined;
  }

  async runCommand(handle, command) {
    return runShellCommand(command.command, {
      cwd: command.cwd ?? handle.workdir,
      env: command.env,
      timeoutMs: command.timeoutMs
    });
  }

  async startProcess(handle, processSpec) {
    ensureDir(processSpec.logDir);
    const fd = fs.openSync(processSpec.logPath, "a");
    fs.writeSync(fd, `\n[devlane] starting ${processSpec.name}: ${processSpec.command}\n`);

    const child = spawn(processSpec.command, {
      cwd: processSpec.cwd ?? handle.workdir,
      env: { ...process.env, ...processSpec.env },
      shell: true,
      detached: true,
      stdio: ["ignore", fd, fd]
    });

    child.unref();

    return {
      id: String(child.pid),
      pid: child.pid
    };
  }

  async stopProcess(_handle, processId) {
    await stopDetachedProcess(Number(processId));
  }

  async destroy(_handle, processes) {
    for (const processId of processes) {
      await this.stopProcess(_handle, processId);
    }
  }
}
