import fs from "node:fs";
import net from "node:net";
import { EnvironmentManager } from "./environment-manager.js";
import { daemonSocketPath, stateRoot } from "../shared/paths.js";
import { ensureDir } from "../shared/fs.js";
import { DevlaneError } from "../shared/devlane-error.js";

export function createDaemonServer(options = {}) {
  const socketPath = options.socketPath ?? daemonSocketPath();
  const manager = options.manager ?? new EnvironmentManager();
  const server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        await handleLine(socket, manager, line);
      }
    });
  });

  server.start = async () => {
    ensureDir(stateRoot());
    await removeStaleSocket(socketPath);

    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        fs.chmodSync(socketPath, 0o600);
        resolve(server);
      });
    });
  };

  return server;
}

async function handleLine(socket, manager, line) {
  let request;

  try {
    request = JSON.parse(line);
    const result = await dispatch(manager, request.method, request.params ?? {});
    socket.write(`${JSON.stringify({ id: request.id, result })}\n`);
  } catch (error) {
    socket.write(`${JSON.stringify({
      id: request?.id ?? null,
      error: serializeError(error)
    })}\n`);
  }
}

function serializeError(error) {
  if (error instanceof DevlaneError || error?.name === "DevlaneError") {
    return {
      ...error.toJSON?.(),
      name: "DevlaneError",
      message: error.message,
      code: error.code,
      component: error.component,
      operation: error.operation,
      details: error.details,
      suggestions: error.suggestions,
      stack: process.env.DEVLANE_DEBUG ? error.stack : undefined
    };
  }

  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    stack: process.env.DEVLANE_DEBUG ? error?.stack : undefined
  };
}

async function dispatch(manager, method, params) {
  if (method === "ping") {
    return { ok: true, pid: process.pid };
  }

  if (method === "ensureEnvironment") {
    return manager.ensureEnvironment(params.projectPath);
  }

  if (method === "getEnvironment") {
    return manager.getEnvironment(params.projectPath);
  }

  if (method === "refreshEnvironment") {
    const record = await manager.getEnvironment(params.projectPath);
    if (!record) return null;
    await manager.refreshRuntimeStatus(record);
    return record;
  }

  if (method === "resetDatabase") {
    return manager.resetDatabase(params.projectPath);
  }

  if (method === "restart") {
    return manager.restart(params.projectPath, params.name);
  }

  if (method === "destroyEnvironment") {
    return manager.destroyEnvironment(params.projectPath);
  }

  throw new Error(`Unknown daemon method: ${method}`);
}

async function removeStaleSocket(socketPath) {
  if (!fs.existsSync(socketPath)) return;

  await new Promise((resolve) => {
    const probe = net.createConnection(socketPath);
    probe.on("connect", () => {
      probe.end();
      resolve(false);
    });
    probe.on("error", () => resolve(true));
  }).then((isStale) => {
    if (isStale) fs.unlinkSync(socketPath);
  });
}
