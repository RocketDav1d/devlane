import { spawn } from "node:child_process";

export function runShellCommand(command, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      if (timeout) clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

export function isPidRunning(pid) {
  if (!pid) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopDetachedProcess(pid) {
  if (!pid) return;

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (!isPidRunning(pid)) return;

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already stopped.
    }
  }
}
