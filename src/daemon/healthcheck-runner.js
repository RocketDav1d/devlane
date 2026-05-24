import { runShellCommand } from "../shared/processes.js";

export async function waitForHealth(healthcheck, options) {
  if (!healthcheck) return { ok: true, message: "no healthcheck configured" };

  const intervalMs = Number(healthcheck.interval_ms ?? 1000);
  const timeoutMs = Number(healthcheck.timeout_ms ?? 30000);
  const deadline = Date.now() + timeoutMs;
  let lastMessage = "";

  while (Date.now() < deadline) {
    if (healthcheck.command) {
      const result = await runShellCommand(healthcheck.command, {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: Math.min(intervalMs, 5000)
      });

      if (result.exitCode === 0) {
        return { ok: true, message: "command healthcheck passed", healthcheck };
      }

      lastMessage = result.stderr || result.stdout || `exit code ${result.exitCode}`;
    } else if (healthcheck.url) {
      try {
        const response = await fetch(healthcheck.url);
        if (response.ok) {
          return { ok: true, message: `HTTP ${response.status}`, healthcheck };
        }

        lastMessage = `HTTP ${response.status} ${response.statusText}`;
      } catch (error) {
        lastMessage = error.message;
      }
    }

    await sleep(intervalMs);
  }

  return { ok: false, message: lastMessage || "healthcheck timed out", healthcheck };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
