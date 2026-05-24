import net from "node:net";
import { daemonSocketPath } from "../shared/paths.js";
import { DevlaneError } from "../shared/devlane-error.js";

export class DaemonRpcClient {
  constructor(options = {}) {
    this.socketPath = options.socketPath ?? daemonSocketPath();
    this.timeoutMs = options.timeoutMs ?? 1000;
  }

  async ping() {
    return this.request("ping", {});
  }

  async ensureEnvironment(projectPath) {
    return this.request("ensureEnvironment", { projectPath });
  }

  async getEnvironment(projectPath) {
    return this.request("getEnvironment", { projectPath });
  }

  async refreshEnvironment(projectPath) {
    return this.request("refreshEnvironment", { projectPath });
  }

  async resetDatabase(projectPath) {
    return this.request("resetDatabase", { projectPath });
  }

  async restart(projectPath, name) {
    return this.request("restart", { projectPath, name });
  }

  async destroyEnvironment(projectPath) {
    return this.request("destroyEnvironment", { projectPath });
  }

  request(method, params) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let buffer = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Devlane daemon request timed out: ${method}`));
      }, this.timeoutMs);

      socket.on("connect", () => {
        socket.write(`${JSON.stringify({ id, method, params })}\n`);
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;

        const line = buffer.slice(0, newline);
        clearTimeout(timer);
        socket.end();

        try {
          const message = JSON.parse(line);
          if (message.error) {
            reject(errorFromPayload(message.error));
          } else {
            resolve(message.result);
          }
        } catch (error) {
          reject(error);
        }
      });

      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
}

function errorFromPayload(payload) {
  if (payload.name === "DevlaneError") {
    return new DevlaneError(payload.message, {
      code: payload.code,
      component: payload.component,
      operation: payload.operation,
      details: payload.details,
      suggestions: payload.suggestions
    });
  }

  return new Error(payload.message);
}

export async function tryDaemon(method, args = [], options = {}) {
  const client = new DaemonRpcClient(options);

  try {
    return await client[method](...args);
  } catch (error) {
    if (isConnectionError(error)) {
      return null;
    }

    throw error;
  }
}

function isConnectionError(error) {
  return ["ENOENT", "ECONNREFUSED", "ECONNRESET"].includes(error.code) ||
    /connect ENOENT|connect ECONNREFUSED|socket hang up/.test(error.message);
}
