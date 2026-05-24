import { EnvironmentManager } from "../daemon/environment-manager.js";
import { DaemonRpcClient } from "../daemon/rpc-client.js";

export class EnvironmentClient {
  constructor(options = {}) {
    this.useDaemon = options.useDaemon ?? process.env.DEVLANE_NO_DAEMON !== "1";
    this.daemon = new DaemonRpcClient({ timeoutMs: options.timeoutMs ?? 120000 });
    this.manager = new EnvironmentManager();
  }

  async ensureEnvironment(projectPath) {
    return this.call("ensureEnvironment", projectPath);
  }

  async getEnvironment(projectPath) {
    return this.call("getEnvironment", projectPath);
  }

  async refreshEnvironment(projectPath) {
    if (this.useDaemon) {
      try {
        return await this.daemon.refreshEnvironment(projectPath);
      } catch (error) {
        if (!isConnectionError(error)) throw error;
      }
    }

    const record = await this.manager.getEnvironment(projectPath);
    if (!record) return null;
    await this.manager.refreshRuntimeStatus(record);
    return record;
  }

  async resetDatabase(projectPath) {
    return this.call("resetDatabase", projectPath);
  }

  async restart(projectPath, name) {
    if (this.useDaemon) {
      try {
        return await this.daemon.restart(projectPath, name);
      } catch (error) {
        if (!isConnectionError(error)) throw error;
      }
    }

    return this.manager.restart(projectPath, name);
  }

  async destroyEnvironment(projectPath) {
    return this.call("destroyEnvironment", projectPath);
  }

  async call(method, projectPath) {
    if (this.useDaemon) {
      try {
        return await this.daemon[method](projectPath);
      } catch (error) {
        if (!isConnectionError(error)) throw error;
      }
    }

    return this.manager[method](projectPath);
  }
}

function isConnectionError(error) {
  return ["ENOENT", "ECONNREFUSED", "ECONNRESET"].includes(error.code) ||
    /connect ENOENT|connect ECONNREFUSED|socket hang up/.test(error.message);
}
